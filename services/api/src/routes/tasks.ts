import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, lte, type SQL } from "drizzle-orm";
import { audited, recordAudit } from "../auth/audit.ts";
import { authorize, requireSession } from "../auth/middleware.ts";
import { decide, type Principal } from "../auth/rbac.ts";
import type { Db, Tx } from "../db/client.ts";
import {
  APPROVAL_DECISIONS,
  TASK_STATES,
  approval,
  comment,
  contentVersion,
  product,
  task,
  taskTransition,
} from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { pipelineDefinition } from "../pipeline/definition.ts";
import {
  allowedTransitions,
  applyTransition,
  approvalIsValid,
  assetSetHashOf,
  loadSnapshot,
  requestTransition,
  resourceOf,
  ruleFor,
  sha256,
  TransitionError,
  type ApprovalRow,
  type ContentVersionRow,
  type TaskRow,
  type TaskSnapshot,
} from "../pipeline/engine.ts";
import { ProblemError, ProblemSchema } from "../problem.ts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const iso = z.iso.datetime();

export const TaskSchema = z
  .object({
    id: z.uuid(),
    productId: z.string(),
    type: z.string(),
    title: z.string(),
    brief: z.string(),
    state: z.enum(TASK_STATES),
    priority: z.number().int(),
    dueAt: iso.nullable(),
    assigneeId: z.string().nullable(),
    version: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: iso,
    updatedAt: iso,
  })
  .openapi("Task");

export const ContentVersionSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    n: z.number().int(),
    channel: z.string(),
    body: z.string(),
    contentHash: z.string(),
    aiAssisted: z.boolean(),
    authorId: z.string().nullable(),
    createdAt: iso,
  })
  .openapi("ContentVersion");

export const ApprovalSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    contentVersionId: z.uuid(),
    contentHash: z.string(),
    assetSetHash: z.string(),
    approverId: z.string().nullable(),
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().nullable(),
    createdAt: iso,
  })
  .openapi("Approval");

export const TaskTransitionSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    fromState: z.enum(TASK_STATES),
    toState: z.enum(TASK_STATES),
    actorId: z.string().nullable(),
    reason: z.string().nullable(),
    createdAt: iso,
  })
  .openapi("TaskTransition");

export const CommentSchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    authorId: z.string().nullable(),
    body: z.string(),
    createdAt: iso,
  })
  .openapi("Comment");

export const TaskDetailSchema = TaskSchema.extend({
  latestVersion: z.union([ContentVersionSchema, z.null()]),
  latestApproval: z.union([ApprovalSchema, z.null()]),
  approvalValid: z.boolean(),
  // What the caller may do next; the server re-checks on every request.
  allowedTransitions: z.array(z.enum(TASK_STATES)),
}).openapi("TaskDetail");

const CreateTaskSchema = z
  .object({
    productId: z.string().min(1),
    type: z.string().min(1).max(40).openapi({ example: "post" }),
    title: z.string().min(1).max(200),
    brief: z.string().max(20_000).default(""),
    priority: z.number().int().min(0).max(3).default(0),
    dueAt: iso.nullable().default(null),
    assigneeId: z.string().nullable().default(null),
  })
  .openapi("CreateTask");

const UpdateTaskSchema = z
  .object({
    // Optimistic concurrency: the version the client last saw.
    version: z.number().int().min(1),
    type: z.string().min(1).max(40).optional(),
    title: z.string().min(1).max(200).optional(),
    brief: z.string().max(20_000).optional(),
    priority: z.number().int().min(0).max(3).optional(),
    dueAt: iso.nullable().optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .openapi("UpdateTask");

const CreateContentVersionSchema = z
  .object({
    channel: z.string().min(1).max(40).openapi({ example: "linkedin" }),
    body: z.string().min(1).max(100_000),
    aiAssisted: z.boolean().default(false),
  })
  .openapi("CreateContentVersion");

const CreateCommentSchema = z.object({ body: z.string().min(1).max(10_000) }).openapi("CreateComment");

const RequestTransitionSchema = z
  .object({
    to: z.enum(TASK_STATES),
    reason: z.string().max(2_000).nullable().default(null),
  })
  .openapi("RequestTransition");

const DecideApprovalSchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().max(5_000).nullable().default(null),
  })
  .openapi("DecideApproval");

const ListTasksQuery = z.object({
  productId: z.string().optional(),
  state: z.enum(TASK_STATES).optional(),
  // "me" selects the caller's tasks.
  assigneeId: z.string().optional(),
  dueBefore: iso.optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});
export const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
});
export const security: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
export const idParam = z.object({ id: z.uuid() });
export const idempotencyHeader = z.object({
  "idempotency-key": z.string().min(1).max(200).optional().openapi({ description: "Replays an identical request" }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const serialiseTask = (t: TaskRow) => ({
  ...t,
  dueAt: t.dueAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
export const serialiseVersion = (v: ContentVersionRow) => ({ ...v, createdAt: v.createdAt.toISOString() });
const serialiseApproval = (a: ApprovalRow) => ({ ...a, createdAt: a.createdAt.toISOString() });
const serialiseTransition = (t: typeof taskTransition.$inferSelect) => ({ ...t, createdAt: t.createdAt.toISOString() });
const serialiseComment = (r: typeof comment.$inferSelect) => ({ ...r, createdAt: r.createdAt.toISOString() });

async function detail(s: TaskSnapshot, principal: Principal) {
  return {
    ...serialiseTask(s.task),
    latestVersion: s.latestVersion ? serialiseVersion(s.latestVersion) : null,
    latestApproval: s.latestApproval ? serialiseApproval(s.latestApproval) : null,
    approvalValid: await approvalIsValid(s),
    allowedTransitions: await allowedTransitions(s, principal),
  };
}

// Resource loader for the task routes: 404 for unknown ids, policy input otherwise.
export const taskResource = async (c: { req: { param: (k: string) => string | undefined }; var: { db: Db } }) => {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) return null;
  const s = await loadSnapshot(c.var.db, id);
  return s ? resourceOf(s) : null;
};

export const snapshotOr404 = async (db: Db, id: string, lock = false): Promise<TaskSnapshot> => {
  const s = await loadSnapshot(db, id, lock);
  if (!s) throw new ProblemError(404, "Unknown task");
  return s;
};

const asProblem = (e: unknown): never => {
  if (e instanceof TransitionError) throw new ProblemError(e.status, "Transition refused", { detail: e.message });
  throw e;
};

// Appends a content version to a task that is not frozen (the caller checks)
// and, when the task was submitted or approved, sends it back to preparing:
// an approval binds to a hash, so new content never inherits it.
export async function insertVersion(
  tx: Tx,
  s: TaskSnapshot,
  body: { channel: string; body: string; aiAssisted: boolean },
  principal: Principal,
): Promise<ContentVersionRow> {
  const [row] = await tx
    .insert(contentVersion)
    .values({
      taskId: s.task.id,
      n: (s.latestVersion?.n ?? 0) + 1,
      channel: body.channel,
      body: body.body,
      contentHash: await sha256(body.body),
      aiAssisted: body.aiAssisted,
      authorId: principal.userId,
    })
    .returning();
  const back = pipelineDefinition.invalidatedBy[s.task.state];
  if (back) await applyTransition(tx, s, back, principal.userId, "content changed after submission");
  return row!;
}

// Products the principal may read; null means all of them.
const readableProducts = (p: Principal): string[] | null =>
  p.grants.some((g) => g.productId === null) ? null : [...new Set(p.grants.map((g) => g.productId!))];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const listTasks = createRoute({
  method: "get",
  path: "/tasks",
  tags: ["pipeline"],
  summary: "List tasks visible to the caller (filters: product, state, assignee, due date)",
  security,
  middleware: [authorize("content.read", () => ({ type: "task" }))] as const,
  request: { query: ListTasksQuery },
  responses: {
    200: { description: "Tasks", content: { "application/json": { schema: z.array(TaskSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("No role"),
  },
});

const createTask = createRoute({
  method: "post",
  path: "/tasks",
  tags: ["pipeline"],
  summary: "Create a task in its initial state (audited, Idempotency-Key)",
  security,
  middleware: [
    authorize("content.write", async (c) => {
      const body = (await c.req.raw.clone().json().catch(() => null)) as { productId?: unknown } | null;
      const productId = typeof body?.productId === "string" ? body.productId : undefined;
      return { type: "task", productId };
    }),
  ] as const,
  request: { body: jsonBody(CreateTaskSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: TaskDetailSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown product"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const getTask = createRoute({
  method: "get",
  path: "/tasks/{id}",
  tags: ["pipeline"],
  summary: "Task with its latest content, approval and allowed transitions",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Task", content: { "application/json": { schema: TaskDetailSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const updateTask = createRoute({
  method: "patch",
  path: "/tasks/{id}",
  tags: ["pipeline"],
  summary: "Update task fields (optimistic concurrency on version, audited)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: idParam, body: jsonBody(UpdateTaskSchema) },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: TaskDetailSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
    409: problemResponse("Stale version"),
  },
});

const listVersions = createRoute({
  method: "get",
  path: "/tasks/{id}/versions",
  tags: ["pipeline"],
  summary: "Content versions, newest first",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Versions", content: { "application/json": { schema: z.array(ContentVersionSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const addVersion = createRoute({
  method: "post",
  path: "/tasks/{id}/versions",
  tags: ["pipeline"],
  summary: "Add a content version; invalidates a pending or granted approval (audited, Idempotency-Key)",
  security,
  middleware: [authorize("content.write", taskResource)] as const,
  request: { params: idParam, body: jsonBody(CreateContentVersionSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: ContentVersionSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
    409: problemResponse("Content is frozen in this state"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const listComments = createRoute({
  method: "get",
  path: "/tasks/{id}/comments",
  tags: ["pipeline"],
  summary: "Comments, oldest first",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Comments", content: { "application/json": { schema: z.array(CommentSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const addComment = createRoute({
  method: "post",
  path: "/tasks/{id}/comments",
  tags: ["pipeline"],
  summary: "Comment a task (Idempotency-Key)",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam, body: jsonBody(CreateCommentSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: CommentSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const listTransitions = createRoute({
  method: "get",
  path: "/tasks/{id}/transitions",
  tags: ["pipeline"],
  summary: "Transition history, oldest first",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Transitions", content: { "application/json": { schema: z.array(TaskTransitionSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const transition = createRoute({
  method: "post",
  path: "/tasks/{id}/transitions",
  tags: ["pipeline"],
  summary: "Move the task along the pipeline (role and guards decided server side, audited, Idempotency-Key)",
  security,
  middleware: [requireSession] as const,
  request: { params: idParam, body: jsonBody(RequestTransitionSchema), headers: idempotencyHeader },
  responses: {
    200: { description: "Moved", content: { "application/json": { schema: TaskDetailSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Role or approval missing for this transition"),
    404: problemResponse("Unknown task"),
    409: problemResponse("Transition not available from the current state"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const listApprovals = createRoute({
  method: "get",
  path: "/tasks/{id}/approvals",
  tags: ["pipeline"],
  summary: "Approval decisions, newest first",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Approvals", content: { "application/json": { schema: z.array(ApprovalSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not allowed on this product"),
    404: problemResponse("Unknown task"),
  },
});

const decideApproval = createRoute({
  method: "post",
  path: "/tasks/{id}/approvals",
  tags: ["pipeline"],
  summary: "Approve or reject the current content (reviewer, no self-approval, audited, Idempotency-Key)",
  security,
  middleware: [authorize("content.review", taskResource)] as const,
  request: { params: idParam, body: jsonBody(DecideApprovalSchema), headers: idempotencyHeader },
  responses: {
    201: { description: "Decided", content: { "application/json": { schema: TaskDetailSchema } } },
    400: problemResponse("Invalid body"),
    401: problemResponse("No valid session"),
    403: problemResponse("Not a reviewer, or author of the content"),
    404: problemResponse("Unknown task"),
    409: problemResponse("Task is not awaiting approval"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const taskRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listTasks, async (c) => {
    const q = c.req.valid("query");
    const principal = c.var.principal!;
    const scope = readableProducts(principal);
    const where: SQL[] = [];
    if (scope) where.push(inArray(task.productId, scope.length ? scope : ["-"]));
    if (q.productId) where.push(eq(task.productId, q.productId));
    if (q.state) where.push(eq(task.state, q.state));
    if (q.assigneeId) where.push(eq(task.assigneeId, q.assigneeId === "me" ? principal.userId : q.assigneeId));
    if (q.dueBefore) where.push(lte(task.dueAt, new Date(q.dueBefore)));
    const rows = await c.var.db
      .select()
      .from(task)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(task.dueAt), desc(task.priority), asc(task.createdAt));
    return c.json(rows.map(serialiseTask), 200);
  })

  .openapi(createTask, async (c) => {
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, body, async () => {
      const [p] = await db.select({ id: product.id }).from(product).where(eq(product.id, body.productId));
      if (!p) throw new ProblemError(404, "Unknown product", { detail: `No product "${body.productId}"` });
      const created = await audited(
        db,
        {
          actor: principal,
          action: "task.create",
          resource: { type: "task", productId: body.productId },
          requestId: c.var.requestId,
          details: { title: body.title, type: body.type },
        },
        async (tx) =>
          (
            await tx
              .insert(task)
              .values({
                ...body,
                dueAt: body.dueAt ? new Date(body.dueAt) : null,
                state: pipelineDefinition.initial,
                createdBy: principal.userId,
              })
              .returning()
          )[0]!,
      );
      const s = await snapshotOr404(db, created.id);
      return { status: 201 as const, body: await detail(s, principal) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(getTask, async (c) => {
    const s = await snapshotOr404(c.var.db, c.req.valid("param").id);
    return c.json(await detail(s, c.var.principal!), 200);
  })

  .openapi(updateTask, async (c) => {
    const { id } = c.req.valid("param");
    const { version, ...patch } = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const updated = await audited(
      db,
      {
        actor: principal,
        action: "task.update",
        resource: { type: "task", id },
        requestId: c.var.requestId,
        details: { fields: Object.keys(patch) },
      },
      async (tx) => {
        const [row] = await tx
          .update(task)
          .set({
            ...patch,
            dueAt: patch.dueAt === undefined ? undefined : patch.dueAt ? new Date(patch.dueAt) : null,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(task.id, id), eq(task.version, version)))
          .returning();
        if (!row) throw new ProblemError(409, "Stale version", { detail: "Reload the task and apply the change again" });
        return row;
      },
    );
    const s = await snapshotOr404(db, updated.id);
    return c.json(await detail(s, principal), 200);
  })

  .openapi(listVersions, async (c) => {
    const { id } = c.req.valid("param");
    const rows = await c.var.db
      .select()
      .from(contentVersion)
      .where(eq(contentVersion.taskId, id))
      .orderBy(desc(contentVersion.n));
    return c.json(rows.map(serialiseVersion), 200);
  })

  .openapi(addVersion, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, { id, ...body }, async () => {
      const created = await audited(
        db,
        {
          actor: principal,
          action: "content.version",
          resource: { type: "task", id },
          requestId: c.var.requestId,
          details: { channel: body.channel, aiAssisted: body.aiAssisted },
        },
        async (tx) => {
          const s = await snapshotOr404(tx as unknown as Db, id, true);
          if (pipelineDefinition.frozen.includes(s.task.state)) {
            throw new ProblemError(409, "Content is frozen", {
              detail: `No new version while the task is ${s.task.state}`,
            });
          }
          return insertVersion(tx, s, body, principal);
        },
      );
      return { status: 201 as const, body: serialiseVersion(created) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(listComments, async (c) => {
    const { id } = c.req.valid("param");
    const rows = await c.var.db.select().from(comment).where(eq(comment.taskId, id)).orderBy(asc(comment.createdAt));
    return c.json(rows.map(serialiseComment), 200);
  })

  .openapi(addComment, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const result = await idempotent(c, { id, ...body }, async () => {
      const [row] = await c.var.db
        .insert(comment)
        .values({ taskId: id, authorId: principal.userId, body: body.body })
        .returning();
      return { status: 201 as const, body: serialiseComment(row!) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(listTransitions, async (c) => {
    const { id } = c.req.valid("param");
    const rows = await c.var.db
      .select()
      .from(taskTransition)
      .where(eq(taskTransition.taskId, id))
      .orderBy(asc(taskTransition.createdAt));
    return c.json(rows.map(serialiseTransition), 200);
  })

  .openapi(transition, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, { id, ...body }, async () => {
      // The action to authorize depends on the requested transition, so the
      // policy is decided here with the same audit trail authorize() leaves.
      const current = await snapshotOr404(db, id);
      const rule = ruleFor(current.task.state, body.to);
      if (!rule) {
        throw new ProblemError(409, "Transition refused", {
          detail: `No transition from ${current.task.state} to ${body.to}`,
        });
      }
      const resource = await resourceOf(current);
      const decision = decide(rule.action, principal, resource);
      if (!decision.allowed) {
        await recordAudit(db, {
          actor: principal,
          action: rule.action,
          resource,
          outcome: "denied",
          requestId: c.var.requestId,
          details: { reason: decision.reason, to: body.to },
        });
        throw new ProblemError(403, "Forbidden", { detail: decision.reason });
      }
      await audited(
        db,
        {
          actor: principal,
          action: "task.transition",
          resource,
          requestId: c.var.requestId,
          details: { from: current.task.state, to: body.to, reason: body.reason },
        },
        async (tx) => {
          const locked = await snapshotOr404(tx as unknown as Db, id, true);
          if (locked.task.state !== current.task.state) throw new TransitionError(409, "The task changed concurrently");
          return requestTransition(tx, locked, body.to, principal.userId, body.reason).catch(asProblem);
        },
      ).catch(asProblem);
      const s = await snapshotOr404(db, id);
      return { status: 200 as const, body: await detail(s, principal) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(listApprovals, async (c) => {
    const { id } = c.req.valid("param");
    const rows = await c.var.db
      .select()
      .from(approval)
      .where(eq(approval.taskId, id))
      .orderBy(desc(approval.createdAt));
    return c.json(rows.map(serialiseApproval), 200);
  })

  .openapi(decideApproval, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const { decided } = pipelineDefinition;
    // Returns the version under review, or whether the caller wrote it.
    const check = (s: TaskSnapshot): { version: ContentVersionRow; self: boolean } => {
      if (s.task.state !== decided.from) {
        throw new ProblemError(409, "Not awaiting approval", { detail: `The task is ${s.task.state}` });
      }
      if (!s.latestVersion) throw new ProblemError(409, "Nothing to approve", { detail: "No content version" });
      return { version: s.latestVersion, self: s.latestVersion.authorId === principal.userId };
    };
    const result = await idempotent(c, { id, ...body }, async () => {
      // Four-eyes rule: the author of the content under review never decides
      // on it. The denial is audited outside the transaction it aborts.
      const current = await snapshotOr404(db, id);
      if (check(current).self) {
        await recordAudit(db, {
          actor: principal,
          action: "content.review",
          resource: await resourceOf(current),
          outcome: "denied",
          requestId: c.var.requestId,
          details: { reason: "self-approval" },
        });
        throw new ProblemError(403, "Self-approval is not allowed", {
          detail: "The author of the latest content version cannot decide on it",
        });
      }
      await audited(
        db,
        {
          actor: principal,
          action: body.decision === "approved" ? "task.approve" : "task.reject",
          resource: { type: "task", id },
          requestId: c.var.requestId,
          details: { comment: body.comment },
        },
        async (tx) => {
          const s = await snapshotOr404(tx as unknown as Db, id, true);
          const { version, self } = check(s);
          if (self) throw new ProblemError(409, "The task changed concurrently");
          await tx.insert(approval).values({
            taskId: id,
            contentVersionId: version.id,
            contentHash: version.contentHash,
            assetSetHash: await assetSetHashOf(s),
            approverId: principal.userId,
            decision: body.decision,
            comment: body.comment,
          });
          await applyTransition(tx, s, decided[body.decision], principal.userId, body.comment);
        },
      );
      const s = await snapshotOr404(db, id);
      return { status: 201 as const, body: await detail(s, principal) };
    });
    return c.json(result.body, result.status);
  });
