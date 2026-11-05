import { and, eq, notInArray } from "drizzle-orm";
import type { Tx } from "../db/client.ts";
import { delivery } from "../db/schema.ts";
import { applyTransition, loadSnapshot, type TaskRow } from "../pipeline/engine.ts";

// Derives the task's state from its deliveries once they settle. Only a
// scheduled task moves: all live deliveries sent → published; any failed →
// failed; none left (all cancelled) → approved. Partial progress keeps the
// task scheduled. Idempotent: a task already where it belongs is untouched.
export async function settleTask(tx: Tx, taskId: string, reason: string): Promise<TaskRow | null> {
  const s = await loadSnapshot(tx, taskId, true);
  if (!s || s.task.state !== "scheduled") return s?.task ?? null;
  const live = await tx
    .select({ status: delivery.status })
    .from(delivery)
    .where(and(eq(delivery.taskId, taskId), notInArray(delivery.status, ["cancelled", "draft"])));
  let to: "published" | "failed" | "approved" | null = null;
  if (live.length === 0) to = "approved";
  else if (live.some((d) => d.status === "failed")) to = "failed";
  else if (live.every((d) => d.status === "sent")) to = "published";
  if (!to) return s.task;
  return applyTransition(tx, s, to, null, reason);
}
