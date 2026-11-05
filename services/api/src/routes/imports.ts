import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import type { Db } from "../db/client.ts";
import { IMPORT_ORIGINS, IMPORT_STATUSES, importItem, product, task, taskSource, type ImportOrigin } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { IntegrationNotAvailableError } from "../integrations/registry.ts";
import type { CmsArticle, RadarTopic } from "../integrations/types.ts";
import { UpstreamError } from "../integrations/upstream.ts";
import { pipelineDefinition } from "../pipeline/definition.ts";
import { ProblemError } from "../problem.ts";
import { idParam, idempotencyHeader, jsonBody, problemResponse, security } from "./tasks.ts";

// ---------------------------------------------------------------------------
// Imports: what the CMS (Trigenys Insight) and the radar (Editorial OS) hand
// over. Pull-based, read-only upstream. A sync upserts descriptions keyed by
// (origin, external ref) and never touches an operator's decision; a human
// then turns an item into a task (with sources carrying provenance) or
// ignores it. Nothing is ever written back to the CMS.
// ---------------------------------------------------------------------------

const iso = z.iso.datetime();

export const ImportItemSchema = z
  .object({
    id: z.uuid(),
    origin: z.enum(IMPORT_ORIGINS),
    externalRef: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    summary: z.string(),
    sources: z.array(z.string()),
    payload: z.record(z.string(), z.unknown()),
    observedAt: iso,
    status: z.enum(IMPORT_STATUSES),
    taskId: z.uuid().nullable(),
    decidedBy: z.string().nullable(),
    decidedAt: iso.nullable(),
    firstSeenAt: iso,
    syncedAt: iso,
  })
  .openapi("ImportItem");

const SyncImportsSchema = z
  .object({
    origin: z.enum([...IMPORT_ORIGINS, "all"]).default("all"),
    limit: z.number().int().min(1).max(100).default(50),
    since: iso.optional().openapi({ description: "Only items updated upstream after this instant" }),
  })
  .openapi("SyncImports");

export const SyncReportSchema = z
  .object({
    origins: z.array(
      z.object({
        origin: z.enum(IMPORT_ORIGINS),
        fetched: z.number().int(),
        created: z.number().int(),
        updated: z.number().int(),
      }),
    ),
  })
  .openapi("SyncReport");

const LinkImportSchema = z
  .object({
    productId: z.string().min(1),
    type: z.string().min(1).max(40).default("post"),
    title: z.string().min(1).max(200).optional(),
    assigneeId: z.string().nullable().default(null),
  })
  .openapi("LinkImport");

const ListImportsQuery = z.object({
  origin: z.enum(IMPORT_ORIGINS).optional(),
  status: z.enum(IMPORT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

type ImportRow = typeof importItem.$inferSelect;
const serialise = (r: ImportRow) => ({
  ...r,
  observedAt: r.observedAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  firstSeenAt: r.firstSeenAt.toISOString(),
  syncedAt: r.syncedAt.toISOString(),
});

const importResource = async (c: Context<AppEnv>) => {
  const id = c.req.param("id") ?? "";
  const [row] = UUID.test(id) ? await c.var.db.select().from(importItem).where(eq(importItem.id, id)) : [];
  if (!row) throw new ProblemError(404, "Unknown import");
  return { type: "import" as const, id: row.id };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The task is created on the product named in the body: the writer must be
// allowed there, not merely on some product.
const productFromBody = async (c: Context<AppEnv>) => {
  const body = (await c.req.json().catch(() => ({}))) as { productId?: unknown };
  return { type: "task" as const, productId: typeof body.productId === "string" ? body.productId : "-" };
};

// ---------------------------------------------------------------------------
// Upstream → rows
// ---------------------------------------------------------------------------

type Incoming = Pick<ImportRow, "origin" | "externalRef" | "title" | "url" | "summary" | "sources" | "payload" | "observedAt">;

const fromArticle = (a: CmsArticle): Incoming => ({
  origin: "cms",
  externalRef: a.externalRef,
  title: a.title,
  url: a.url,
  summary: a.excerpt,
  sources: a.url ? [a.url] : [],
  payload: { locale: a.locale, status: a.status, publishedAt: a.publishedAt, updatedAt: a.updatedAt },
  observedAt: new Date(a.publishedAt ?? a.updatedAt),
});

const fromTopic = (t: RadarTopic): Incoming => ({
  origin: "radar",
  externalRef: t.externalRef,
  title: t.title,
  url: null,
  summary: [t.angle, t.format ? `Format proposé : ${t.format}` : null].filter(Boolean).join("\n"),
  sources: t.sources,
  payload: { angle: t.angle, format: t.format, vertical: t.vertical, score: t.score, updatedAt: t.updatedAt },
  observedAt: new Date(t.observedAt),
});

async function upsertAll(db: Db, rows: Incoming[]) {
  let created = 0;
  let updated = 0;
  const now = new Date();
  for (const r of rows) {
    const [res] = await db
      .insert(importItem)
      .values({ ...r, syncedAt: now })
      .onConflictDoUpdate({
        target: [importItem.origin, importItem.externalRef],
        // Description only: status, task and decision stay as the operator left them.
        set: { title: r.title, url: r.url, summary: r.summary, sources: r.sources, payload: r.payload, observedAt: r.observedAt, syncedAt: now },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (res?.inserted) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

const provenance = (item: ImportRow) => {
  const date = item.observedAt.toISOString().slice(0, 10);
  const origin = item.origin === "cms" ? "CMS Trigenys Insight" : "radar Editorial OS";
  return `Origine : ${origin} (réf. ${item.externalRef}), ${item.origin === "cms" ? "publié" : "observé"} le ${date}.`;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listImports = createRoute({
  method: "get",
  path: "/imports",
  tags: ["imports"],
  summary: "Items received from the CMS and the radar, most recent first",
  security,
  middleware: [authorize("content.read")] as const,
  request: { query: ListImportsQuery },
  responses: {
    200: { description: "Items", content: { "application/json": { schema: z.array(ImportItemSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
  },
});

const syncImports = createRoute({
  method: "post",
  path: "/imports/sync",
  tags: ["imports"],
  summary: "Pull recent items from the CMS and/or the radar (upsert, never resets decisions)",
  security,
  middleware: [authorize("content.write")] as const,
  request: { body: jsonBody(SyncImportsSchema) },
  responses: {
    200: { description: "Per-origin counts", content: { "application/json": { schema: SyncReportSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    502: problemResponse("Upstream unavailable"),
    503: problemResponse("Integration not configured"),
  },
});

const getImport = createRoute({
  method: "get",
  path: "/imports/{id}",
  tags: ["imports"],
  summary: "One item, for preview before any editorial action",
  security,
  middleware: [authorize("content.read", importResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Item", content: { "application/json": { schema: ImportItemSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown import"),
  },
});

const linkImport = createRoute({
  method: "post",
  path: "/imports/{id}/task",
  tags: ["imports"],
  summary: "Create a task from the item, with sources carrying its provenance (audited, Idempotency-Key)",
  security,
  middleware: [authorize("content.write", productFromBody)] as const,
  request: { params: idParam, body: jsonBody(LinkImportSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Item now linked to the created task", content: { "application/json": { schema: ImportItemSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown import or product"),
    409: problemResponse("Item already linked or ignored"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const ignoreImport = createRoute({
  method: "post",
  path: "/imports/{id}/ignore",
  tags: ["imports"],
  summary: "Set the item aside without creating anything (audited)",
  security,
  middleware: [authorize("content.write", importResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Item ignored", content: { "application/json": { schema: ImportItemSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed"),
    404: problemResponse("Unknown import"),
    409: problemResponse("Item already linked to a task"),
  },
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function itemOr404(db: Db, id: string) {
  const [row] = await db.select().from(importItem).where(eq(importItem.id, id));
  if (!row) throw new ProblemError(404, "Unknown import");
  return row;
}

export const importRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listImports, async (c) => {
    const q = c.req.valid("query");
    const where: SQL[] = [];
    if (q.origin) where.push(eq(importItem.origin, q.origin));
    if (q.status) where.push(eq(importItem.status, q.status));
    const rows = await c.var.db
      .select()
      .from(importItem)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(importItem.observedAt), desc(importItem.firstSeenAt))
      .limit(q.limit);
    return c.json(rows.map(serialise), 200);
  })

  .openapi(syncImports, async (c) => {
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const origins: ImportOrigin[] = body.origin === "all" ? [...IMPORT_ORIGINS] : [body.origin];
    const query = { limit: body.limit, ...(body.since ? { since: body.since } : {}) };
    const report = await audited(
      c.var.db,
      { actor: principal, action: "import.sync", resource: { type: "service" }, requestId: c.var.requestId, details: { origins, limit: body.limit } },
      async (tx) => {
        const out = [];
        for (const origin of origins) {
          let rows: Incoming[];
          try {
            rows =
              origin === "cms"
                ? (await c.var.integrations.cms.listArticles(query)).map(fromArticle)
                : (await c.var.integrations.radar.listProposals(query)).map(fromTopic);
          } catch (e) {
            if (e instanceof UpstreamError) throw new ProblemError(502, "Upstream unavailable", { detail: e.message });
            if (e instanceof IntegrationNotAvailableError) throw new ProblemError(503, "Integration not configured", { detail: e.message });
            throw e;
          }
          const counts = await upsertAll(tx as unknown as Db, rows);
          out.push({ origin, fetched: rows.length, ...counts });
        }
        return { origins: out };
      },
    );
    return c.json(report, 200);
  })

  .openapi(getImport, async (c) => c.json(serialise(await itemOr404(c.var.db, c.req.valid("param").id)), 200))

  .openapi(linkImport, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const result = await idempotent(c, { id, ...body }, async () => {
      const item = await itemOr404(c.var.db, id);
      if (item.status !== "new") throw new ProblemError(409, `Item already ${item.status}`);
      const [p] = await c.var.db.select({ id: product.id }).from(product).where(eq(product.id, body.productId));
      if (!p) throw new ProblemError(404, "Unknown product");
      const title = body.title ?? item.title.slice(0, 200);
      const row = await audited(
        c.var.db,
        {
          actor: principal,
          action: "import.link",
          resource: { type: "import", id, productId: body.productId },
          requestId: c.var.requestId,
          details: { origin: item.origin, externalRef: item.externalRef, type: body.type },
        },
        async (tx) => {
          const [created] = await tx
            .insert(task)
            .values({
              productId: body.productId,
              type: body.type,
              title,
              brief: [item.summary, provenance(item)].filter(Boolean).join("\n\n"),
              assigneeId: body.assigneeId,
              state: pipelineDefinition.initial,
              createdBy: principal.userId,
            })
            .returning();
          const sources =
            item.origin === "cms"
              ? [{ title: item.title, url: item.url, note: provenance(item) }]
              : [
                  { title: item.title, url: null, note: provenance(item) },
                  ...item.sources.map((url, i) => ({ title: `Source ${i + 1} du radar`, url, note: "" })),
                ];
          await tx.insert(taskSource).values(sources.map((s) => ({ taskId: created!.id, origin: item.origin, ...s, addedBy: principal.userId })));
          const [linked] = await tx
            .update(importItem)
            .set({ status: "linked", taskId: created!.id, decidedBy: principal.userId, decidedAt: new Date() })
            .where(and(eq(importItem.id, id), eq(importItem.status, "new")))
            .returning();
          if (!linked) throw new ProblemError(409, "Item already decided");
          return linked;
        },
      );
      return { status: 201 as const, body: serialise(row) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(ignoreImport, async (c) => {
    const { id } = c.req.valid("param");
    const principal = c.var.principal!;
    const item = await itemOr404(c.var.db, id);
    if (item.status === "linked") throw new ProblemError(409, "Item already linked to a task");
    if (item.status === "ignored") return c.json(serialise(item), 200);
    const row = await audited(
      c.var.db,
      { actor: principal, action: "import.ignore", resource: { type: "import", id }, requestId: c.var.requestId, details: { origin: item.origin, externalRef: item.externalRef } },
      async (tx) => {
        const [r] = await tx.update(importItem).set({ status: "ignored", decidedBy: principal.userId, decidedAt: new Date() }).where(eq(importItem.id, id)).returning();
        return r!;
      },
    );
    return c.json(serialise(row), 200);
  });
