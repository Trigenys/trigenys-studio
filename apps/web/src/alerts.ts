import type { Alert, NotificationPreference } from "@trigenys/studio-contracts";

// Labels of the alerting vocabulary (ADR 0011), in the order the API lists
// the kinds and the preferences.
export const ALERT_KINDS: Alert["kind"][] = ["task_blocked", "content_fix", "approval_required", "publication_failed"];

export const KIND_LABELS: Record<Alert["kind"], string> = {
  task_blocked: "Tâche bloquée",
  content_fix: "Contenu à corriger",
  approval_required: "Approbation requise",
  publication_failed: "Publication refusée",
};

export const PRIORITY_LABELS: Record<Alert["priority"], string> = { p1: "P1", p2: "P2", p3: "P3" };

export const STATE_LABELS: Record<Alert["state"], string> = { open: "À traiter", acknowledged: "Vue", resolved: "Résolue" };

export const EMAIL_LABELS: Record<NotificationPreference["email"], string> = { off: "Aucun e-mail", immediate: "E-mail immédiat" };

// Where the alert sends the reader: the task, and its publication block
// when a delivery was refused.
export const alertPath = (a: Pick<Alert, "kind" | "taskId">) => `/tasks/${a.taskId}${a.kind === "publication_failed" ? "#publication" : ""}`;
