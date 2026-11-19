import { and, eq, isNull, or } from "drizzle-orm";
import type { Tx } from "../db/client.ts";
import { notificationDispatch, roleAssignment } from "../db/schema.ts";
import { ProblemError } from "../problem.ts";

// Task assignment (ADR 0013). An assignee must be able to open the task, so
// they need a role on its product or a global one. Assigning someone else
// queues one notice for them in the notification outbox, in the same
// transaction as the change: no change without its notice, no notice for a
// change that rolled back. Assigning oneself notifies nobody.

export async function assertAssignable(tx: Tx, productId: string, userId: string): Promise<void> {
  const [grant] = await tx
    .select({ id: roleAssignment.id })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.userId, userId), or(eq(roleAssignment.productId, productId), isNull(roleAssignment.productId))))
    .limit(1);
  if (!grant) {
    throw new ProblemError(422, "Assignee has no access to this product", {
      detail: `User "${userId}" has no role on product "${productId}"; grant one before assigning the task`,
    });
  }
}

export type AssignmentChange = {
  taskId: string;
  // The task version after the change: one notice per assignment event.
  version: number;
  assigneeId: string | null;
  previousAssigneeId: string | null;
  actorId: string;
};

// The e-mail to the assignee is always queued; the team group message only
// when the event is listed in WHATSAPP_NOTIFY_EVENTS (ADR 0014).
export async function queueAssignmentNotice(tx: Tx, change: AssignmentChange, channels: readonly NotificationChannel[] = ["email"]): Promise<boolean> {
  const { assigneeId } = change;
  if (!assigneeId || assigneeId === change.previousAssigneeId || assigneeId === change.actorId) return false;
  const base = `${change.taskId}:${assigneeId}:${change.version}`;
  const inserted = await tx
    .insert(notificationDispatch)
    .values(
      channels.map((channel) => ({
        kind: "task_assigned" as const,
        taskId: change.taskId,
        userId: assigneeId,
        channel,
        priority: "p2" as const,
        // The e-mail key predates the channels and stays unchanged.
        dedupKey: channel === "email" ? `task_assigned:${base}` : `task_assigned:${channel}:${base}`,
      })),
    )
    .onConflictDoNothing({ target: notificationDispatch.dedupKey })
    .returning({ id: notificationDispatch.id });
  return inserted.length > 0;
}

export const NOTIFICATION_CHANNELS = ["email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
const GROUP_EVENTS = ["task_assigned"] as const;
type GroupEvent = (typeof GROUP_EVENTS)[number];

// Channels for an event: e-mail always, plus the group chat when configured.
// Unknown names in the list are ignored rather than failing the request.
export function notificationChannels(env: { WHATSAPP_NOTIFY_EVENTS?: string }, event: GroupEvent): NotificationChannel[] {
  const listed = (env.WHATSAPP_NOTIFY_EVENTS ?? "").split(",").map((s) => s.trim());
  return listed.includes(event) ? ["email", "whatsapp"] : ["email"];
}
