import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq } from "drizzle-orm";
import { NEEDS_VERSION, buildPrompt } from "../assistant/prompt.ts";
import { audited } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import type { Db, Tx } from "../db/client.ts";
import { AI_ACTIONS, AI_INTERACTION_STATUSES, SOURCE_ORIGINS, aiInteraction, taskSource } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { LlmRefusedError, LlmUnavailableError } from "../integrations/anthropic/llm.ts";
import { pipelineDefinition } from "../pipeline/definition.ts";
import { sha256, type TaskSnapshot } from "../pipeline/engine.ts";
import { ProblemError } from "../problem.ts";
import {
  ContentVersionSchema,
  idParam,
  idempotencyHeader,
  insertVersion,
  jsonBody,
  problemResponse,
  security,
  serialiseVersion,
  snapshotOr404,
  taskResource,
} from "./tasks.ts";

// ---------------------------------------------------------------------------
// Editorial dossier: sources and the contextual assistant. An assistant
// output is a proposal until an operator accepts it, which creates a regular
// content version (aiAssisted) through the same rules as a manual one.
// ---------------------------------------------------------------------------

const iso = z.iso.datetime();

export const TaskSourceSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    origin: z.enum(SOURCE_ORIGINS),
    title: z.string(),
    url: z.string().nullable(),
    note: z.string(),
    addedBy: z.string().nullable(),
    createdAt: iso,
  })
  .openapi("TaskSource");

const CreateTaskSourceSchema = z
  .object({
    origin: z.enum(SOURCE_ORIGINS).default("manual"),
    title: z.string().min(1).max(200),
    url: z.url().max(2000).nullable().default(null),
    note: z.string().max(5_000).default(""),
  })
  .openapi("CreateTaskSource");

export const AiInteractionSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    action: z.enum(AI_ACTIONS),
    channel: z.string(),
    instruction: z.string(),
    model: z.string(),
    actorId: z.string().nullable(),
    contextRefs: z.array(z.string()),
    inputHash: z.string(),
    output: z.string(),
    tokensIn: z.number().int(),
    tokensOut: z.number().int(),
    status: z.enum(AI_INTERACTION_STATUSES),
    acceptedVersionId: z.uuid().nullable(),
    createdAt: iso,
  })
  .openapi("AiInteraction");

const AssistRequestSchema = z
  .object({
    action: z.enum(AI_ACTIONS),
    channel: z.string().min(1).max(40).openapi({ example: "linkedin" }),
    instruction: z.string().max(2_000).default(""),
  })
  .openapi("AssistRequest");

const interactionParam = z.object({ id: z.uuid(), interactionId: z.uuid() });
const sourceParam = z.object({ id: z.uuid(), sourceId: z.uuid() });

const serialiseSource = (r: typeof taskSource.$inferSelect) => ({ ...r, createdAt: r.createdAt.toISOString() });
const serialiseInteraction = (r: typeof aiInteraction.$inferSelect) => ({ ...r, createdAt: r.createdAt.toISOString() });

const frozenOr409 = (s: TaskSnapshot, what: string) => {
  if (pipelineDefinition.frozen.includes(s.task.state)) {
    throw new ProblemError(409, "Content is frozen", { detail: `No ${what} while the task is ${s.task.state}` });
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listSources = createRoute({
  method: "get",
  path: "/tasks/{id}/sources",
  tags: ["dossier"],
  summary: "Sources attached to the editorial dossier of the task",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Sources, oldest first", content: { "application/json": { schema: z.array(TaskSourceSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const addSource = createRoute({
  method: "post",
  path: "/tasks/{id}/sources",
  tags: ["dossier"],
  summary: "Attach a source to the dossier (audited, Idempotency-Key)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: idParam, body: jsonBody(CreateTaskSourceSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: TaskSourceSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const removeSource = createRoute({
  method: "delete",
  path: "/tasks/{id}/sources/{sourceId}",
  tags: ["dossier"],
  summary: "Detach a source from the dossier (audited)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: sourceParam },
  responses: {
    204: { description: "Removed" },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task or source"),
  },
});

const listInteractions = createRoute({
  method: "get",
  path: "/tasks/{id}/assistant",
  tags: ["dossier"],
  summary: "Assistant interactions on the task, newest first",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Interactions", content: { "application/json": { schema: z.array(AiInteractionSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const assist = createRoute({
  method: "post",
  path: "/tasks/{id}/assistant",
  tags: ["dossier"],
  summary: "Ask the assistant for a proposal built from the dossier (audited, Idempotency-Key); never writes content",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: idParam, body: jsonBody(AssistRequestSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Proposal recorded", content: { "application/json": { schema: AiInteractionSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
    409: problemResponse("Content is frozen, or the action needs a version that does not exist"),
    422: problemResponse("Idempotency-Key reused for a different request, or the model declined"),
    429: problemResponse("LLM provider rate limit"),
    502: problemResponse("LLM provider unavailable"),
  },
});

const acceptInteraction = createRoute({
  method: "post",
  path: "/tasks/{id}/assistant/{interactionId}/accept",
  tags: ["dossier"],
  summary: "Turn a proposal into a new content version (audited, Idempotency-Key)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: interactionParam, headers: idempotencyHeader },
  responses: {
    201: { description: "Version created from the proposal", content: { "application/json": { schema: ContentVersionSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task or interaction"),
    409: problemResponse("Content is frozen or the proposal was already decided"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const dismissInteraction = createRoute({
  method: "post",
  path: "/tasks/{id}/assistant/{interactionId}/dismiss",
  tags: ["dossier"],
  summary: "Discard a proposal (kept in the journal)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: interactionParam },
  responses: {
    200: { description: "Dismissed", content: { "application/json": { schema: AiInteractionSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task or interaction"),
    409: problemResponse("The proposal was already decided"),
  },
});

const interactionOr404 = async (db: Db, taskId: string, interactionId: string) => {
  const [row] = await db
    .select()
    .from(aiInteraction)
    .where(and(eq(aiInteraction.id, interactionId), eq(aiInteraction.taskId, taskId)))
    .limit(1);
  if (!row) throw new ProblemError(404, "Unknown interaction");
  return row;
};

export const dossierRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listSources, async (c) => {
    const { id } = c.req.valid("param");
    const rows = await c.var.db.select().from(taskSource).where(eq(taskSource.taskId, id)).orderBy(asc(taskSource.createdAt));
    return c.json(rows.map(serialiseSource), 200);
  })

  .openapi(addSource, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const result = await idempotent(c, { id, ...body }, async () => {
      const row = await audited(
        c.var.db,
        {
          actor: principal,
          action: "source.add",
          resource: { type: "task", id },
          requestId: c.var.requestId,
          details: { origin: body.origin, title: body.title },
        },
        async (tx) => {
          const [created] = await tx
            .insert(taskSource)
            .values({ taskId: id, origin: body.origin, title: body.title, url: body.url, note: body.note, addedBy: principal.userId })
            .returning();
          return created!;
        },
      );
      return { status: 201 as const, body: serialiseSource(row) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(removeSource, async (c) => {
    const { id, sourceId } = c.req.valid("param");
    const principal = c.var.principal!;
    await audited(
      c.var.db,
      { actor: principal, action: "source.remove", resource: { type: "task", id }, requestId: c.var.requestId, details: { sourceId } },
      async (tx) => {
        const deleted = await tx
          .delete(taskSource)
          .where(and(eq(taskSource.id, sourceId), eq(taskSource.taskId, id)))
          .returning({ id: taskSource.id });
        if (deleted.length === 0) throw new ProblemError(404, "Unknown source");
      },
    );
    return c.body(null, 204);
  })

  .openapi(listInteractions, async (c) => {
    const { id } = c.req.valid("param");
    const rows = await c.var.db
      .select()
      .from(aiInteraction)
      .where(eq(aiInteraction.taskId, id))
      .orderBy(desc(aiInteraction.createdAt), desc(aiInteraction.id));
    return c.json(rows.map(serialiseInteraction), 200);
  })

  .openapi(assist, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, { id, ...body }, async () => {
      const s = await snapshotOr404(db, id);
      frozenOr409(s, "assistant proposal");
      if (NEEDS_VERSION.has(body.action) && !s.latestVersion) {
        throw new ProblemError(409, "Nothing to work on", { detail: `"${body.action}" needs an existing content version` });
      }
      const sources = await db.select().from(taskSource).where(eq(taskSource.taskId, id)).orderBy(asc(taskSource.createdAt));
      const prompt = buildPrompt({
        action: body.action,
        channel: body.channel,
        instruction: body.instruction,
        task: s.task,
        latestVersion: s.latestVersion,
        sources,
      });
      // The model call happens outside any transaction; only its outcome is
      // persisted, together with the audit row, in one transaction.
      let completion;
      try {
        completion = await c.var.integrations.llm.complete({
          step: body.action,
          system: prompt.system,
          prompt: prompt.prompt,
          contextRefs: prompt.contextRefs,
        });
      } catch (e) {
        if (e instanceof LlmRefusedError) throw new ProblemError(422, "Proposal declined", { detail: e.message });
        if (e instanceof LlmUnavailableError) throw new ProblemError(e.status, "Assistant unavailable", { detail: e.message });
        throw e;
      }
      const row = await audited(
        db,
        {
          actor: principal,
          action: "ai.interact",
          resource: { type: "task", id },
          requestId: c.var.requestId,
          details: {
            action: body.action,
            channel: body.channel,
            model: completion.model,
            contextRefs: prompt.contextRefs,
            tokens: completion.tokens,
          },
        },
        async (tx) => {
          const [created] = await tx
            .insert(aiInteraction)
            .values({
              taskId: id,
              action: body.action,
              channel: body.channel,
              instruction: body.instruction,
              model: completion.model,
              actorId: principal.userId,
              contextRefs: prompt.contextRefs,
              inputHash: await sha256(prompt.system + "\n" + prompt.prompt),
              output: completion.output,
              tokensIn: completion.tokens.input,
              tokensOut: completion.tokens.output,
            })
            .returning();
          return created!;
        },
      );
      return { status: 201 as const, body: serialiseInteraction(row) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(acceptInteraction, async (c) => {
    const { id, interactionId } = c.req.valid("param");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, { id, interactionId, accept: true }, async () => {
      const created = await audited(
        db,
        {
          actor: principal,
          action: "content.version",
          resource: { type: "task", id },
          requestId: c.var.requestId,
          details: { aiInteractionId: interactionId, aiAssisted: true },
        },
        async (tx) => {
          const t = tx as unknown as Db;
          const s = await snapshotOr404(t, id, true);
          frozenOr409(s, "new version");
          const interaction = await interactionOr404(t, id, interactionId);
          if (interaction.status !== "proposed") {
            throw new ProblemError(409, "Proposal already decided", { detail: `This proposal is ${interaction.status}` });
          }
          const version = await insertVersion(tx as Tx, s, { channel: interaction.channel, body: interaction.output, aiAssisted: true }, principal);
          await t
            .update(aiInteraction)
            .set({ status: "accepted", acceptedVersionId: version.id })
            .where(eq(aiInteraction.id, interactionId));
          return version;
        },
      );
      return { status: 201 as const, body: serialiseVersion(created) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(dismissInteraction, async (c) => {
    const { id, interactionId } = c.req.valid("param");
    const principal = c.var.principal!;
    const row = await audited(
      c.var.db,
      { actor: principal, action: "ai.dismiss", resource: { type: "task", id }, requestId: c.var.requestId, details: { interactionId } },
      async (tx) => {
        const t = tx as unknown as Db;
        const interaction = await interactionOr404(t, id, interactionId);
        if (interaction.status !== "proposed") {
          throw new ProblemError(409, "Proposal already decided", { detail: `This proposal is ${interaction.status}` });
        }
        const [updated] = await t.update(aiInteraction).set({ status: "dismissed" }).where(eq(aiInteraction.id, interactionId)).returning();
        return updated!;
      },
    );
    return c.json(serialiseInteraction(row), 200);
  });
