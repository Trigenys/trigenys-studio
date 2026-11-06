import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { delivery, deliveryAttempt, socialAccount, type ATTEMPT_TRIGGERS } from "../db/schema.ts";
import { isSocialChannel, type Publisher, type PublishResult, type RemotePost } from "../integrations/types.ts";
import { loadSnapshot } from "../pipeline/engine.ts";
import { checkReadiness, firstFailure, type SocialAccountRow } from "./readiness.ts";
import { settleTask } from "./settle.ts";

// Transactional outbox for deliveries, in three phases per row:
//   1. reserve under a row lock (SKIP LOCKED), re-check readiness, mark
//      `sending` with a lease, open an attempt, commit;
//   2. call the provider with no transaction open;
//   3. record the outcome in a new transaction and settle the task.
// A delivery whose provider call may have gone through (lease expired while
// `sending`) is reconciled through `lookup` before anything is sent again;
// a delivery with an `external_id` is never published twice. A fourth phase
// polls `handed_off` deliveries whose due time has passed.

export type DeliveryRow = typeof delivery.$inferSelect;
export type AttemptTrigger = (typeof ATTEMPT_TRIGGERS)[number];

export type DispatchOptions = {
  db: Db;
  publisher: Publisher;
  trigger: AttemptTrigger;
  now?: () => Date;
  limit?: number;
  leadMinutes?: number;
  leaseMinutes?: number;
};

export type DispatchReport = {
  claimed: number;
  handedOff: number;
  sent: number;
  retried: number;
  failed: number;
  reconciled: number;
  unknown: number;
  polled: number;
};

const MAX_BACKOFF_MINUTES = 60;

export function backoffSeconds(attempts: number, retryAfterSeconds?: number): number {
  const exponential = Math.min(2 ** attempts, MAX_BACKOFF_MINUTES) * 60;
  return Math.max(retryAfterSeconds ?? 0, exponential);
}

type Claimed = {
  row: DeliveryRow;
  account: SocialAccountRow;
  attemptId: string;
  attemptN: number;
  body: string;
  // The delivery was already `sending` when claimed: its previous call may
  // have reached the provider, so look before sending.
  uncertainSince: Date | null;
};

export async function dispatch(options: DispatchOptions): Promise<DispatchReport> {
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 25;
  const leadMs = (options.leadMinutes ?? 10) * 60_000;
  const leaseMs = (options.leaseMinutes ?? 5) * 60_000;
  const report: DispatchReport = { claimed: 0, handedOff: 0, sent: 0, retried: 0, failed: 0, reconciled: 0, unknown: 0, polled: 0 };
  const { db, publisher } = options;

  // Candidates, re-checked one by one under lock in phase 1.
  const t = now();
  const candidates = await db
    .select({ id: delivery.id })
    .from(delivery)
    .where(
      or(
        and(
          eq(delivery.status, "scheduled"),
          lte(delivery.scheduledAt, new Date(t.getTime() + leadMs)),
          or(isNull(delivery.nextRetryAt), lte(delivery.nextRetryAt, t)),
        ),
        and(eq(delivery.status, "sending"), lt(delivery.claimedUntil, t)),
      ),
    )
    .orderBy(asc(delivery.scheduledAt))
    .limit(limit);

  for (const { id } of candidates) {
    const claimed = await db.transaction((tx) => claim(tx, id, now(), leadMs, leaseMs, options.trigger, report));
    if (!claimed) continue;
    report.claimed += 1;

    // Phase 2: provider call, no transaction open.
    let outcome: Outcome;
    try {
      outcome = await callProvider(publisher, claimed, now());
    } catch (e) {
      outcome = { kind: "unknown", error: e instanceof Error ? e.message : String(e) };
    }

    // Phase 3: record.
    await db.transaction((tx) => record(tx, claimed, outcome, now(), report));
  }

  // Phase 4: follow up on posts the provider holds.
  if (publisher.status) {
    const due = await db
      .select()
      .from(delivery)
      .where(and(eq(delivery.status, "handed_off"), lte(delivery.scheduledAt, now())))
      .orderBy(asc(delivery.scheduledAt))
      .limit(limit);
    for (const row of due) {
      if (!row.externalId) continue;
      let remote: RemotePost | null;
      try {
        remote = await publisher.status(row.externalId);
      } catch {
        continue;
      }
      report.polled += 1;
      if (!remote || remote.status === "scheduled") continue;
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(delivery).where(eq(delivery.id, row.id)).for("update");
        if (!locked || locked.status !== "handed_off") return;
        if (remote.status === "sent") {
          await tx
            .update(delivery)
            .set({ status: "sent", permalink: locked.permalink ?? remote.permalink ?? null, sentAt: now(), version: locked.version + 1, updatedAt: now() })
            .where(eq(delivery.id, row.id));
          report.sent += 1;
          await settleTask(tx, locked.taskId, "delivery sent");
        } else {
          await tx
            .update(delivery)
            .set({ status: "failed", lastError: remote.error ?? "The provider reported an error", version: locked.version + 1, updatedAt: now() })
            .where(eq(delivery.id, row.id));
          report.failed += 1;
          await settleTask(tx, locked.taskId, "delivery failed at the provider");
        }
      });
    }
  }
  return report;
}

// Phase 1. Returns null when the row is gone, locked elsewhere or no longer
// due; fails the delivery without any call when it is no longer ready.
async function claim(
  tx: Tx,
  id: string,
  now: Date,
  leadMs: number,
  leaseMs: number,
  trigger: AttemptTrigger,
  report: DispatchReport,
): Promise<Claimed | null> {
  const [row] = await tx.select().from(delivery).where(eq(delivery.id, id)).for("update", { skipLocked: true });
  if (!row) return null;
  const dueNow =
    row.status === "scheduled" &&
    row.scheduledAt !== null &&
    row.scheduledAt.getTime() <= now.getTime() + leadMs &&
    (row.nextRetryAt === null || row.nextRetryAt.getTime() <= now.getTime());
  const stuck = row.status === "sending" && row.claimedUntil !== null && row.claimedUntil.getTime() < now.getTime();
  if (!dueNow && !stuck) return null;

  const s = await loadSnapshot(tx, row.taskId, true);
  const [account] = await tx.select().from(socialAccount).where(eq(socialAccount.id, row.socialAccountId));
  const fail = async (reason: string) => {
    await tx
      .update(delivery)
      .set({ status: "failed", lastError: reason, claimedUntil: null, version: row.version + 1, updatedAt: now })
      .where(eq(delivery.id, id));
    report.failed += 1;
    await settleTask(tx, row.taskId, "delivery no longer publishable");
    return null;
  };
  if (!s || !account) return fail("The task or the social account no longer exists");
  // Only when sending for the first time: a stuck delivery is reconciled on
  // what the provider already holds, whatever the task looks like now.
  if (!stuck) {
    const readiness = await checkReadiness(s, account, row.scheduledAt, null, now, { forDispatch: true });
    if (!readiness.ready) return fail(firstFailure(readiness) ?? "Not ready");
    if (s.latestVersion?.id !== row.contentVersionId || s.latestApproval?.id !== row.approvalId) {
      return fail("The content or the approval changed since this delivery was scheduled");
    }
  }
  const attemptN = row.attempts + 1;
  await tx
    .update(delivery)
    .set({ status: "sending", claimedUntil: new Date(now.getTime() + leaseMs), attempts: attemptN, nextRetryAt: null, version: row.version + 1, updatedAt: now })
    .where(eq(delivery.id, id));
  const [attempt] = await tx
    .insert(deliveryAttempt)
    .values({ deliveryId: id, n: attemptN, trigger: stuck ? "retry" : trigger, startedAt: now })
    .returning({ id: deliveryAttempt.id });
  const [previous] = stuck
    ? await tx
        .select({ startedAt: deliveryAttempt.startedAt })
        .from(deliveryAttempt)
        .where(and(eq(deliveryAttempt.deliveryId, id), lt(deliveryAttempt.n, attemptN)))
        .orderBy(asc(deliveryAttempt.startedAt))
        .limit(1)
    : [];
  return {
    row,
    account,
    attemptId: attempt!.id,
    attemptN,
    body: s.latestVersion?.body ?? "",
    uncertainSince: stuck ? (previous?.startedAt ?? row.createdAt) : null,
  };
}

type Outcome =
  | { kind: "handed_off"; externalId: string }
  | { kind: "sent"; externalId: string; permalink?: string }
  | { kind: "reconciled"; remote: RemotePost }
  | { kind: "retryable_error"; error: string; retryAfterSeconds?: number }
  | { kind: "fatal_error"; error: string }
  | { kind: "unknown"; error: string };

// Phase 2.
async function callProvider(publisher: Publisher, c: Claimed, now: Date): Promise<Outcome> {
  if (c.row.externalId) {
    // Already handed off once: never publish again, ask what the provider holds.
    const remote = publisher.status ? await publisher.status(c.row.externalId) : null;
    return remote ? { kind: "reconciled", remote } : { kind: "fatal_error", error: "The provider no longer knows this post; manual check required" };
  }
  if (c.uncertainSince) {
    if (!publisher.lookup) return { kind: "fatal_error", error: "A previous send may have reached the provider and it offers no lookup; manual check required" };
    const remote = await publisher.lookup({ accountRef: c.account.externalRef, body: c.body, since: c.uncertainSince.toISOString() });
    if (remote) return { kind: "reconciled", remote };
  }
  if (!isSocialChannel(c.account.channel)) return { kind: "fatal_error", error: `Channel ${c.account.channel} is not a social channel` };
  const result: PublishResult = await publisher.publish({
    idempotencyKey: c.row.idempotencyKey,
    accountRef: c.account.externalRef,
    channel: c.account.channel,
    body: c.body,
    mediaUrls: [],
    scheduledAt: (c.row.scheduledAt ?? now).toISOString(),
  });
  if (result.status === "scheduled") return { kind: "handed_off", externalId: result.externalId };
  if (result.status === "published") return { kind: "sent", externalId: result.externalId, permalink: result.permalink };
  if (result.status !== "failed") return { kind: "fatal_error", error: "Unexpected provider result" };
  return result.retryable ? { kind: "retryable_error", error: result.error, retryAfterSeconds: result.retryAfterSeconds } : { kind: "fatal_error", error: result.error };
}

// Phase 3.
async function record(tx: Tx, c: Claimed, outcome: Outcome, now: Date, report: DispatchReport): Promise<void> {
  const [row] = await tx.select().from(delivery).where(eq(delivery.id, c.row.id)).for("update");
  if (!row || row.status !== "sending") return;
  const finish = (patch: Partial<typeof deliveryAttempt.$inferInsert>) =>
    tx.update(deliveryAttempt).set({ finishedAt: now, ...patch }).where(eq(deliveryAttempt.id, c.attemptId));
  const update = (patch: Partial<typeof delivery.$inferInsert>) =>
    tx.update(delivery).set({ claimedUntil: null, version: row.version + 1, updatedAt: now, ...patch }).where(eq(delivery.id, c.row.id));

  switch (outcome.kind) {
    case "handed_off":
      await update({ status: "handed_off", externalId: outcome.externalId, lastError: null });
      await finish({ outcome: "handed_off", externalId: outcome.externalId });
      report.handedOff += 1;
      return;
    case "sent":
      await update({ status: "sent", externalId: outcome.externalId, permalink: outcome.permalink ?? null, sentAt: now, lastError: null });
      await finish({ outcome: "sent", externalId: outcome.externalId });
      report.sent += 1;
      await settleTask(tx, row.taskId, "delivery sent");
      return;
    case "reconciled": {
      const r = outcome.remote;
      report.reconciled += 1;
      await finish({ outcome: "reconciled", externalId: r.externalId, error: r.error ?? null });
      if (r.status === "sent") {
        await update({ status: "sent", externalId: r.externalId, permalink: row.permalink ?? r.permalink ?? null, sentAt: now, lastError: null });
        await settleTask(tx, row.taskId, "delivery sent");
      } else if (r.status === "error") {
        await update({ status: "failed", externalId: r.externalId, lastError: r.error ?? "The provider reported an error" });
        await settleTask(tx, row.taskId, "delivery failed at the provider");
      } else {
        await update({ status: "handed_off", externalId: r.externalId, lastError: null });
      }
      return;
    }
    case "retryable_error": {
      await finish({ outcome: "retryable_error", error: outcome.error, retryAfterS: outcome.retryAfterSeconds ?? null });
      if (row.attempts < row.maxAttempts) {
        await update({ status: "scheduled", lastError: outcome.error, nextRetryAt: new Date(now.getTime() + backoffSeconds(row.attempts, outcome.retryAfterSeconds) * 1000) });
        report.retried += 1;
      } else {
        await update({ status: "failed", lastError: `${outcome.error} (after ${row.attempts} attempts)` });
        report.failed += 1;
        await settleTask(tx, row.taskId, "delivery failed after retries");
      }
      return;
    }
    case "fatal_error":
      await finish({ outcome: "fatal_error", error: outcome.error });
      await update({ status: "failed", lastError: outcome.error });
      report.failed += 1;
      await settleTask(tx, row.taskId, "delivery failed");
      return;
    case "unknown":
      // Keep the lease: the row is reconciled once it expires, never re-sent blindly.
      await finish({ outcome: "unknown", error: outcome.error });
      await tx.update(delivery).set({ lastError: outcome.error, updatedAt: now }).where(eq(delivery.id, c.row.id));
      report.unknown += 1;
      return;
  }
}

// Deliveries of these statuses still hold a slot on (task, account).
export const LIVE_DELIVERY_STATUSES = ["draft", "scheduled", "sending", "handed_off", "sent", "failed"] as const;
export const liveDeliveriesOf = (db: Db | Tx, taskId: string) =>
  db.select().from(delivery).where(and(eq(delivery.taskId, taskId), inArray(delivery.status, [...LIVE_DELIVERY_STATUSES]))).orderBy(asc(delivery.createdAt));

export const sqlNow = sql`now()`;
