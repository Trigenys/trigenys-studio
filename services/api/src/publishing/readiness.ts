import { decide, type Principal } from "../auth/rbac.ts";
import type { socialAccount } from "../db/schema.ts";
import { approvalIsValid, resourceOf, type TaskSnapshot } from "../pipeline/engine.ts";

// The five conditions a publication must meet (discovery §7), evaluated the
// same way when a human schedules and when the outbox is about to send.
// Every check carries its reason so the UI can show a checklist, and a
// refusal in a route can quote it.

export type SocialAccountRow = typeof socialAccount.$inferSelect;

export const PUBLISH_WINDOW_DAYS = 90;

export type ReadinessCheck = { ok: boolean; reason: string };
export type Readiness = {
  ready: boolean;
  checks: { state: ReadinessCheck; approval: ReadinessCheck; account: ReadinessCheck; permission: ReadinessCheck; window: ReadinessCheck };
};

export type ReadinessOptions = {
  // The outbox checks a delivery that is already due: the window is the date's
  // presence, not its position relative to now.
  forDispatch?: boolean;
};

const ok = (reason: string): ReadinessCheck => ({ ok: true, reason });
const ko = (reason: string): ReadinessCheck => ({ ok: false, reason });

export async function checkReadiness(
  s: TaskSnapshot,
  account: SocialAccountRow | null,
  scheduledAt: Date | null,
  principal: Principal | null,
  now: Date,
  options: ReadinessOptions = {},
): Promise<Readiness> {
  const state =
    s.task.state === "approved" || s.task.state === "scheduled"
      ? ok(`Task is ${s.task.state}`)
      : ko(`Task is ${s.task.state}; only an approved task can be scheduled`);

  const approval = (await approvalIsValid(s)) ? ok("Approval matches the current content and visuals") : ko("No valid approval for the current content and visuals");

  let accountCheck: ReadinessCheck;
  if (!account) accountCheck = ko("No social account selected");
  else if (!account.active) accountCheck = ko(`Account ${account.handle} is inactive`);
  else if (account.productId !== s.task.productId) accountCheck = ko(`Account ${account.handle} belongs to another product`);
  else if (!s.latestVersion) accountCheck = ko("The task has no content");
  else if (account.channel !== s.latestVersion.channel) accountCheck = ko(`Account ${account.handle} is a ${account.channel} account; the content targets ${s.latestVersion.channel}`);
  else accountCheck = ok(`Account ${account.handle} (${account.channel}) is active for this product`);

  let permission: ReadinessCheck;
  if (!principal) permission = ok("Automated dispatch");
  else {
    const decision = decide("content.publish", principal, await resourceOf(s));
    permission = decision.allowed ? ok("You may publish this content") : ko(decision.reason);
  }

  let window: ReadinessCheck;
  if (!scheduledAt) window = ko("No publication date");
  else if (Number.isNaN(scheduledAt.getTime())) window = ko("Invalid publication date");
  else if (options.forDispatch) window = ok("Due");
  else if (scheduledAt.getTime() <= now.getTime()) window = ko("The publication date is in the past");
  else if (scheduledAt.getTime() > now.getTime() + PUBLISH_WINDOW_DAYS * 86_400_000) window = ko(`The publication date is more than ${PUBLISH_WINDOW_DAYS} days away`);
  else window = ok("Within the publication window");

  const checks = { state, approval, account: accountCheck, permission, window };
  return { ready: Object.values(checks).every((c) => c.ok), checks };
}

export const firstFailure = (r: Readiness): string | null => Object.values(r.checks).find((c) => !c.ok)?.reason ?? null;
