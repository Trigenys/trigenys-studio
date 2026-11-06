import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { recordAudit } from "../auth/audit.ts";
import type { Principal } from "../auth/rbac.ts";
import type { Db, Tx } from "../db/client.ts";
import {
  alert,
  auditEvent,
  delivery,
  notificationDispatch,
  notificationPreference,
  roleAssignment,
  socialAccount,
  task,
  taskTransition,
  user,
  type AlertKind,
  type TaskState,
} from "../db/schema.ts";
import {
  ALERT_RULES,
  DEFAULT_ALERT_TUNING,
  PRIORITY_RANK,
  deliveryAlert,
  taskAlert,
  type AlertTuning,
  type DeliveryFacts,
  type DesiredAlert,
  type TaskFacts,
} from "./rules.ts";

// The single writer of the `alert` table (ADR 0011). One transaction:
// facts → desired alerts → diff against the unresolved ones → minimal
// reconciliation. A second run over unchanged data writes nothing. Alerts
// nobody is responsible for any more are resolved here, never by hand.
//
// E-mails are queued in `notification_dispatch` for the audience of the
// alert whose effective preference is `immediate`, on opening and on
// escalation only. The very first run of a database (no `alert.reconcile`
// audit yet) opens alerts silently: a backlog is not news.

export type ReconcileOptions = {
  db: Db;
  now?: Date;
  tuning?: AlertTuning;
  // Restrict the pass to these tasks (and their deliveries) — used right
  // after a transition, an approval or a delivery change.
  taskIds?: string[];
  actor?: Principal | null;
  requestId?: string;
};

export type ReconcileReport = { opened: number; updated: number; escalated: number; resolved: number; queued: number };

type AlertRow = typeof alert.$inferSelect;

const epochToDate = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(Number(v) * 1000));

// jsonb reorders keys: compare facts through a canonical form.
const canonical = (v: unknown): string => JSON.stringify(sortKeys(v));
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;

async function loadTaskFacts(tx: Tx, taskIds?: string[]): Promise<TaskFacts[]> {
  // Written with qualified names: in a single-table select drizzle strips the
  // table from column references, and `"task_id" = "id"` would then compare a
  // row of the subquery with itself.
  const awaiting = sql<number | null>`(select extract(epoch from max(tt.created_at)) from task_transition tt where tt.task_id = "task"."id" and tt.to_state = 'awaiting_approval')`;
  const activity = sql<number>`greatest(
    extract(epoch from "task"."updated_at"),
    coalesce((select extract(epoch from max(cv.created_at)) from content_version cv where cv.task_id = "task"."id"), 0),
    coalesce((select extract(epoch from max(cm.created_at)) from comment cm where cm.task_id = "task"."id"), 0)
  )`;
  const rows = await tx
    .select({
      id: task.id,
      productId: task.productId,
      title: task.title,
      type: task.type,
      state: task.state,
      dueAt: task.dueAt,
      awaitingSince: awaiting,
      lastActivityAt: activity,
    })
    .from(task)
    .where(taskIds ? inArray(task.id, taskIds) : undefined);
  return rows.map((r) => ({
    ...r,
    state: r.state as TaskState,
    awaitingSince: epochToDate(r.awaitingSince),
    lastActivityAt: epochToDate(r.lastActivityAt)!,
  }));
}

async function loadDeliveryFacts(tx: Tx, taskIds?: string[]): Promise<DeliveryFacts[]> {
  return tx
    .select({
      id: delivery.id,
      taskId: delivery.taskId,
      productId: task.productId,
      taskTitle: task.title,
      channel: socialAccount.channel,
      status: delivery.status,
      lastError: delivery.lastError,
    })
    .from(delivery)
    .innerJoin(task, eq(task.id, delivery.taskId))
    .innerJoin(socialAccount, eq(socialAccount.id, delivery.socialAccountId))
    .where(taskIds ? inArray(delivery.taskId, taskIds) : undefined);
}

async function hasReconciledBefore(tx: Tx): Promise<boolean> {
  const [row] = await tx.select({ id: auditEvent.id }).from(auditEvent).where(eq(auditEvent.action, "alert.reconcile")).limit(1);
  return row !== undefined;
}

// Queue one e-mail per recipient of the alert's audience on its product
// whose effective preference is `immediate`. The dedup key makes a repeat
// of the same (alert, user, priority) a no-op.
async function queueEmails(tx: Tx, row: AlertRow, now: Date): Promise<number> {
  const rule = ALERT_RULES[row.kind as AlertKind];
  const recipients = await tx
    .selectDistinct({ userId: user.id, email: user.email, preference: notificationPreference.email })
    .from(roleAssignment)
    .innerJoin(user, eq(user.id, roleAssignment.userId))
    .leftJoin(notificationPreference, and(eq(notificationPreference.userId, user.id), eq(notificationPreference.kind, row.kind)))
    .where(
      and(
        inArray(roleAssignment.role, [...rule.audience]),
        sql`(${roleAssignment.productId} is null or ${roleAssignment.productId} = ${row.productId})`,
      ),
    );
  let queued = 0;
  for (const r of recipients) {
    if (!r.email) continue;
    if ((r.preference ?? rule.defaultEmail) !== "immediate") continue;
    const inserted = await tx
      .insert(notificationDispatch)
      .values({
        alertId: row.id,
        userId: r.userId,
        dedupKey: `${row.id}:${r.userId}:email:${row.priority}`,
        priority: row.priority,
        nextRetryAt: now,
      })
      .onConflictDoNothing({ target: notificationDispatch.dedupKey })
      .returning({ id: notificationDispatch.id });
    queued += inserted.length;
  }
  return queued;
}

export async function reconcileAlerts(options: ReconcileOptions): Promise<ReconcileReport> {
  const now = options.now ?? new Date();
  const tuning = options.tuning ?? DEFAULT_ALERT_TUNING;
  const report: ReconcileReport = { opened: 0, updated: 0, escalated: 0, resolved: 0, queued: 0 };
  const scope = options.taskIds && options.taskIds.length > 0 ? options.taskIds : undefined;
  if (options.taskIds && options.taskIds.length === 0) return report;

  await options.db.transaction(async (tx) => {
    const bootstrap = !(await hasReconciledBefore(tx));
    const desired = new Map<string, DesiredAlert>();
    for (const t of await loadTaskFacts(tx, scope)) {
      const d = taskAlert(t, now, tuning);
      if (d) desired.set(d.dedupKey, d);
    }
    for (const dl of await loadDeliveryFacts(tx, scope)) {
      const d = deliveryAlert(dl);
      if (d) desired.set(d.dedupKey, d);
    }

    const existing = await tx
      .select()
      .from(alert)
      .where(scope ? and(ne(alert.state, "resolved"), inArray(alert.taskId, scope)) : ne(alert.state, "resolved"));
    const byKey = new Map(existing.map((a) => [a.dedupKey, a]));

    for (const [key, d] of desired) {
      const current = byKey.get(key);
      if (!current) {
        const [row] = await tx
          .insert(alert)
          .values({ ...d, firstSeenAt: now })
          .onConflictDoNothing({ target: alert.dedupKey, where: sql`state <> 'resolved'` })
          .returning();
        if (!row) continue;
        report.opened += 1;
        if (!bootstrap) report.queued += await queueEmails(tx, row, now);
        continue;
      }
      const priorityChanged = current.priority !== d.priority;
      const textChanged = current.title !== d.title || current.detail !== d.detail || canonical(current.facts) !== canonical(d.facts);
      if (!priorityChanged && !textChanged) continue;
      const escalated = priorityChanged && PRIORITY_RANK[d.priority] > PRIORITY_RANK[current.priority];
      const patch = {
        priority: d.priority,
        title: d.title,
        detail: d.detail,
        facts: d.facts,
        version: current.version + 1,
        // An escalation is news again: back to open, to be acknowledged anew.
        ...(escalated ? { state: "open" as const, acknowledgedBy: null, acknowledgedAt: null } : {}),
      };
      const [row] = await tx.update(alert).set(patch).where(eq(alert.id, current.id)).returning();
      if (escalated) {
        report.escalated += 1;
        if (row && !bootstrap) report.queued += await queueEmails(tx, row, now);
      } else {
        report.updated += 1;
      }
    }

    const gone = existing.filter((a) => !desired.has(a.dedupKey));
    if (gone.length > 0) {
      await tx
        .update(alert)
        .set({ state: "resolved", resolvedAt: now, resolution: "La condition n'est plus remplie.", version: sql`${alert.version} + 1` })
        .where(inArray(alert.id, gone.map((a) => a.id)));
      report.resolved += gone.length;
    }

    const changed = report.opened + report.updated + report.escalated + report.resolved > 0;
    if (changed || bootstrap) {
      await recordAudit(tx, {
        actor: options.actor ?? null,
        action: "alert.reconcile",
        resource: { type: "alert" },
        outcome: "allowed",
        requestId: options.requestId,
        details: { ...report, bootstrap, scope: scope ?? "all" },
      });
    }
  });
  return report;
}

// Best-effort pass over one task right after a change committed. A failure
// here is logged and never turns a successful request into an error: the
// cron pass catches up within minutes.
export async function reconcileTaskAlerts(db: Db, taskId: string, actor: Principal | null, requestId?: string): Promise<void> {
  try {
    await reconcileAlerts({ db, taskIds: [taskId], actor, requestId });
  } catch (e) {
    console.error("alert reconcile", taskId, e instanceof Error ? e.message : e);
  }
}
