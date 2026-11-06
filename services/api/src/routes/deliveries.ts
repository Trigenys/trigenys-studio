import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { reconcileTaskAlerts } from "../alerts/reconcile.ts";
import { audited, recordAudit } from "../auth/audit.ts";
import { authorize } from "../auth/middleware.ts";
import type { Principal, Resource } from "../auth/rbac.ts";
import type { Db, Tx } from "../db/client.ts";
import { ATTEMPT_OUTCOMES, ATTEMPT_TRIGGERS, DELIVERY_STATUSES, TASK_STATES, delivery, deliveryAttempt, socialAccount, task } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { integrationModes } from "../integrations/registry.ts";
import { SOCIAL_CHANNELS } from "../integrations/types.ts";
import { TransitionError, applyTransition, loadSnapshot, requestTransition, resourceOf, sha256, type TaskSnapshot } from "../pipeline/engine.ts";
import { ProblemError } from "../problem.ts";
import { dispatch, liveDeliveriesOf, type DeliveryRow } from "../publishing/dispatch.ts";
import { PUBLISH_WINDOW_DAYS, checkReadiness, firstFailure, type SocialAccountRow } from "../publishing/readiness.ts";
import { dispatchTuning } from "../publishing/scheduled.ts";
import { settleTask } from "../publishing/settle.ts";
import { SocialAccountSchema, serialiseAccount } from "./social-accounts.ts";
import { idParam, idempotencyHeader, jsonBody, problemResponse, security, snapshotOr404, taskResource } from "./tasks.ts";

// Deliveries: one approved task handed to one social account at one date.
// The outbox (publishing/dispatch.ts) does the provider calls; these routes
// only create, schedule, cancel and retry rows, and read the calendar.

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const iso = z.iso.datetime();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CALENDAR_DAYS = 92;

export const DeliverySchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    socialAccountId: z.uuid(),
    contentVersionId: z.uuid(),
    approvalId: z.uuid(),
    scheduledAt: iso.nullable(),
    status: z.enum(DELIVERY_STATUSES),
    externalId: z.string().nullable(),
    permalink: z.string().nullable(),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    lastError: z.string().nullable(),
    nextRetryAt: iso.nullable(),
    sentAt: iso.nullable(),
    version: z.number().int(),
    createdBy: z.string().nullable(),
    createdAt: iso,
    updatedAt: iso,
    account: SocialAccountSchema.optional(),
  })
  .openapi("Delivery");

export const DeliveryAttemptSchema = z
  .object({
    id: z.uuid(),
    deliveryId: z.uuid(),
    n: z.number().int(),
    trigger: z.enum(ATTEMPT_TRIGGERS),
    startedAt: iso,
    finishedAt: iso.nullable(),
    outcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
    externalId: z.string().nullable(),
    error: z.string().nullable(),
    retryAfterS: z.number().int().nullable(),
  })
  .openapi("DeliveryAttempt");

const CheckSchema = z.object({ ok: z.boolean(), reason: z.string() });
export const PublishReadinessSchema = z
  .object({
    ready: z.boolean(),
    checks: z.object({ state: CheckSchema, approval: CheckSchema, account: CheckSchema, permission: CheckSchema, window: CheckSchema }),
  })
  .openapi("PublishReadiness");

export const CreateDeliverySchema = z
  .object({
    socialAccountId: z.uuid(),
    scheduledAt: iso.optional().openapi({ description: "Omit to create a draft and schedule it later" }),
  })
  .openapi("CreateDelivery");

export const ScheduleDeliverySchema = z.object({ scheduledAt: iso, version: z.number().int() }).openapi("ScheduleDelivery");
export const DeliveryVersionSchema = z.object({ version: z.number().int() }).openapi("DeliveryVersion");
export const DeliveryPermalinkSchema = z.object({ url: z.url(), version: z.number().int() }).openapi("DeliveryPermalink");
export const DispatchRequestSchema = z
  .object({ now: iso.optional().openapi({ description: "Simulated clock; accepted only when the publisher runs in mock mode" }) })
  .openapi("DispatchRequest");
export const DispatchReportSchema = z
  .object({
    claimed: z.number().int(),
    handedOff: z.number().int(),
    sent: z.number().int(),
    retried: z.number().int(),
    failed: z.number().int(),
    reconciled: z.number().int(),
    unknown: z.number().int(),
    polled: z.number().int(),
  })
  .openapi("DispatchReport");

export const CalendarEntrySchema = z
  .object({
    id: z.uuid(),
    taskId: z.uuid(),
    taskTitle: z.string(),
    productId: z.string(),
    channel: z.enum(SOCIAL_CHANNELS),
    accountHandle: z.string(),
    scheduledAt: iso,
    status: z.enum(DELIVERY_STATUSES),
    lastError: z.string().nullable(),
    permalink: z.string().nullable(),
  })
  .openapi("CalendarEntry");

export const CalendarDueTaskSchema = z
  .object({ id: z.uuid(), title: z.string(), productId: z.string(), state: z.enum(TASK_STATES), dueAt: iso })
  .openapi("CalendarDueTask");

export const CalendarSchema = z
  .object({ from: iso, to: iso, deliveries: z.array(CalendarEntrySchema), dueTasks: z.array(CalendarDueTaskSchema) })
  .openapi("Calendar");

const ReadinessQuery = z.object({ socialAccountId: z.uuid().optional(), scheduledAt: iso.optional() });
const CalendarQuery = z.object({ from: iso, to: iso, productId: z.string().optional(), channel: z.enum(SOCIAL_CHANNELS).optional() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const serialiseDelivery = (d: DeliveryRow, account?: SocialAccountRow) => ({
  ...d,
  scheduledAt: d.scheduledAt?.toISOString() ?? null,
  nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
  sentAt: d.sentAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
  claimedUntil: undefined,
  account: account ? serialiseAccount(account) : undefined,
});

const serialiseAttempt = (a: typeof deliveryAttempt.$inferSelect) => ({
  ...a,
  startedAt: a.startedAt.toISOString(),
  finishedAt: a.finishedAt?.toISOString() ?? null,
});

const asProblem = (e: unknown): never => {
  if (e instanceof TransitionError) throw new ProblemError(e.status, "Transition refused", { detail: e.message });
  throw e;
};

const readableProducts = (p: Principal): string[] | null =>
  p.grants.some((g) => g.productId === null) ? null : [...new Set(p.grants.map((g) => g.productId!))];

// Policy input of a delivery route is its task: content.publish on the task.
const deliveryResource = async (c: { req: { param: (k: string) => string | undefined }; var: { db: Db } }): Promise<Resource | null> => {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) return null;
  const [d] = await c.var.db.select({ taskId: delivery.taskId }).from(delivery).where(eq(delivery.id, id));
  if (!d) return null;
  const s = await loadSnapshot(c.var.db, d.taskId);
  return s ? resourceOf(s) : null;
};

const deliveryOr404 = async (db: Db | Tx, id: string, lock = false): Promise<DeliveryRow> => {
  const q = db.select().from(delivery).where(eq(delivery.id, id));
  const [d] = lock ? await q.for("update") : await q;
  if (!d) throw new ProblemError(404, "Unknown delivery");
  return d;
};

const accountOr404 = async (db: Db | Tx, id: string): Promise<SocialAccountRow> => {
  const [a] = await db.select().from(socialAccount).where(eq(socialAccount.id, id));
  if (!a) throw new ProblemError(404, "Unknown social account");
  return a;
};

const versionMatches = (d: DeliveryRow, version: number) => {
  if (d.version !== version) throw new ProblemError(409, "Version conflict", { detail: `Current version is ${d.version}` });
};

const requireReady = async (
  s: TaskSnapshot,
  account: SocialAccountRow,
  scheduledAt: Date | null,
  principal: Principal,
  options: { ignoreWindow?: boolean } = {},
) => {
  const r = await checkReadiness(s, account, scheduledAt, principal, new Date());
  const failing = Object.entries(r.checks).find(([k, c]) => !c.ok && !(options.ignoreWindow && k === "window"));
  if (failing) {
    const [key, c] = failing;
    throw new ProblemError(key === "state" ? 409 : 422, "Not ready to publish", { detail: c.reason });
  }
};

// Content and approval the delivery was created for must still be current:
// a new version or a revoked approval make the delivery stale.
const requireCurrent = (s: TaskSnapshot, d: DeliveryRow) => {
  if (s.latestVersion?.id !== d.contentVersionId || s.latestApproval?.id !== d.approvalId) {
    throw new ProblemError(422, "Delivery is stale", { detail: "The content or its approval changed since this delivery was created; create a new one" });
  }
};

const moveTask = async (tx: Tx, s: TaskSnapshot, to: (typeof TASK_STATES)[number], actorId: string, reason: string) => {
  if (s.task.state === to) return;
  await requestTransition(tx, s, to, actorId, reason).catch(asProblem);
};

const PERMALINK_HOSTS: Record<(typeof SOCIAL_CHANNELS)[number], string[]> = {
  linkedin: ["linkedin.com"],
  x: ["x.com", "twitter.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  threads: ["threads.net", "threads.com"],
};

const hostAllowed = (url: string, channel: string): boolean => {
  const allowed = PERMALINK_HOSTS[channel as keyof typeof PERMALINK_HOSTS] ?? [];
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((h) => host === h || host.endsWith(`.${h}`));
};

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const common = { 401: problemResponse("No valid session"), 403: problemResponse("Not allowed"), 404: problemResponse("Unknown resource") };

const readinessRoute = createRoute({
  method: "get",
  path: "/tasks/{id}/publish-readiness",
  tags: ["publishing"],
  summary: "Why a task can or cannot be scheduled on an account at a date",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam, query: ReadinessQuery },
  responses: { 200: { description: "Readiness", content: { "application/json": { schema: PublishReadinessSchema } } }, ...common },
});

const listDeliveriesRoute = createRoute({
  method: "get",
  path: "/tasks/{id}/deliveries",
  tags: ["publishing"],
  summary: "Deliveries of a task, with their accounts",
  security,
  middleware: [authorize("content.read", taskResource)] as const,
  request: { params: idParam },
  responses: { 200: { description: "Deliveries", content: { "application/json": { schema: z.array(DeliverySchema) } } }, ...common },
});

const createDeliveryRoute = createRoute({
  method: "post",
  path: "/tasks/{id}/deliveries",
  tags: ["publishing"],
  summary: "Plan an approved task on a social account (Idempotency-Key, audited)",
  security,
  middleware: [authorize("content.publish", taskResource)] as const,
  request: { params: idParam, body: jsonBody(CreateDeliverySchema), headers: idempotencyHeader },
  responses: {
    200: { description: "Same delivery already exists", content: { "application/json": { schema: DeliverySchema } } },
    201: { description: "Created", content: { "application/json": { schema: DeliverySchema } } },
    400: problemResponse("Invalid body"),
    ...common,
    409: problemResponse("Task state or an existing delivery on this account"),
    422: problemResponse("Account, approval or date not acceptable"),
  },
});

const scheduleRoute = createRoute({
  method: "post",
  path: "/deliveries/{id}/schedule",
  tags: ["publishing"],
  summary: "Set or move the publication date of a draft or scheduled delivery",
  security,
  middleware: [authorize("content.publish", deliveryResource)] as const,
  request: { params: idParam, body: jsonBody(ScheduleDeliverySchema) },
  responses: {
    200: { description: "Delivery", content: { "application/json": { schema: DeliverySchema } } },
    400: problemResponse("Invalid body"),
    ...common,
    409: problemResponse("Delivery status, task state or version"),
    422: problemResponse("Date outside the window, stale content or inactive account"),
  },
});

const cancelRoute = createRoute({
  method: "post",
  path: "/deliveries/{id}/cancel",
  tags: ["publishing"],
  summary: "Cancel a delivery (recalls it from the provider when already handed off)",
  security,
  middleware: [authorize("content.publish", deliveryResource)] as const,
  request: { params: idParam, body: jsonBody(DeliveryVersionSchema) },
  responses: {
    200: { description: "Delivery", content: { "application/json": { schema: DeliverySchema } } },
    400: problemResponse("Invalid body"),
    ...common,
    409: problemResponse("Delivery is sending, sent or already cancelled; or version"),
    502: problemResponse("The provider refused to recall the post"),
  },
});

const retryRoute = createRoute({
  method: "post",
  path: "/deliveries/{id}/retry",
  tags: ["publishing"],
  summary: "Re-queue a failed delivery for the outbox",
  security,
  middleware: [authorize("content.publish", deliveryResource)] as const,
  request: { params: idParam, body: jsonBody(DeliveryVersionSchema) },
  responses: {
    200: { description: "Delivery", content: { "application/json": { schema: DeliverySchema } } },
    400: problemResponse("Invalid body"),
    ...common,
    409: problemResponse("Only a failed delivery can be retried; or version"),
    422: problemResponse("Approval no longer valid or account inactive"),
  },
});

const permalinkRoute = createRoute({
  method: "put",
  path: "/deliveries/{id}/permalink",
  tags: ["publishing"],
  summary: "Record the published post's URL when the provider did not return it",
  security,
  middleware: [authorize("content.publish", deliveryResource)] as const,
  request: { params: idParam, body: jsonBody(DeliveryPermalinkSchema) },
  responses: {
    200: { description: "Delivery", content: { "application/json": { schema: DeliverySchema } } },
    400: problemResponse("Invalid body"),
    ...common,
    409: problemResponse("Delivery not sent or handed off; or version"),
    422: problemResponse("URL host does not match the channel"),
  },
});

const attemptsRoute = createRoute({
  method: "get",
  path: "/deliveries/{id}/attempts",
  tags: ["publishing"],
  summary: "Provider attempts of a delivery",
  security,
  middleware: [authorize("content.read", deliveryResource)] as const,
  request: { params: idParam },
  responses: { 200: { description: "Attempts", content: { "application/json": { schema: z.array(DeliveryAttemptSchema) } } }, ...common },
});

const dispatchRoute = createRoute({
  method: "post",
  path: "/deliveries/dispatch",
  tags: ["publishing"],
  summary: "Run the outbox now (admin); same work as the cron",
  security,
  middleware: [authorize("delivery.dispatch", () => ({ type: "delivery" }))] as const,
  request: { body: jsonBody(DispatchRequestSchema) },
  responses: {
    200: { description: "Report", content: { "application/json": { schema: DispatchReportSchema } } },
    400: problemResponse("Invalid body"),
    ...common,
    422: problemResponse("A simulated clock needs the mock publisher"),
  },
});

const calendarRoute = createRoute({
  method: "get",
  path: "/calendar",
  tags: ["publishing"],
  summary: "Planned deliveries and due tasks in a window, scoped to the caller's products",
  security,
  middleware: [authorize("content.read", () => ({ type: "calendar" }))] as const,
  request: { query: CalendarQuery },
  responses: {
    200: { description: "Calendar", content: { "application/json": { schema: CalendarSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("No role"),
    422: problemResponse(`Window must be positive and at most ${MAX_CALENDAR_DAYS} days`),
  },
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const deliveryRoutes = new OpenAPIHono<AppEnv>()
  .openapi(readinessRoute, async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const db = c.var.db;
    const s = await snapshotOr404(db, id);
    const account = q.socialAccountId ? ((await db.select().from(socialAccount).where(eq(socialAccount.id, q.socialAccountId)))[0] ?? null) : null;
    const r = await checkReadiness(s, account, q.scheduledAt ? new Date(q.scheduledAt) : null, c.var.principal!, new Date());
    return c.json(r, 200);
  })

  .openapi(listDeliveriesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.var.db;
    await snapshotOr404(db, id);
    const rows = await db
      .select({ d: delivery, a: socialAccount })
      .from(delivery)
      .innerJoin(socialAccount, eq(socialAccount.id, delivery.socialAccountId))
      .where(eq(delivery.taskId, id))
      .orderBy(asc(delivery.createdAt));
    return c.json(rows.map((r) => serialiseDelivery(r.d, r.a)), 200);
  })

  .openapi(createDeliveryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const result = await idempotent(c, { id, ...body }, async () => {
      const account = await accountOr404(db, body.socialAccountId);
      const row = await audited(
        db,
        {
          actor: principal,
          action: "delivery.create",
          resource: { type: "task", id, productId: account.productId },
          requestId: c.var.requestId,
          details: { socialAccountId: account.id, channel: account.channel, scheduledAt: body.scheduledAt ?? null },
        },
        async (tx) => {
          const s = await snapshotOr404(tx as unknown as Db, id, true);
          await requireReady(s, account, scheduledAt, principal, { ignoreWindow: !scheduledAt });
          const live = await liveDeliveriesOf(tx, id);
          const existing = live.find((d) => d.socialAccountId === account.id);
          if (existing) {
            const sameDate = (existing.scheduledAt?.getTime() ?? null) === (scheduledAt?.getTime() ?? null);
            const current = existing.contentVersionId === s.latestVersion!.id && existing.approvalId === s.latestApproval!.id;
            if (sameDate && current) return { status: 200 as const, row: existing };
            throw new ProblemError(409, "Already planned", {
              detail: `Delivery ${existing.id} (${existing.status}) already targets this account; cancel it or move its date`,
            });
          }
          const prior = await tx
            .select({ id: delivery.id })
            .from(delivery)
            .where(and(eq(delivery.taskId, id), eq(delivery.socialAccountId, account.id)));
          const count = prior.length;
          const idempotencyKey = await sha256(`${id}:${account.id}:${s.latestVersion!.id}:${s.latestApproval!.id}:${count}`);
          const [inserted] = await tx
            .insert(delivery)
            .values({
              taskId: id,
              socialAccountId: account.id,
              contentVersionId: s.latestVersion!.id,
              approvalId: s.latestApproval!.id,
              scheduledAt,
              status: scheduledAt ? "scheduled" : "draft",
              idempotencyKey,
              createdBy: principal.userId,
            })
            .returning();
          if (scheduledAt) await moveTask(tx, s, "scheduled", principal.userId, `Delivery ${inserted!.id} scheduled`);
          return { status: 201 as const, row: inserted! };
        },
      );
      return { status: row.status, body: serialiseDelivery(row.row, account) };
    });
    return c.json(result.body, result.status);
  })

  .openapi(scheduleRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const scheduledAt = new Date(body.scheduledAt);
    const row = await audited(
      db,
      { actor: principal, action: "delivery.schedule", resource: { type: "delivery", id }, requestId: c.var.requestId, details: { scheduledAt: body.scheduledAt } },
      async (tx) => {
        const d = await deliveryOr404(tx, id, true);
        versionMatches(d, body.version);
        if (d.status !== "draft" && d.status !== "scheduled") {
          throw new ProblemError(409, "Cannot reschedule", { detail: `Delivery is ${d.status}; only a draft or scheduled delivery takes a date` });
        }
        const s = await snapshotOr404(tx as unknown as Db, d.taskId, true);
        const account = await accountOr404(tx, d.socialAccountId);
        requireCurrent(s, d);
        await requireReady(s, account, scheduledAt, principal);
        const [updated] = await tx
          .update(delivery)
          .set({ scheduledAt, status: "scheduled", nextRetryAt: null, version: d.version + 1, updatedAt: new Date() })
          .where(and(eq(delivery.id, id), eq(delivery.version, d.version)))
          .returning();
        if (!updated) throw new ProblemError(409, "Version conflict", { detail: "The delivery changed concurrently" });
        await moveTask(tx, s, "scheduled", principal.userId, `Delivery ${id} scheduled`);
        return updated;
      },
    );
    return c.json(serialiseDelivery(row), 200);
  })

  .openapi(cancelRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const current = await deliveryOr404(db, id);
    versionMatches(current, body.version);
    if (current.status === "sending" || current.status === "sent" || current.status === "cancelled") {
      throw new ProblemError(409, "Cannot cancel", { detail: `Delivery is ${current.status}` });
    }
    // Recall from the provider first, outside the transaction: a failed recall
    // leaves the delivery handed off, which is the truth.
    if (current.status === "handed_off" && current.externalId) {
      await c.var.integrations.publisher.cancel(current.externalId).catch((e: unknown) => {
        throw new ProblemError(502, "Provider refused the recall", { detail: e instanceof Error ? e.message : String(e) });
      });
    }
    const row = await audited(
      db,
      { actor: principal, action: "delivery.cancel", resource: { type: "delivery", id }, requestId: c.var.requestId, details: { from: current.status } },
      async (tx) => {
        const d = await deliveryOr404(tx, id, true);
        versionMatches(d, body.version);
        const [updated] = await tx
          .update(delivery)
          .set({ status: "cancelled", nextRetryAt: null, claimedUntil: null, version: d.version + 1, updatedAt: new Date() })
          .where(and(eq(delivery.id, id), eq(delivery.version, d.version)))
          .returning();
        if (!updated) throw new ProblemError(409, "Version conflict", { detail: "The delivery changed concurrently" });
        await settleTask(tx, d.taskId, `Delivery ${id} cancelled`);
        // A failed task whose last failed delivery is cancelled goes back to approved.
        const s = await loadSnapshot(tx, d.taskId, true);
        if (s && s.task.state === "failed") {
          const remaining = await liveDeliveriesOf(tx, d.taskId);
          if (!remaining.some((r) => r.status === "failed")) {
            await applyTransition(tx, s, "approved", principal.userId, `Delivery ${id} cancelled`).catch(asProblem);
          }
        }
        return updated;
      },
    );
    await reconcileTaskAlerts(c.var.db, row.taskId, c.var.principal!, c.var.requestId);
    return c.json(serialiseDelivery(row), 200);
  })

  .openapi(retryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const row = await audited(
      db,
      { actor: principal, action: "delivery.retry", resource: { type: "delivery", id }, requestId: c.var.requestId },
      async (tx) => {
        const d = await deliveryOr404(tx, id, true);
        versionMatches(d, body.version);
        if (d.status !== "failed") throw new ProblemError(409, "Cannot retry", { detail: `Delivery is ${d.status}; only a failed delivery is retried` });
        const s = await snapshotOr404(tx as unknown as Db, d.taskId, true);
        const account = await accountOr404(tx, d.socialAccountId);
        requireCurrent(s, d);
        // The task is failed at this point: readiness looks at approval, account and permission.
        const r = await checkReadiness(s, account, d.scheduledAt, principal, new Date(), { forDispatch: true });
        const blocking = Object.entries(r.checks).find(([k, ch]) => !ch.ok && k !== "state");
        if (blocking) throw new ProblemError(422, "Not ready to publish", { detail: blocking[1].reason });
        const scheduledAt = d.scheduledAt && d.scheduledAt.getTime() > Date.now() ? d.scheduledAt : new Date();
        const [updated] = await tx
          .update(delivery)
          .set({
            status: "scheduled",
            scheduledAt,
            maxAttempts: d.attempts + 3,
            nextRetryAt: null,
            lastError: null,
            claimedUntil: null,
            version: d.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(delivery.id, id), eq(delivery.version, d.version)))
          .returning();
        if (!updated) throw new ProblemError(409, "Version conflict", { detail: "The delivery changed concurrently" });
        let snapshot = s;
        if (snapshot.task.state === "failed") {
          await applyTransition(tx, snapshot, "approved", principal.userId, `Delivery ${id} retried`).catch(asProblem);
          snapshot = (await loadSnapshot(tx, d.taskId, true))!;
        }
        await moveTask(tx, snapshot, "scheduled", principal.userId, `Delivery ${id} retried`);
        return updated;
      },
    );
    await reconcileTaskAlerts(c.var.db, row.taskId, c.var.principal!, c.var.requestId);
    return c.json(serialiseDelivery(row), 200);
  })

  .openapi(permalinkRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const row = await audited(
      db,
      { actor: principal, action: "delivery.permalink", resource: { type: "delivery", id }, requestId: c.var.requestId, details: { url: body.url } },
      async (tx) => {
        const d = await deliveryOr404(tx, id, true);
        versionMatches(d, body.version);
        if (d.status !== "sent" && d.status !== "handed_off") {
          throw new ProblemError(409, "No post to link", { detail: `Delivery is ${d.status}` });
        }
        const account = await accountOr404(tx, d.socialAccountId);
        if (!hostAllowed(body.url, account.channel)) {
          throw new ProblemError(422, "URL does not match the channel", { detail: `Expected an https URL on ${PERMALINK_HOSTS[account.channel as keyof typeof PERMALINK_HOSTS]?.join(" or ")}` });
        }
        if (d.permalink === body.url) return d;
        const [updated] = await tx
          .update(delivery)
          .set({ permalink: body.url, version: d.version + 1, updatedAt: new Date() })
          .where(and(eq(delivery.id, id), eq(delivery.version, d.version)))
          .returning();
        if (!updated) throw new ProblemError(409, "Version conflict", { detail: "The delivery changed concurrently" });
        return updated;
      },
    );
    return c.json(serialiseDelivery(row), 200);
  })

  .openapi(attemptsRoute, async (c) => {
    const { id } = c.req.valid("param");
    await deliveryOr404(c.var.db, id);
    const rows = await c.var.db.select().from(deliveryAttempt).where(eq(deliveryAttempt.deliveryId, id)).orderBy(asc(deliveryAttempt.n));
    return c.json(rows.map(serialiseAttempt), 200);
  })

  .openapi(dispatchRoute, async (c) => {
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    if (body.now && integrationModes(c.env).publisher !== "mock") {
      throw new ProblemError(422, "Simulated clock refused", { detail: "A simulated clock is only accepted with the mock publisher" });
    }
    const now = body.now ? new Date(body.now) : undefined;
    const report = await dispatch({
      db: c.var.db,
      publisher: c.var.integrations.publisher,
      trigger: "manual",
      ...(now ? { now: () => now } : {}),
      ...dispatchTuning(c.env),
    });
    await recordAudit(c.var.db, {
      actor: principal,
      action: "delivery.dispatch",
      outcome: "allowed",
      resource: { type: "delivery" },
      requestId: c.var.requestId,
      details: { ...report, simulatedNow: body.now ?? null },
    });
    return c.json(report, 200);
  })

  .openapi(calendarRoute, async (c) => {
    const q = c.req.valid("query");
    const from = new Date(q.from);
    const to = new Date(q.to);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days <= 0 || days > MAX_CALENDAR_DAYS) {
      throw new ProblemError(422, "Invalid window", { detail: `"to" must be after "from" and within ${MAX_CALENDAR_DAYS} days (publication window: ${PUBLISH_WINDOW_DAYS} days)` });
    }
    const db = c.var.db;
    const scope = readableProducts(c.var.principal!);
    const scopeOf = (col: typeof task.productId) => (scope ? inArray(col, scope.length ? scope : ["-"]) : undefined);
    const deliveryWhere = [
      gte(delivery.scheduledAt, from),
      lt(delivery.scheduledAt, to),
      ne(delivery.status, "cancelled"),
      scopeOf(task.productId),
      q.productId ? eq(task.productId, q.productId) : undefined,
      q.channel ? eq(socialAccount.channel, q.channel) : undefined,
    ].filter((x): x is NonNullable<typeof x> => x !== undefined);
    const rows = await db
      .select({ d: delivery, a: socialAccount, t: { id: task.id, title: task.title, productId: task.productId } })
      .from(delivery)
      .innerJoin(socialAccount, eq(socialAccount.id, delivery.socialAccountId))
      .innerJoin(task, eq(task.id, delivery.taskId))
      .where(and(...deliveryWhere))
      .orderBy(asc(delivery.scheduledAt));
    const taskWhere = [gte(task.dueAt, from), lt(task.dueAt, to), scopeOf(task.productId), q.productId ? eq(task.productId, q.productId) : undefined].filter(
      (x): x is NonNullable<typeof x> => x !== undefined,
    );
    const due = await db
      .select({ id: task.id, title: task.title, productId: task.productId, state: task.state, dueAt: task.dueAt })
      .from(task)
      .where(and(...taskWhere))
      .orderBy(asc(task.dueAt));
    return c.json(
      {
        from: from.toISOString(),
        to: to.toISOString(),
        deliveries: rows.map((r) => ({
          id: r.d.id,
          taskId: r.d.taskId,
          taskTitle: r.t.title,
          productId: r.t.productId,
          channel: r.a.channel as (typeof SOCIAL_CHANNELS)[number],
          accountHandle: r.a.handle,
          scheduledAt: r.d.scheduledAt!.toISOString(),
          status: r.d.status,
          lastError: r.d.lastError,
          permalink: r.d.permalink,
        })),
        dueTasks: due.map((t) => ({ ...t, dueAt: t.dueAt!.toISOString() })),
      },
      200,
    );
  });
