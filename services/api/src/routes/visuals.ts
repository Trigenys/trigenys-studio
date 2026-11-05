import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import type { Db } from "../db/client.ts";
import { VISUAL_STATUSES, task, visualAsset } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { pipelineDefinition } from "../pipeline/definition.ts";
import type { VisualAssetRow } from "../pipeline/engine.ts";
import { ProblemError } from "../problem.ts";
import { approvedKitOf, loadLogoVerified } from "../visuals/brand-kit.ts";
import { sha256Bytes } from "../visuals/canonical.ts";
import { activeFormat } from "../visuals/formats.ts";
import { svgRenderer } from "../visuals/renderer.ts";
import { idParam, idempotencyHeader, invalidateIfDecided, jsonBody, problemResponse, security, snapshotOr404, taskResource } from "./tasks.ts";

// Visual assets of a task: rendered on the server from the approved brand
// kit, content-addressed, and part of what an approval binds. Discarding is
// logical so an approval that pointed at a visual can still be explained.

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const VisualAssetSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    formatId: z.string(),
    brandKitId: z.uuid(),
    brandKitHash: z.string(),
    contentVersionId: z.uuid().nullable(),
    title: z.string(),
    subtitle: z.string(),
    brief: z.string(),
    variant: z.number().int(),
    renderer: z.string(),
    mime: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    contentHash: z.string(),
    byteSize: z.number().int(),
    status: z.enum(VISUAL_STATUSES),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    discardedBy: z.string().nullable(),
    discardedAt: z.string().nullable(),
  })
  .openapi("VisualAsset");

const RenderVisualSchema = z
  .object({
    formatId: z.string().min(1).max(40),
    // Defaults to the task title; the kit's default title is a fallback when the caller sends "".
    title: z.string().max(200).optional(),
    subtitle: z.string().max(300).default(""),
    brief: z.string().max(2_000).default(""),
  })
  .openapi("RenderVisual");

const visualParam = z.object({ id: z.uuid(), visualId: z.uuid() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const serialiseVisual = (v: VisualAssetRow) => {
  const { storageKey: _key, ...rest } = v;
  return { ...rest, createdAt: v.createdAt.toISOString(), discardedAt: v.discardedAt?.toISOString() ?? null };
};

const storageKeyOf = (contentHash: string) => `visuals/sha256/${contentHash}.svg`;

const visualResource = async (c: Context<AppEnv>) => {
  const id = c.req.param("id") ?? "";
  const [row] = UUID.test(id)
    ? await c.var.db
        .select({ taskId: visualAsset.taskId, productId: task.productId, state: task.state })
        .from(visualAsset)
        .innerJoin(task, eq(task.id, visualAsset.taskId))
        .where(eq(visualAsset.id, id))
    : [];
  if (!row) throw new ProblemError(404, "Unknown visual");
  return { type: "task" as const, id: row.taskId, productId: row.productId, attributes: { state: row.state } };
};

const visualOr404 = async (db: Db, id: string, taskId?: string): Promise<VisualAssetRow> => {
  const [row] = UUID.test(id) ? await db.select().from(visualAsset).where(eq(visualAsset.id, id)) : [];
  if (!row || (taskId && row.taskId !== taskId)) throw new ProblemError(404, "Unknown visual");
  return row;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listVisuals = createRoute({
  method: "get",
  path: "/tasks/{id}/visuals",
  tags: ["visuals"],
  summary: "Visual assets of a task (active by default)",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam, query: z.object({ include: z.enum(["discarded"]).optional() }) },
  responses: {
    200: { description: "Visuals", content: { "application/json": { schema: z.array(VisualAssetSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown task"),
  },
});

const renderVisual = createRoute({
  method: "post",
  path: "/tasks/{id}/visuals",
  tags: ["visuals"],
  summary: "Render a visual from the approved brand kit; invalidates a pending or granted approval (audited, Idempotency-Key)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: idParam, body: jsonBody(RenderVisualSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Rendered", content: { "application/json": { schema: VisualAssetSchema } } },
    200: { description: "Identical visual already active (same bytes)", content: { "application/json": { schema: VisualAssetSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown task"),
    409: problemResponse("No approved brand kit, task frozen, or logo integrity failure"),
    422: problemResponse("Unknown or inactive format, or Idempotency-Key reused"),
    503: problemResponse("Media store not configured"),
  },
});

const discardVisual = createRoute({
  method: "delete",
  path: "/tasks/{id}/visuals/{visualId}",
  tags: ["visuals"],
  summary: "Discard a visual (kept for history); invalidates a pending or granted approval (audited)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: visualParam },
  responses: {
    200: { description: "Discarded", content: { "application/json": { schema: VisualAssetSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown task or visual"),
    409: problemResponse("Task frozen"),
  },
});

const getFile = createRoute({
  method: "get",
  path: "/visuals/{id}/file",
  tags: ["visuals"],
  summary: "Bytes of a visual (immutable, content-addressed)",
  security,
  middleware: [authorize("content.read", visualResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Image", content: { "image/svg+xml": { schema: z.string() } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown visual or bytes missing"),
  },
});

const frozenOr409 = (state: string) => {
  if (pipelineDefinition.frozen.includes(state as never)) throw new ProblemError(409, "Content is frozen", { detail: `No visual change while the task is ${state}` });
};

export const visualRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listVisuals, async (c) => {
    const { id } = c.req.valid("param");
    const { include } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(visualAsset)
      .where(include === "discarded" ? eq(visualAsset.taskId, id) : and(eq(visualAsset.taskId, id), eq(visualAsset.status, "active")))
      .orderBy(visualAsset.formatId, visualAsset.variant);
    return c.json(rows.map(serialiseVisual), 200);
  })

  .openapi(renderVisual, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, { id, ...body }, async () => {
      const s = await snapshotOr404(db, id);
      frozenOr409(s.task.state);
      const format = await activeFormat(db, body.formatId);
      if (!format) throw new ProblemError(422, "Unknown or inactive format", { detail: body.formatId });
      const kit = await approvedKitOf(db, s.task.productId);
      if (!kit) throw new ProblemError(409, "No approved brand kit", { detail: `Product "${s.task.productId}" has no approved brand kit` });
      const logo = await loadLogoVerified(c.var.integrations.media, kit);
      const title = (body.title ?? s.task.title) || kit.defaultTitle || s.task.title;
      // Variants count discarded renders too: the (task, format, variant) key is never reused.
      const existingVariants = await db.select({ variant: visualAsset.variant }).from(visualAsset).where(and(eq(visualAsset.taskId, id), eq(visualAsset.formatId, format.id)));
      const nextVariant = existingVariants.reduce((max, v) => Math.max(max, v.variant), 0) + 1;
      const render = (variant: number) =>
        svgRenderer.render({
          format: { width: format.width, height: format.height, layout: format.layout },
          kit: { palette: kit.palette, fontFamily: kit.fontFamily, mentions: kit.mentions },
          logo,
          title,
          subtitle: body.subtitle,
          variant,
        });
      // The variant number feeds the colour scheme, so an identical request is detected by
      // re-rendering at each active variant of this format: same bytes → nothing to add.
      for (const asset of s.assets.filter((a) => a.formatId === format.id)) {
        if ((await sha256Bytes(render(asset.variant).bytes)) === asset.contentHash) return { status: 200 as const, body: serialiseVisual(asset) };
      }
      const out = render(nextVariant);
      const contentHash = await sha256Bytes(out.bytes);
      const storageKey = storageKeyOf(contentHash);
      await c.var.integrations.media.put(storageKey, out.bytes, out.mime);
      const row = await audited(
        db,
        {
          actor: principal,
          action: "visual.render",
          resource: { type: "task", id, productId: s.task.productId },
          requestId: c.var.requestId,
          details: { formatId: format.id, variant: nextVariant, brandKitId: kit.id, brandKitHash: kit.kitHash, contentHash, renderer: svgRenderer.id },
        },
        async (tx) => {
          const locked = await snapshotOr404(tx as unknown as Db, id, true);
          frozenOr409(locked.task.state);
          const [created] = await tx
            .insert(visualAsset)
            .values({
              taskId: id,
              formatId: format.id,
              brandKitId: kit.id,
              brandKitHash: kit.kitHash,
              contentVersionId: locked.latestVersion?.id ?? null,
              title,
              subtitle: body.subtitle,
              brief: body.brief,
              variant: nextVariant,
              renderer: svgRenderer.id,
              mime: out.mime,
              width: format.width,
              height: format.height,
              contentHash,
              storageKey,
              byteSize: out.bytes.length,
              createdBy: principal.userId,
            })
            .returning();
          await invalidateIfDecided(tx, locked, principal, "visuals changed after submission");
          return created!;
        },
      );
      return { status: 201 as const, body: serialiseVisual(row) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(discardVisual, async (c) => {
    const { id, visualId } = c.req.valid("param");
    const principal = c.var.principal!;
    const db = c.var.db;
    const visual = await visualOr404(db, visualId, id);
    if (visual.status === "discarded") return c.json(serialiseVisual(visual), 200);
    const row = await audited(
      db,
      {
        actor: principal,
        action: "visual.discard",
        resource: { type: "task", id },
        requestId: c.var.requestId,
        details: { visualId, formatId: visual.formatId, contentHash: visual.contentHash },
      },
      async (tx) => {
        const locked = await snapshotOr404(tx as unknown as Db, id, true);
        frozenOr409(locked.task.state);
        const [updated] = await tx
          .update(visualAsset)
          .set({ status: "discarded", discardedBy: principal.userId, discardedAt: new Date() })
          .where(and(eq(visualAsset.id, visualId), eq(visualAsset.status, "active")))
          .returning();
        if (!updated) throw new ProblemError(409, "Visual changed concurrently");
        await invalidateIfDecided(tx, locked, principal, "visuals changed after submission");
        return updated;
      },
    );
    return c.json(serialiseVisual(row), 200);
  })

  .openapi(getFile, async (c) => {
    const { id } = c.req.valid("param");
    const visual = await visualOr404(c.var.db, id);
    const etag = `"${visual.contentHash}"`;
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    const object = await c.var.integrations.media.get(visual.storageKey);
    if (!object) throw new ProblemError(404, "Visual bytes missing from the media store");
    return c.body(object.bytes as unknown as ArrayBuffer, 200, {
      "content-type": visual.mime,
      "cache-control": "private, max-age=31536000, immutable",
      etag,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  });
