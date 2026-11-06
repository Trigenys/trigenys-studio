import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { recordAudit } from "../auth/audit.ts";
import type { Db, Tx } from "../db/client.ts";
import { alert, notificationDispatch, task, user, type AlertKind, type AlertPriority } from "../db/schema.ts";
import type { Mailer } from "../integrations/types.ts";
import { backoffSeconds } from "../publishing/dispatch.ts";
import { PRIORITY_LABELS } from "./rules.ts";

// At-most-once e-mail outbox for alerts (ADR 0011), in the three phases of
// the publishing outbox: claim under a row lock with a lease, send with no
// transaction open, record. A row found `sending` past its lease may have
// reached the provider: it is failed as uncertain and never sent again.
// Every attempt, skip or failure leaves an audit row without the address.

export type NotifyOptions = {
  db: Db;
  mailer: Mailer;
  now?: () => Date;
  // Base of the task links in the e-mails; without it nothing is sent.
  webAppUrl: string | null;
  limit?: number;
  leaseMinutes?: number;
};

export type NotifyReport = { claimed: number; sent: number; retried: number; failed: number; skipped: number };

type DispatchRow = typeof notificationDispatch.$inferSelect;

type Claimed = {
  row: DispatchRow;
  to: string;
  subject: string;
  text: string;
};

export const alertPath = (kind: AlertKind, taskId: string) => `/tasks/${taskId}${kind === "publication_failed" ? "#publication" : ""}`;

const audit = (tx: Tx, row: DispatchRow, result: string, extra: Record<string, unknown> = {}) =>
  recordAudit(tx, {
    actor: null,
    action: "notification.send",
    resource: { type: "notification", id: row.id },
    outcome: "allowed",
    details: { dispatchId: row.id, alertId: row.alertId, userId: row.userId, attempt: row.attempts, result, ...extra },
  });

export async function dispatchNotifications(options: NotifyOptions): Promise<NotifyReport> {
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 25;
  const leaseMs = (options.leaseMinutes ?? 5) * 60_000;
  const report: NotifyReport = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  const { db, mailer } = options;

  const t = now();
  const candidates = await db
    .select({ id: notificationDispatch.id })
    .from(notificationDispatch)
    .where(
      or(
        and(eq(notificationDispatch.status, "pending"), or(isNull(notificationDispatch.nextRetryAt), lte(notificationDispatch.nextRetryAt, t))),
        and(eq(notificationDispatch.status, "sending"), lt(notificationDispatch.claimedUntil, t)),
      ),
    )
    .orderBy(asc(notificationDispatch.priority), asc(notificationDispatch.createdAt))
    .limit(limit);

  for (const { id } of candidates) {
    const claimed = await db.transaction((tx) => claim(tx, id, now(), leaseMs, options.webAppUrl, report));
    if (!claimed) continue;
    report.claimed += 1;

    let error: string | null = null;
    try {
      await mailer.send({ to: claimed.to, template: "alert", subject: claimed.subject, text: claimed.text });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    await db.transaction((tx) => record(tx, claimed.row, error, mailer.name, now(), report));
  }
  return report;
}

async function claim(tx: Tx, id: string, now: Date, leaseMs: number, webAppUrl: string | null, report: NotifyReport): Promise<Claimed | null> {
  const [row] = await tx.select().from(notificationDispatch).where(eq(notificationDispatch.id, id)).for("update", { skipLocked: true });
  if (!row) return null;
  const due = row.status === "pending" && (row.nextRetryAt === null || row.nextRetryAt.getTime() <= now.getTime());
  const stuck = row.status === "sending" && row.claimedUntil !== null && row.claimedUntil.getTime() < now.getTime();
  if (!due && !stuck) return null;

  if (stuck) {
    const reason = "Remise incertaine : le bail d'envoi a expiré sans compte rendu ; le message n'est pas renvoyé.";
    await tx.update(notificationDispatch).set({ status: "failed", lastError: reason, claimedUntil: null }).where(eq(notificationDispatch.id, id));
    await audit(tx, row, "uncertain", { error: reason });
    report.failed += 1;
    return null;
  }

  const skip = async (reason: string, result: string) => {
    await tx.update(notificationDispatch).set({ status: "skipped", lastError: reason, claimedUntil: null }).where(eq(notificationDispatch.id, id));
    await audit(tx, row, result, { error: reason });
    report.skipped += 1;
    return null;
  };

  const [a] = await tx
    .select({ kind: alert.kind, priority: alert.priority, state: alert.state, title: alert.title, detail: alert.detail, taskId: alert.taskId, taskTitle: task.title })
    .from(alert)
    .innerJoin(task, eq(task.id, alert.taskId))
    .where(eq(alert.id, row.alertId));
  if (!a) return skip("L'alerte n'existe plus.", "skipped");
  if (a.state !== "open") return skip(`L'alerte a été ${a.state === "resolved" ? "résolue" : "acquittée"} avant l'envoi.`, "skipped");
  if (!webAppUrl) return skip("WEB_APP_URL n'est pas configurée : définir la var du Worker pour envoyer les liens.", "skipped");
  const [u] = await tx.select({ email: user.email }).from(user).where(eq(user.id, row.userId));
  if (!u?.email) return skip("Le destinataire n'a pas d'adresse e-mail.", "skipped");

  const attempts = row.attempts + 1;
  await tx
    .update(notificationDispatch)
    .set({ status: "sending", attempts, claimedUntil: new Date(now.getTime() + leaseMs), nextRetryAt: null })
    .where(eq(notificationDispatch.id, id));
  const link = `${webAppUrl.replace(/\/+$/, "")}${alertPath(a.kind as AlertKind, a.taskId)}`;
  return {
    row: { ...row, attempts },
    to: u.email,
    subject: `[Studio] ${PRIORITY_LABELS[a.priority as AlertPriority]} · ${a.title}`,
    text: `${a.title}\n\n${a.detail}\n\nÀ traiter dans le Studio : ${link}`,
  };
}

async function record(tx: Tx, row: DispatchRow, error: string | null, provider: string, now: Date, report: NotifyReport): Promise<void> {
  const [locked] = await tx.select().from(notificationDispatch).where(eq(notificationDispatch.id, row.id)).for("update");
  if (!locked || locked.status !== "sending") return;
  if (error === null) {
    await tx
      .update(notificationDispatch)
      .set({ status: "sent", sentAt: now, provider, claimedUntil: null, lastError: null })
      .where(eq(notificationDispatch.id, row.id));
    await audit(tx, row, "sent", { provider });
    report.sent += 1;
    return;
  }
  if (row.attempts >= row.maxAttempts) {
    await tx
      .update(notificationDispatch)
      .set({ status: "failed", provider, claimedUntil: null, lastError: error })
      .where(eq(notificationDispatch.id, row.id));
    await audit(tx, row, "failed", { provider, error });
    report.failed += 1;
    return;
  }
  await tx
    .update(notificationDispatch)
    .set({
      status: "pending",
      provider,
      claimedUntil: null,
      lastError: error,
      nextRetryAt: new Date(now.getTime() + backoffSeconds(row.attempts) * 1000),
    })
    .where(eq(notificationDispatch.id, row.id));
  await audit(tx, row, "retry", { provider, error });
  report.retried += 1;
}
