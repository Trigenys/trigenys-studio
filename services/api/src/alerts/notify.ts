import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { recordAudit } from "../auth/audit.ts";
import type { Db, Tx } from "../db/client.ts";
import { alert, notificationDispatch, product, task, user, type AlertKind, type AlertPriority } from "../db/schema.ts";
import type { Mail, Mailer } from "../integrations/types.ts";
import { backoffSeconds } from "../publishing/dispatch.ts";
import { PRIORITY_LABELS } from "./rules.ts";

// At-most-once e-mail outbox for alerts (ADR 0011) and task assignments
// (ADR 0013), in the three phases of
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
  template: Mail["template"];
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
    details: { dispatchId: row.id, kind: row.kind, alertId: row.alertId, taskId: row.taskId, userId: row.userId, attempt: row.attempts, result, ...extra },
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
      await mailer.send({ to: claimed.to, template: claimed.template, subject: claimed.subject, text: claimed.text, key: `${claimed.row.id}:${claimed.row.attempts}` });
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

  const message = row.kind === "task_assigned" ? await assignmentMessage(tx, row) : await alertMessage(tx, row);
  if ("skip" in message) return skip(message.skip, "skipped");
  if (!webAppUrl) return skip("WEB_APP_URL n'est pas configurée : définir la var du Worker pour envoyer les liens.", "skipped");
  const [u] = await tx.select({ email: user.email }).from(user).where(eq(user.id, row.userId));
  if (!u?.email) return skip("Le destinataire n'a pas d'adresse e-mail.", "skipped");

  const attempts = row.attempts + 1;
  await tx
    .update(notificationDispatch)
    .set({ status: "sending", attempts, claimedUntil: new Date(now.getTime() + leaseMs), nextRetryAt: null })
    .where(eq(notificationDispatch.id, id));
  const link = `${webAppUrl.replace(/\/+$/, "")}${message.path}`;
  return {
    row: { ...row, attempts },
    to: u.email,
    template: message.template,
    subject: message.subject,
    text: `${message.body}\n\nÀ traiter dans le Studio : ${link}`,
  };
}

type Message = { template: Mail["template"]; subject: string; body: string; path: string } | { skip: string };

async function alertMessage(tx: Tx, row: DispatchRow): Promise<Message> {
  if (!row.alertId) return { skip: "La notification ne référence aucune alerte." };
  const [a] = await tx
    .select({ kind: alert.kind, priority: alert.priority, state: alert.state, title: alert.title, detail: alert.detail, taskId: alert.taskId })
    .from(alert)
    .where(eq(alert.id, row.alertId));
  if (!a) return { skip: "L'alerte n'existe plus." };
  if (a.state !== "open") return { skip: `L'alerte a été ${a.state === "resolved" ? "résolue" : "acquittée"} avant l'envoi.` };
  return {
    template: "alert",
    subject: `[Studio] ${PRIORITY_LABELS[a.priority as AlertPriority]} · ${a.title}`,
    body: `${a.title}\n\n${a.detail}`,
    path: alertPath(a.kind as AlertKind, a.taskId),
  };
}

// The notice describes the task as it is when it is sent, and only while it
// is still assigned to the recipient: a reassignment cancels it.
async function assignmentMessage(tx: Tx, row: DispatchRow): Promise<Message> {
  if (!row.taskId) return { skip: "La notification ne référence aucune tâche." };
  const [t] = await tx
    .select({ title: task.title, product: product.name, assigneeId: task.assigneeId, dueAt: task.dueAt, brief: task.brief })
    .from(task)
    .innerJoin(product, eq(product.id, task.productId))
    .where(eq(task.id, row.taskId));
  if (!t) return { skip: "La tâche n'existe plus." };
  if (t.assigneeId !== row.userId) return { skip: "La tâche a été réassignée avant l'envoi." };
  const due = t.dueAt ? `\nÉchéance : ${t.dueAt.toISOString().slice(0, 10)}` : "";
  const brief = t.brief.trim();
  const excerpt = brief ? `\n\n${brief.length > 600 ? `${brief.slice(0, 600)}…` : brief}` : "";
  return {
    template: "task-assigned",
    subject: `[Studio] Nouvelle tâche · ${t.title}`,
    body: `Une tâche vous a été assignée : ${t.title}\nProduit : ${t.product}${due}${excerpt}`,
    path: `/tasks/${row.taskId}`,
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
