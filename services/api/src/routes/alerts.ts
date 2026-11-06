import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { dispatchNotifications } from "../alerts/notify.ts";
import { reconcileAlerts } from "../alerts/reconcile.ts";
import { ALERT_RULES } from "../alerts/rules.ts";
import { audited } from "../auth/audit.ts";
import { authorize, requireSession } from "../auth/middleware.ts";
import { hasRole, readableProducts, type Principal } from "../auth/rbac.ts";
import {
  ALERT_KINDS,
  ALERT_PRIORITIES,
  ALERT_STATES,
  NOTIFICATION_EMAIL_MODES,
  TASK_STATES,
  alert,
  notificationDispatch,
  notificationPreference,
  task,
  type AlertKind,
} from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { idempotent } from "../idempotency.ts";
import { ProblemError } from "../problem.ts";
import { alertTuning, webAppUrl } from "../publishing/scheduled.ts";
import { idParam, idempotencyHeader, jsonBody, problemResponse, security } from "./tasks.ts";

// Alerts inbox (ADR 0011): read, acknowledge, run the reconciliation by
// hand (admin), and the caller's e-mail preferences. Alerts are never
// resolved through the API: the reconciler closes them when the condition
// is gone.

const iso = z.iso.datetime();

const EMAIL_STATUSES = ["none", "pending", "sent", "failed"] as const;

export const AlertSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(ALERT_KINDS),
    priority: z.enum(ALERT_PRIORITIES),
    state: z.enum(ALERT_STATES),
    productId: z.string(),
    taskId: z.uuid(),
    taskTitle: z.string(),
    taskState: z.enum(TASK_STATES),
    deliveryId: z.uuid().nullable(),
    title: z.string(),
    detail: z.string(),
    facts: z.record(z.string(), z.unknown()),
    firstSeenAt: iso,
    acknowledgedBy: z.string().nullable(),
    acknowledgedAt: iso.nullable(),
    resolvedAt: iso.nullable(),
    resolution: z.string().nullable(),
    emailStatus: z.enum(EMAIL_STATUSES),
    version: z.number().int(),
  })
  .openapi("Alert");

const ListAlertsQuery = z.object({
  state: z.enum(["active", ...ALERT_STATES]).default("active"),
  priority: z.enum(ALERT_PRIORITIES).optional(),
  productId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const NotificationPreferenceSchema = z
  .object({
    kind: z.enum(ALERT_KINDS),
    email: z.enum(NOTIFICATION_EMAIL_MODES),
    source: z.enum(["default", "user"]),
  })
  .openapi("NotificationPreference");

const UpdatePreferencesSchema = z
  .object({
    preferences: z.array(z.object({ kind: z.enum(ALERT_KINDS), email: z.enum(NOTIFICATION_EMAIL_MODES) })).min(1).max(ALERT_KINDS.length),
  })
  .openapi("UpdateNotificationPreferences");

export const ReconcileReportSchema = z
  .object({
    reconcile: z.object({ opened: z.number().int(), updated: z.number().int(), escalated: z.number().int(), resolved: z.number().int(), queued: z.number().int() }),
    notify: z.object({ claimed: z.number().int(), sent: z.number().int(), retried: z.number().int(), failed: z.number().int(), skipped: z.number().int() }),
  })
  .openapi("AlertReconcileReport");

const RESOLVED_WINDOW_DAYS = 30;

const listRoute = createRoute({
  method: "get",
  path: "/alerts",
  tags: ["alerts"],
  summary: "Alerts the caller is responsible for (active by default, resolved ones over the last 30 days)",
  security,
  middleware: [authorize("alert.read", () => ({ type: "alert" }))] as const,
  request: { query: ListAlertsQuery },
  responses: {
    200: { description: "Alerts, highest priority first", content: { "application/json": { schema: z.array(AlertSchema) } } },
    401: problemResponse("No valid session"),
    403: problemResponse("No role"),
  },
});

const alertResource = async (c: { req: { param: (k: string) => string | undefined }; var: { db: AppEnv["Variables"]["db"] } }) => {
  const [row] = await c.var.db.select({ productId: alert.productId }).from(alert).where(eq(alert.id, c.req.param("id")!));
  return { type: "alert", id: c.req.param("id"), productId: row?.productId ?? null };
};

const acknowledgeRoute = createRoute({
  method: "post",
  path: "/alerts/{id}/acknowledge",
  tags: ["alerts"],
  summary: "Acknowledge an alert (audited; a second call is a no-op)",
  security,
  middleware: [authorize("alert.acknowledge", alertResource)] as const,
  request: { params: idParam },
  responses: {
    200: { description: "Acknowledged", content: { "application/json": { schema: AlertSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not in the audience of the alert"),
    404: problemResponse("Unknown alert"),
    409: problemResponse("Already resolved"),
  },
});

const reconcileRoute = createRoute({
  method: "post",
  path: "/alerts/reconcile",
  tags: ["alerts"],
  summary: "Run the alert reconciliation and send queued e-mails now (admin, idempotent)",
  security,
  middleware: [authorize("alert.reconcile", () => ({ type: "alert" }))] as const,
  request: { headers: idempotencyHeader },
  responses: {
    200: { description: "Report", content: { "application/json": { schema: ReconcileReportSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    422: problemResponse("Idempotency-Key reused for a different request"),
  },
});

const getPreferences = createRoute({
  method: "get",
  path: "/me/notification-preferences",
  tags: ["alerts"],
  summary: "E-mail preference of the caller per alert kind (defaults when unset)",
  security,
  middleware: [requireSession] as const,
  responses: {
    200: { description: "Preferences", content: { "application/json": { schema: z.array(NotificationPreferenceSchema) } } },
    401: problemResponse("No valid session"),
  },
});

const patchPreferences = createRoute({
  method: "patch",
  path: "/me/notification-preferences",
  tags: ["alerts"],
  summary: "Change the caller's e-mail preferences (audited; unchanged values write nothing)",
  security,
  middleware: [requireSession] as const,
  request: { body: jsonBody(UpdatePreferencesSchema) },
  responses: {
    200: { description: "Preferences", content: { "application/json": { schema: z.array(NotificationPreferenceSchema) } } },
    400: problemResponse("Unknown kind or mode"),
    401: problemResponse("No valid session"),
  },
});

type AlertRow = typeof alert.$inferSelect;
type EmailStatus = (typeof EMAIL_STATUSES)[number];

const inAudience = (p: Principal, row: { kind: string; productId: string }) => hasRole(p, ALERT_RULES[row.kind as AlertKind].audience, row.productId);

async function emailStatuses(db: AppEnv["Variables"]["db"], alertIds: string[]): Promise<Map<string, EmailStatus>> {
  const out = new Map<string, EmailStatus>();
  if (alertIds.length === 0) return out;
  const rows = await db
    .select({ alertId: notificationDispatch.alertId, status: notificationDispatch.status })
    .from(notificationDispatch)
    .where(inArray(notificationDispatch.alertId, alertIds));
  const rank: Record<EmailStatus, number> = { none: 0, sent: 1, pending: 2, failed: 3 };
  for (const r of rows) {
    const s: EmailStatus = r.status === "failed" ? "failed" : r.status === "pending" || r.status === "sending" ? "pending" : r.status === "sent" ? "sent" : "none";
    const current = out.get(r.alertId) ?? "none";
    if (rank[s] > rank[current]) out.set(r.alertId, s);
  }
  return out;
}

const serialise = (a: AlertRow, t: { title: string; state: string }, emailStatus: EmailStatus) => ({
  ...a,
  kind: a.kind as AlertKind,
  taskTitle: t.title,
  taskState: t.state as (typeof TASK_STATES)[number],
  firstSeenAt: a.firstSeenAt.toISOString(),
  acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
  emailStatus,
});

async function loadOne(db: AppEnv["Variables"]["db"], id: string) {
  const [row] = await db
    .select({ alert, task: { title: task.title, state: task.state } })
    .from(alert)
    .innerJoin(task, eq(task.id, alert.taskId))
    .where(eq(alert.id, id));
  return row ?? null;
}

async function listPreferences(db: AppEnv["Variables"]["db"], userId: string) {
  const rows = await db.select().from(notificationPreference).where(eq(notificationPreference.userId, userId));
  const byKind = new Map(rows.map((r) => [r.kind, r.email]));
  return ALERT_KINDS.map((kind) => {
    const chosen = byKind.get(kind);
    return { kind, email: chosen ?? ALERT_RULES[kind].defaultEmail, source: chosen ? ("user" as const) : ("default" as const) };
  });
}

export const alertRoutes = new OpenAPIHono<AppEnv>()
  .openapi(listRoute, async (c) => {
    const q = c.req.valid("query");
    const principal = c.var.principal!;
    const db = c.var.db;
    const scope = readableProducts(principal);
    const conditions = [
      q.state === "active" ? inArray(alert.state, ["open", "acknowledged"]) : eq(alert.state, q.state),
      q.state === "resolved" ? gte(alert.resolvedAt, new Date(Date.now() - RESOLVED_WINDOW_DAYS * 86_400_000)) : undefined,
      q.priority ? eq(alert.priority, q.priority) : undefined,
      q.productId ? eq(alert.productId, q.productId) : undefined,
      scope ? inArray(alert.productId, scope) : undefined,
    ];
    const rows = await db
      .select({ alert, task: { title: task.title, state: task.state } })
      .from(alert)
      .innerJoin(task, eq(task.id, alert.taskId))
      .where(and(...conditions))
      .orderBy(asc(alert.priority), asc(alert.firstSeenAt))
      .limit(q.limit * 4);
    const visible = rows.filter((r) => inAudience(principal, r.alert)).slice(0, q.limit);
    const statuses = await emailStatuses(db, visible.map((r) => r.alert.id));
    return c.json(
      visible.map((r) => serialise(r.alert, r.task, statuses.get(r.alert.id) ?? "none")),
      200,
    );
  })
  .openapi(acknowledgeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const principal = c.var.principal!;
    const db = c.var.db;
    const current = await loadOne(db, id);
    if (!current) throw new ProblemError(404, "Unknown alert");
    if (!inAudience(principal, current.alert)) {
      throw new ProblemError(403, "Forbidden", { detail: `Acknowledging a ${current.alert.kind} alert requires one of: ${ALERT_RULES[current.alert.kind as AlertKind].audience.join(", ")}` });
    }
    if (current.alert.state === "resolved") throw new ProblemError(409, "Already resolved", { detail: "The condition is gone; nothing to acknowledge" });
    const statuses = await emailStatuses(db, [id]);
    if (current.alert.state === "acknowledged") return c.json(serialise(current.alert, current.task, statuses.get(id) ?? "none"), 200);
    const row = await audited(
      db,
      {
        actor: principal,
        action: "alert.acknowledge",
        resource: { type: "alert", id, productId: current.alert.productId },
        requestId: c.var.requestId,
        details: { kind: current.alert.kind, priority: current.alert.priority, version: current.alert.version },
      },
      async (tx) => {
        const [updated] = await tx
          .update(alert)
          .set({ state: "acknowledged", acknowledgedBy: principal.userId, acknowledgedAt: new Date(), version: current.alert.version + 1 })
          .where(and(eq(alert.id, id), eq(alert.version, current.alert.version), eq(alert.state, "open")))
          .returning();
        if (!updated) throw new ProblemError(409, "The alert changed concurrently");
        return updated;
      },
    );
    return c.json(serialise(row, current.task, statuses.get(id) ?? "none"), 200);
  })
  .openapi(reconcileRoute, async (c) => {
    const principal = c.var.principal!;
    const db = c.var.db;
    const result = await idempotent(c, {}, async () => {
      const reconcile = await reconcileAlerts({ db, tuning: alertTuning(c.env), actor: principal, requestId: c.var.requestId });
      const notify = await dispatchNotifications({ db, mailer: c.var.integrations.email, webAppUrl: webAppUrl(c.env) });
      return { status: 200 as const, body: { reconcile, notify } };
    });
    return c.json(result.body, result.status);
  })
  .openapi(getPreferences, async (c) => c.json(await listPreferences(c.var.db, c.var.principal!.userId), 200))
  .openapi(patchPreferences, async (c) => {
    const body = c.req.valid("json");
    const principal = c.var.principal!;
    const db = c.var.db;
    const current = await listPreferences(db, principal.userId);
    const wanted = new Map(body.preferences.map((p) => [p.kind, p.email]));
    const changes = current.filter((p) => wanted.has(p.kind) && wanted.get(p.kind) !== p.email).map((p) => ({ kind: p.kind, from: p.email, to: wanted.get(p.kind)! }));
    if (changes.length === 0) return c.json(current, 200);
    await audited(
      db,
      {
        actor: principal,
        action: "notification.preferences",
        resource: { type: "notification_preference", id: principal.userId },
        requestId: c.var.requestId,
        details: { changes },
      },
      async (tx) => {
        for (const ch of changes) {
          await tx
            .insert(notificationPreference)
            .values({ userId: principal.userId, kind: ch.kind, email: ch.to })
            .onConflictDoUpdate({
              target: [notificationPreference.userId, notificationPreference.kind],
              set: { email: ch.to, updatedAt: sql`now()` },
            });
        }
      },
    );
    return c.json(await listPreferences(db, principal.userId), 200);
  });
