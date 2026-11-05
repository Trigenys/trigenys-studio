import { and, desc, eq } from "drizzle-orm";
import { decide, type Decision, type Principal, type Resource } from "../auth/rbac.ts";
import type { Db, Tx } from "../db/client.ts";
import { approval, contentVersion, task, taskTransition, visualAsset, type TaskState } from "../db/schema.ts";
import { stableStringify } from "../visuals/canonical.ts";
import { pipelineDefinition, type Guard, type TransitionRule } from "./definition.ts";

export type TaskRow = typeof task.$inferSelect;
export type ContentVersionRow = typeof contentVersion.$inferSelect;
export type ApprovalRow = typeof approval.$inferSelect;
export type VisualAssetRow = typeof visualAsset.$inferSelect;

// What the engine needs to know about a task to decide anything.
export type TaskSnapshot = {
  task: TaskRow;
  latestVersion: ContentVersionRow | null;
  latestApproval: ApprovalRow | null;
  // Active visual assets, in a stable order: part of what an approval binds.
  assets: VisualAssetRow[];
};

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The asset set hash binds an approval to the exact visuals (format, bytes,
// brand kit) the task carried: a render, a discard or a new kit changes it.
// An empty set hashes "[]", the value approvals carried before visuals existed.
export const assetSetHashOf = (s: TaskSnapshot): Promise<string> =>
  sha256(stableStringify(s.assets.map((a) => [a.formatId, a.contentHash, a.brandKitHash]).sort()));

export async function loadSnapshot(db: Db | Tx, taskId: string, lock = false): Promise<TaskSnapshot | null> {
  const query = db.select().from(task).where(eq(task.id, taskId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) return null;
  const [latestVersion] = await db
    .select()
    .from(contentVersion)
    .where(eq(contentVersion.taskId, taskId))
    .orderBy(desc(contentVersion.n))
    .limit(1);
  const [latestApproval] = await db
    .select()
    .from(approval)
    .where(eq(approval.taskId, taskId))
    .orderBy(desc(approval.createdAt))
    .limit(1);
  const assets = await db
    .select()
    .from(visualAsset)
    .where(and(eq(visualAsset.taskId, taskId), eq(visualAsset.status, "active")))
    .orderBy(visualAsset.formatId, visualAsset.variant);
  return { task: row, latestVersion: latestVersion ?? null, latestApproval: latestApproval ?? null, assets };
}

// An approval is valid when it was granted on exactly the content and asset
// set the task carries now.
export async function approvalIsValid(s: TaskSnapshot): Promise<boolean> {
  const a = s.latestApproval;
  if (!a || a.decision !== "approved" || !s.latestVersion) return false;
  return a.contentHash === s.latestVersion.contentHash && a.assetSetHash === (await assetSetHashOf(s));
}

const allow: Decision = { allowed: true };

export async function evaluateGuard(guard: Guard, s: TaskSnapshot): Promise<Decision> {
  switch (guard) {
    case "has_content":
      return s.latestVersion ? allow : { allowed: false, reason: "The task has no content version yet" };
    case "approval_valid":
      return (await approvalIsValid(s))
        ? allow
        : { allowed: false, reason: "A valid approval matching the current content and assets is required" };
  }
}

export const ruleFor = (from: TaskState, to: TaskState): TransitionRule | undefined =>
  pipelineDefinition.transitions.find((t) => t.from === from && t.to === to);

export async function resourceOf(s: TaskSnapshot): Promise<Resource> {
  return {
    type: "task",
    id: s.task.id,
    productId: s.task.productId,
    attributes: { state: s.task.state, approved: await approvalIsValid(s) },
  };
}

// Transitions this principal may take now, guards included. Returned to the
// clients so the UI offers exactly what the server will accept.
export async function allowedTransitions(s: TaskSnapshot, principal: Principal): Promise<TaskState[]> {
  const resource = await resourceOf(s);
  const out: TaskState[] = [];
  for (const rule of pipelineDefinition.transitions) {
    if (rule.from !== s.task.state) continue;
    if (!decide(rule.action, principal, resource).allowed) continue;
    if (rule.guard && !(await evaluateGuard(rule.guard, s)).allowed) continue;
    out.push(rule.to);
  }
  return out;
}

export class TransitionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TransitionError";
    this.status = status;
  }
}

// Moves the task and records the transition. Callers hold the row lock
// (loadSnapshot with lock) and have already authorized the action.
export async function applyTransition(
  tx: Tx,
  s: TaskSnapshot,
  to: TaskState,
  actorId: string | null,
  reason: string | null,
): Promise<TaskRow> {
  const [updated] = await tx
    .update(task)
    .set({ state: to, version: s.task.version + 1, updatedAt: new Date() })
    .where(and(eq(task.id, s.task.id), eq(task.version, s.task.version)))
    .returning();
  if (!updated) throw new TransitionError(409, "The task changed concurrently; reload and retry");
  await tx
    .insert(taskTransition)
    .values({ taskId: s.task.id, fromState: s.task.state, toState: to, actorId, reason });
  return updated;
}

// A requested transition: checks the definition and the guard, not the role
// (authorize() did that from the rule's action before the handler ran).
export async function requestTransition(
  tx: Tx,
  s: TaskSnapshot,
  to: TaskState,
  actorId: string,
  reason: string | null,
): Promise<TaskRow> {
  const rule = ruleFor(s.task.state, to);
  if (!rule) throw new TransitionError(409, `No transition from ${s.task.state} to ${to}`);
  if (rule.guard) {
    const guard = await evaluateGuard(rule.guard, s);
    if (!guard.allowed) throw new TransitionError(409, guard.reason);
  }
  return applyTransition(tx, s, to, actorId, reason);
}
