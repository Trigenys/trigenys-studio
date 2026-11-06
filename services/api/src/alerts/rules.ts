import type { AlertKind, AlertPriority, NotificationEmailMode, Role, TaskState } from "../db/schema.ts";

// Alert rules (ADR 0011): the declarative part of the alerting. Every rule
// says who the alert is for, whether it is mailed by default and how its
// priority follows the facts. The reconciler turns facts into alerts with
// these functions and never decides anything on its own.
//
// Facts must be stable between two runs over the same data: nothing derived
// from "now" goes into a title, a detail or the facts of an alert, otherwise
// a converged reconciliation would still rewrite rows.

export type AlertTuning = {
  // Hours a task may wait in `awaiting_approval` before someone is asked.
  approvalHours: number;
  // Hours without activity before a task in preparation counts as stalled.
  stallHours: number;
  // Hours before a due date within which a fix or an approval becomes P1.
  dueSoonHours: number;
};

export const DEFAULT_ALERT_TUNING: AlertTuning = { approvalHours: 24, stallHours: 72, dueSoonHours: 24 };

export type AlertRule = {
  audience: readonly Role[];
  defaultEmail: NotificationEmailMode;
  label: string;
};

export const ALERT_RULES: Record<AlertKind, AlertRule> = {
  content_fix: { audience: ["admin", "operator"], defaultEmail: "off", label: "Contenu à corriger" },
  approval_required: { audience: ["admin", "reviewer"], defaultEmail: "immediate", label: "Approbation requise" },
  task_blocked: { audience: ["admin", "operator"], defaultEmail: "off", label: "Tâche bloquée" },
  publication_failed: { audience: ["admin", "operator"], defaultEmail: "immediate", label: "Publication refusée" },
};

export const PRIORITY_RANK: Record<AlertPriority, number> = { p1: 3, p2: 2, p3: 1 };

export const PRIORITY_LABELS: Record<AlertPriority, string> = { p1: "P1", p2: "P2", p3: "P3" };

export type TaskFacts = {
  id: string;
  productId: string;
  title: string;
  type: string;
  state: TaskState;
  dueAt: Date | null;
  // Last change of the task itself, its content or its comments.
  lastActivityAt: Date;
  // Last entry into `awaiting_approval`, when the task is waiting there.
  awaitingSince: Date | null;
};

export type DeliveryFacts = {
  id: string;
  taskId: string;
  productId: string;
  taskTitle: string;
  channel: string;
  status: string;
  lastError: string | null;
};

export type DesiredAlert = {
  kind: AlertKind;
  priority: AlertPriority;
  dedupKey: string;
  productId: string;
  taskId: string;
  deliveryId: string | null;
  title: string;
  detail: string;
  facts: Record<string, unknown>;
};

const FINAL_OR_HANDLED: readonly TaskState[] = ["published", "measured", "scheduled", "failed"];
const IN_PREPARATION: readonly TaskState[] = ["qualifying", "preparing", "reviewing", "visuals"];

const hours = (h: number) => h * 3_600_000;

const day = (d: Date) => d.toISOString().slice(0, 10);

const dueSoon = (dueAt: Date | null, now: Date, tuning: AlertTuning) =>
  dueAt !== null && dueAt.getTime() <= now.getTime() + hours(tuning.dueSoonHours);

const dueText = (dueAt: Date | null) => (dueAt ? ` Échéance le ${day(dueAt)}.` : "");

// One alert per task at most, by precedence: a content to fix beats a
// pending approval, which beats a late task, which beats a stalled one.
export function taskAlert(t: TaskFacts, now: Date, tuning: AlertTuning = DEFAULT_ALERT_TUNING): DesiredAlert | null {
  const base = { productId: t.productId, taskId: t.id, deliveryId: null };
  if (t.state === "needs_fix" || t.state === "rejected") {
    return {
      ...base,
      kind: "content_fix",
      priority: dueSoon(t.dueAt, now, tuning) ? "p1" : "p2",
      dedupKey: `content_fix:${t.id}`,
      title: `Contenu à corriger : ${t.title}`,
      detail: `${t.state === "rejected" ? "Le contenu a été refusé à la relecture" : "Le contenu a été renvoyé en correction"} ; il attend une nouvelle version.${dueText(t.dueAt)}`,
      facts: { state: t.state, dueAt: t.dueAt?.toISOString() ?? null },
    };
  }
  if (t.state === "awaiting_approval" && t.awaitingSince && t.awaitingSince.getTime() <= now.getTime() - hours(tuning.approvalHours)) {
    return {
      ...base,
      kind: "approval_required",
      priority: dueSoon(t.dueAt, now, tuning) ? "p1" : "p2",
      dedupKey: `approval_required:${t.id}`,
      title: `Approbation requise : ${t.title}`,
      detail: `En attente d'approbation depuis le ${day(t.awaitingSince)} (plus de ${tuning.approvalHours} h).${dueText(t.dueAt)}`,
      facts: { state: t.state, awaitingSince: t.awaitingSince.toISOString(), dueAt: t.dueAt?.toISOString() ?? null },
    };
  }
  if (t.dueAt && t.dueAt.getTime() < now.getTime() && !FINAL_OR_HANDLED.includes(t.state)) {
    return {
      ...base,
      kind: "task_blocked",
      priority: "p1",
      dedupKey: `task_blocked:${t.id}`,
      title: `Tâche en retard : ${t.title}`,
      detail: `L'échéance du ${day(t.dueAt)} est dépassée et la tâche est encore « ${t.state} ».`,
      facts: { reason: "overdue", state: t.state, dueAt: t.dueAt.toISOString() },
    };
  }
  if (IN_PREPARATION.includes(t.state) && t.lastActivityAt.getTime() < now.getTime() - hours(tuning.stallHours)) {
    return {
      ...base,
      kind: "task_blocked",
      priority: "p3",
      dedupKey: `task_blocked:${t.id}`,
      title: `Tâche sans activité : ${t.title}`,
      detail: `Aucune activité depuis le ${day(t.lastActivityAt)} (plus de ${tuning.stallHours} h) en « ${t.state} ».${dueText(t.dueAt)}`,
      facts: { reason: "stalled", state: t.state, lastActivityAt: t.lastActivityAt.toISOString(), dueAt: t.dueAt?.toISOString() ?? null },
    };
  }
  return null;
}

// A delivery the provider refused. A delivery scheduled again after an error
// is being retried by the outbox and raises nothing.
export function deliveryAlert(d: DeliveryFacts): DesiredAlert | null {
  if (d.status !== "failed") return null;
  return {
    kind: "publication_failed",
    priority: "p1",
    dedupKey: `publication_failed:${d.id}`,
    productId: d.productId,
    taskId: d.taskId,
    deliveryId: d.id,
    title: `Publication refusée : ${d.taskTitle} (${d.channel})`,
    detail: d.lastError ?? "Le fournisseur a refusé la publication.",
    facts: { channel: d.channel, lastError: d.lastError },
  };
}
