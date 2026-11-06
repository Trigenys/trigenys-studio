import type { Action } from "../auth/rbac.ts";
import type { TaskState } from "../db/schema.ts";

// Declarative pipeline. The engine (engine.ts) is generic: it reads this
// table and never knows product rules by name. Guards are evaluated server
// side; the RBAC action says who may take the transition.
export const GUARDS = ["has_content", "approval_valid"] as const;
export type Guard = (typeof GUARDS)[number];

export type TransitionRule = {
  from: TaskState;
  to: TaskState;
  action: Action;
  guard?: Guard;
};

export type PipelineDefinition = {
  initial: TaskState;
  transitions: readonly TransitionRule[];
  // Only an approval decision moves a task out of this state.
  decided: { from: TaskState; approved: TaskState; rejected: TaskState };
  // Content is frozen here: no new version may be added.
  frozen: readonly TaskState[];
  // A new content version in one of these states invalidates the pending or
  // granted approval and sends the task back.
  invalidatedBy: Partial<Record<TaskState, TaskState>>;
};

export const pipelineDefinition: PipelineDefinition = {
  initial: "qualifying",
  transitions: [
    { from: "qualifying", to: "preparing", action: "content.write" },
    { from: "preparing", to: "reviewing", action: "content.write", guard: "has_content" },
    { from: "reviewing", to: "visuals", action: "content.write" },
    { from: "reviewing", to: "needs_fix", action: "content.review" },
    { from: "visuals", to: "awaiting_approval", action: "content.write" },
    { from: "needs_fix", to: "preparing", action: "content.write" },
    { from: "rejected", to: "preparing", action: "content.write" },
    { from: "approved", to: "scheduled", action: "content.publish", guard: "approval_valid" },
    // Back to approved when every delivery was cancelled (settled by the outbox or requested).
    { from: "scheduled", to: "approved", action: "content.publish", guard: "approval_valid" },
    { from: "scheduled", to: "published", action: "content.publish" },
    { from: "scheduled", to: "failed", action: "content.publish" },
    { from: "failed", to: "approved", action: "content.publish", guard: "approval_valid" },
    { from: "published", to: "measured", action: "content.publish" },
  ],
  decided: { from: "awaiting_approval", approved: "approved", rejected: "rejected" },
  frozen: ["scheduled", "published", "measured"],
  invalidatedBy: { awaiting_approval: "preparing", approved: "preparing" },
};
