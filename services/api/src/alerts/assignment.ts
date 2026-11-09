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

export async function queueAssignmentNotice(tx: Tx, change: AssignmentChange): Promise<boolean> {
  const { assigneeId } = change;
  if (!assigneeId || assigneeId === change.previousAssigneeId || assigneeId === change.actorId) return false;
  const inserted = await tx
    .insert(notificationDispatch)
    .values({
      kind: "task_assigned",
      taskId: change.taskId,
      userId: assigneeId,
      priority: "p2",
      dedupKey: `task_assigned:${change.taskId}:${assigneeId}:${change.version}`,
    })
    .onConflictDoNothing({ target: notificationDispatch.dedupKey })
    .returning({ id: notificationDispatch.id });
  return inserted.length > 0;
}
