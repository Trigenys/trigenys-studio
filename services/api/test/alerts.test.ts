import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchNotifications } from "../src/alerts/notify.ts";
import { reconcileAlerts } from "../src/alerts/reconcile.ts";
import { DEFAULT_ALERT_TUNING, deliveryAlert, taskAlert } from "../src/alerts/rules.ts";
import {
  alert,
  approval,
  auditEvent,
  comment,
  contentVersion,
  delivery,
  notificationDispatch,
  notificationPreference,
  product,
  socialAccount,
  task,
  taskTransition,
} from "../src/db/schema.ts";
import type { Mailer } from "../src/integrations/types.ts";
import { alertTuning, webAppUrl } from "../src/publishing/scheduled.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// Alerts and notifications (ADR 0011). Fixtures are written straight to the
// database with dates far enough from the real clock that the reconciler
// gives the same answer with the fixed `now` used here and with the clock
// used by the route hooks.

let h: Harness;
let admin: string;
let operator: string;
let reviewer: string;
let adminId: string;
let operatorId: string;
let reviewerId: string;
let insightAccount: string;
let atelierAccount: string;

// Anchored to the real clock: the routes reconcile with `new Date()` and queue
// e-mails due at that instant, so a frozen clock behind the real one would
// never see them as due once the real time passes it.
const now = new Date();
const hoursAgo = (hrs: number) => new Date(now.getTime() - hrs * 3_600_000);
const hoursAhead = (hrs: number) => new Date(now.getTime() + hrs * 3_600_000);
const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);
const patch = (path: string, body: unknown, token: string) =>
  h.request(path, { method: "PATCH", headers: json, body: JSON.stringify(body) }, token);

const reconcile = (options: Partial<Parameters<typeof reconcileAlerts>[0]> = {}) => reconcileAlerts({ db: h.db, now, ...options });
const notify = (options: Partial<Parameters<typeof dispatchNotifications>[0]> = {}) =>
  dispatchNotifications({ db: h.db, mailer: h.mailer, now: () => new Date(), webAppUrl: "https://studio.example/", ...options });

const mk = async (row: Partial<typeof task.$inferInsert> & { title: string }) =>
  (await h.db.insert(task).values({ productId: "insight", type: "post", ...row }).returning())[0]!;
const alertsOf = (taskId: string) => h.db.select().from(alert).where(eq(alert.taskId, taskId));
const dispatchesOf = (alertId: string) => h.db.select().from(notificationDispatch).where(eq(notificationDispatch.alertId, alertId));
const audits = (action: string) => h.db.select().from(auditEvent).where(eq(auditEvent.action, action));
const deliver = async (taskId: string, accountId: string, row: Partial<typeof delivery.$inferInsert> & { idempotencyKey: string }) => {
  const [version] = await h.db.insert(contentVersion).values({ taskId, n: 1, channel: "linkedin", body: "Bonjour", contentHash: `h-${row.idempotencyKey}`, createdAt: hoursAgo(200) }).returning();
  const [ok] = await h.db.insert(approval).values({ taskId, contentVersionId: version!.id, contentHash: version!.contentHash, assetSetHash: "a1", decision: "approved" }).returning();
  return (await h.db.insert(delivery).values({ taskId, socialAccountId: accountId, contentVersionId: version!.id, approvalId: ok!.id, scheduledAt: hoursAgo(1), ...row }).returning())[0]!;
};

beforeAll(async () => {
  h = await createHarness();
  admin = await h.signIn("admin@example.com");
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  adminId = await h.userIdOf(admin);
  operatorId = await h.userIdOf(operator);
  reviewerId = await h.userIdOf(reviewer);
  await h.grant(adminId, "admin");
  await h.grant(operatorId, "operator", "insight");
  await h.grant(reviewerId, "reviewer");
  await h.db.insert(product).values([
    { id: "insight", name: "Trigenys Insight" },
    { id: "atelier", name: "Atelier Maître" },
  ]);
  const accounts = await h.db
    .insert(socialAccount)
    .values([
      { productId: "insight", channel: "linkedin", provider: "mock", externalRef: "ch_1", handle: "@insight", displayName: "Insight" },
      { productId: "atelier", channel: "linkedin", provider: "mock", externalRef: "ch_2", handle: "@atelier", displayName: "Atelier" },
    ])
    .returning();
  insightAccount = accounts[0]!.id;
  atelierAccount = accounts[1]!.id;
}, 60_000);
afterAll(() => h?.close());

describe("rules", () => {
  const base = { id: "t", productId: "insight", title: "T", type: "post", lastActivityAt: now, awaitingSince: null, dueAt: null } as const;
  it("derives one alert per task by precedence, with stable facts", () => {
    expect(taskAlert({ ...base, state: "rejected", dueAt: hoursAgo(1) }, now)).toMatchObject({ kind: "content_fix", priority: "p1" });
    expect(taskAlert({ ...base, state: "needs_fix", dueAt: hoursAhead(48) }, now)).toMatchObject({ kind: "content_fix", priority: "p2" });
    expect(taskAlert({ ...base, state: "awaiting_approval", awaitingSince: hoursAgo(30) }, now)).toMatchObject({ kind: "approval_required", priority: "p2" });
    expect(taskAlert({ ...base, state: "awaiting_approval", awaitingSince: hoursAgo(2) }, now)).toBeNull();
    expect(taskAlert({ ...base, state: "preparing", dueAt: hoursAgo(1) }, now)).toMatchObject({ kind: "task_blocked", priority: "p1", facts: { reason: "overdue" } });
    expect(taskAlert({ ...base, state: "published", dueAt: hoursAgo(1) }, now)).toBeNull();
    expect(taskAlert({ ...base, state: "qualifying", lastActivityAt: hoursAgo(100) }, now)).toMatchObject({ kind: "task_blocked", priority: "p3", facts: { reason: "stalled" } });
    expect(taskAlert({ ...base, state: "qualifying", lastActivityAt: hoursAgo(100) }, now, { ...DEFAULT_ALERT_TUNING, stallHours: 200 })).toBeNull();
    const d = { id: "d", taskId: "t", productId: "insight", taskTitle: "T", channel: "linkedin", lastError: null };
    expect(deliveryAlert({ ...d, status: "failed" })).toMatchObject({ kind: "publication_failed", priority: "p1", detail: expect.stringContaining("refusé") });
    expect(deliveryAlert({ ...d, status: "scheduled" })).toBeNull();
    const text = JSON.stringify(taskAlert({ ...base, state: "preparing", dueAt: hoursAgo(1) }, now));
    expect(text).not.toContain(now.toISOString());
  });

  it("reads the tuning from the Worker vars, with defaults", () => {
    expect(alertTuning({})).toEqual(DEFAULT_ALERT_TUNING);
    expect(alertTuning({ ALERT_APPROVAL_HOURS: "4", ALERT_STALL_HOURS: "x", ALERT_DUE_SOON_HOURS: "0" })).toEqual({ approvalHours: 4, stallHours: 72, dueSoonHours: 0 });
    expect(webAppUrl({})).toBeNull();
    expect(webAppUrl({ AUTH_TRUSTED_ORIGINS: " https://a.example, https://b.example" })).toBe("https://a.example");
    expect(webAppUrl({ WEB_APP_URL: "https://studio.example", AUTH_TRUSTED_ORIGINS: "https://a.example" })).toBe("https://studio.example");
  });
});

describe("reconciliation", () => {
  let fixTask: string;
  let approvalTask: string;
  let overdueTask: string;
  let failedDelivery: string;

  it("opens the backlog silently on the first pass of a database", async () => {
    const t = await mk({ title: "Déjà refusé", state: "rejected", dueAt: hoursAhead(72) });
    expect(await reconcile()).toEqual({ opened: 1, updated: 0, escalated: 0, resolved: 0, queued: 0 });
    const [a] = await alertsOf(t.id);
    expect(a).toMatchObject({ kind: "content_fix", priority: "p2", state: "open", dedupKey: `content_fix:${t.id}` });
    expect(await dispatchesOf(a!.id)).toHaveLength(0);
    const [audit] = await audits("alert.reconcile");
    expect(audit?.details).toMatchObject({ opened: 1, bootstrap: true, scope: "all" });
  });

  it("opens one alert per condition with the rule priorities and no parasite", async () => {
    fixTask = (await mk({ title: "À corriger", state: "needs_fix", dueAt: hoursAgo(2) })).id;
    approvalTask = (await mk({ title: "À approuver", state: "awaiting_approval" })).id;
    await h.db.insert(taskTransition).values({ taskId: approvalTask, fromState: "visuals", toState: "awaiting_approval", createdAt: hoursAgo(30) });
    overdueTask = (await mk({ title: "En retard", state: "preparing", dueAt: hoursAgo(24) })).id;
    const stalled = await mk({ title: "Endormie", state: "qualifying", updatedAt: hoursAgo(100) });
    const active = await mk({ title: "Commentée", state: "preparing", updatedAt: hoursAgo(100) });
    await h.db.insert(comment).values({ taskId: active.id, body: "On avance", createdAt: hoursAgo(1) });
    const fresh = await mk({ title: "Fraîche", state: "awaiting_approval" });
    await h.db.insert(taskTransition).values({ taskId: fresh.id, fromState: "visuals", toState: "awaiting_approval", createdAt: hoursAgo(2) });
    const published = await mk({ title: "Publiée", state: "published", dueAt: hoursAgo(48) });
    failedDelivery = (await deliver(published.id, insightAccount, { idempotencyKey: "d-failed", status: "failed", lastError: "Buffer: 422 invalid media" })).id;
    const scheduled = await mk({ title: "Planifiée", state: "scheduled" });
    await deliver(scheduled.id, insightAccount, { idempotencyKey: "d-ok", status: "scheduled" });

    const report = await reconcile();
    expect(report).toMatchObject({ opened: 5, updated: 0, escalated: 0, resolved: 0 });
    expect((await alertsOf(fixTask))[0]).toMatchObject({ kind: "content_fix", priority: "p1" }); // precedence over overdue
    expect((await alertsOf(approvalTask))[0]).toMatchObject({ kind: "approval_required", priority: "p2" });
    expect((await alertsOf(overdueTask))[0]).toMatchObject({ kind: "task_blocked", priority: "p1", facts: { reason: "overdue" } });
    expect((await alertsOf(stalled.id))[0]).toMatchObject({ kind: "task_blocked", priority: "p3", facts: { reason: "stalled" } });
    expect((await alertsOf(published.id))[0]).toMatchObject({ kind: "publication_failed", priority: "p1", deliveryId: failedDelivery, detail: "Buffer: 422 invalid media" });
    for (const t of [active, fresh, scheduled]) expect(await alertsOf(t.id)).toHaveLength(0);

    // E-mails: approval_required → admin + reviewer; publication_failed → admin + operator (insight); the rest off by default.
    expect(report.queued).toBe(4);
    const approvalMails = await dispatchesOf((await alertsOf(approvalTask))[0]!.id);
    expect(approvalMails.map((d) => d.userId).sort()).toEqual([adminId, reviewerId].sort());
    expect(approvalMails[0]).toMatchObject({ status: "pending", channel: "email", attempts: 0, priority: "p2" });
    const failedMails = await dispatchesOf((await alertsOf(published.id))[0]!.id);
    expect(failedMails.map((d) => d.userId).sort()).toEqual([adminId, operatorId].sort());
    expect(await dispatchesOf((await alertsOf(fixTask))[0]!.id)).toHaveLength(0);
  });

  it("writes nothing on a second pass over the same facts", async () => {
    const before = (await audits("alert.reconcile")).length;
    const versions = (await h.db.select({ v: alert.version }).from(alert)).map((r) => r.v);
    expect(await reconcile()).toEqual({ opened: 0, updated: 0, escalated: 0, resolved: 0, queued: 0 });
    expect((await audits("alert.reconcile")).length).toBe(before);
    expect((await h.db.select({ v: alert.version }).from(alert)).map((r) => r.v)).toEqual(versions);
  });

  it("honours preferences and the audience scoped to the product", async () => {
    await h.db.insert(notificationPreference).values([
      { userId: reviewerId, kind: "approval_required", email: "off" },
      { userId: operatorId, kind: "content_fix", email: "immediate" },
    ]);
    const waiting = await mk({ title: "Attente longue", state: "awaiting_approval" });
    await h.db.insert(taskTransition).values({ taskId: waiting.id, fromState: "visuals", toState: "awaiting_approval", createdAt: hoursAgo(48) });
    const fix = await mk({ title: "Correction voulue", state: "needs_fix" });
    const atelier = await mk({ title: "Atelier", productId: "atelier", state: "published" });
    await deliver(atelier.id, atelierAccount, { idempotencyKey: "d-atelier", status: "failed" });
    expect(await reconcile()).toMatchObject({ opened: 3, queued: 3 });
    expect((await dispatchesOf((await alertsOf(waiting.id))[0]!.id)).map((d) => d.userId)).toEqual([adminId]);
    expect((await dispatchesOf((await alertsOf(fix.id))[0]!.id)).map((d) => d.userId)).toEqual([operatorId]);
    expect((await dispatchesOf((await alertsOf(atelier.id))[0]!.id)).map((d) => d.userId)).toEqual([adminId]);
  });

  it("resolves an alert whose condition is gone and opens a new one if it comes back", async () => {
    await h.db.update(task).set({ state: "published" }).where(eq(task.id, overdueTask));
    expect(await reconcile()).toMatchObject({ resolved: 1, opened: 0 });
    const [resolved] = await alertsOf(overdueTask);
    expect(resolved).toMatchObject({ state: "resolved", resolution: "La condition n'est plus remplie.", version: 2 });
    expect(resolved!.resolvedAt).toEqual(now);
    await h.db.update(task).set({ state: "preparing" }).where(eq(task.id, overdueTask));
    expect(await reconcile()).toMatchObject({ opened: 1 });
    const rows = await alertsOf(overdueTask);
    expect(rows.map((r) => r.state).sort()).toEqual(["open", "resolved"]);
  });

  it("reopens an acknowledged alert on escalation and mails it again; a downgrade is silent", async () => {
    const [a] = await alertsOf(approvalTask);
    const ack = await post(`/alerts/${a!.id}/acknowledge`, {}, admin);
    expect(ack.status, await ack.clone().text()).toBe(200);
    expect(await parse(ack)).toMatchObject({ state: "acknowledged", acknowledgedBy: adminId });

    await h.db.update(task).set({ dueAt: hoursAhead(6) }).where(eq(task.id, approvalTask));
    expect(await reconcile()).toMatchObject({ escalated: 1, updated: 0, queued: 1 });
    const [escalated] = await alertsOf(approvalTask);
    expect(escalated).toMatchObject({ priority: "p1", state: "open", acknowledgedBy: null, acknowledgedAt: null, version: 3 });
    const mails = await dispatchesOf(a!.id);
    expect(mails.filter((d) => d.priority === "p1").map((d) => d.userId)).toEqual([adminId]);

    await h.db.update(task).set({ dueAt: null }).where(eq(task.id, approvalTask));
    expect(await reconcile()).toMatchObject({ escalated: 0, updated: 1, queued: 0 });
    expect((await alertsOf(approvalTask))[0]).toMatchObject({ priority: "p2", state: "open", version: 4 });
  });

  it("reconciles the task right after a transition or a decision, through the routes", async () => {
    const created = await parse(await post("/tasks", { productId: "insight", type: "post", title: "Via API" }, operator));
    const move = (to: string, token: string) => post(`/tasks/${created.id}/transitions`, { to }, token);
    expect((await move("preparing", operator)).status).toBe(200);
    expect((await post(`/tasks/${created.id}/versions`, { channel: "linkedin", body: "Bonjour" }, operator)).status).toBe(201);
    expect((await move("reviewing", operator)).status).toBe(200);
    expect((await move("needs_fix", reviewer)).status).toBe(200);
    const open = await parse(await h.request(`/alerts?state=open`, {}, operator));
    expect(open.find((x: { taskId: string }) => x.taskId === created.id)).toMatchObject({ kind: "content_fix", priority: "p2", taskTitle: "Via API", taskState: "needs_fix" });
    expect((await move("preparing", operator)).status).toBe(200);
    expect((await parse(await h.request(`/alerts?state=open`, {}, operator))).some((x: { taskId: string }) => x.taskId === created.id)).toBe(false);
    expect((await parse(await h.request(`/alerts?state=resolved`, {}, operator))).find((x: { taskId: string }) => x.taskId === created.id)).toMatchObject({ state: "resolved" });
    const scoped = (await audits("alert.reconcile")).filter((e) => (e.details as { scope?: unknown }).scope !== "all");
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.at(-1)?.actorId).toBe(operatorId);
  });
});

describe("notifications", () => {
  const failing: Mailer = {
    name: "down-mailer",
    async send() {
      throw new Error("smtp: connection refused");
    },
  };
  const pendingDispatches = () => h.db.select().from(notificationDispatch).where(eq(notificationDispatch.status, "pending"));

  it("sends every pending e-mail with a link to the task and audits each one without the address", async () => {
    const pending = await pendingDispatches();
    const openIds = new Set((await h.db.select({ id: alert.id }).from(alert).where(eq(alert.state, "open"))).map((r) => r.id));
    const sendable = pending.filter((d) => openIds.has(d.alertId)).length;
    expect(sendable).toBeGreaterThan(0);
    const before = h.mailer.sent.length;
    const report = await notify();
    // The e-mail queued for the alert that the route pass resolved is skipped, not sent.
    expect(report).toMatchObject({ claimed: sendable, sent: sendable, retried: 0, failed: 0, skipped: pending.length - sendable });
    const mails = h.mailer.sent.slice(before);
    expect(mails.every((m) => m.template === "alert")).toBe(true);
    const [a] = await alertsOf((await h.db.select().from(task).where(eq(task.title, "À approuver")))[0]!.id);
    const mail = mails.find((m) => m.subject.includes("À approuver"));
    expect(mail?.subject).toBe(`[Studio] P2 · ${a!.title}`);
    expect(mail?.text).toContain(`https://studio.example/tasks/${a!.taskId}`);
    const failedMail = mails.find((m) => m.subject.includes("Publiée"));
    expect(failedMail?.text).toMatch(/\/tasks\/[0-9a-f-]{36}#publication/);
    const sends = await audits("notification.send");
    expect(sends.length).toBe(pending.length);
    expect(sends.filter((e) => e.details?.result === "sent")).toHaveLength(sendable);
    expect(sends.every((e) => !JSON.stringify(e.details).includes("@"))).toBe(true);
    expect(await pendingDispatches()).toHaveLength(0);
    // Nothing is sent twice.
    expect(await notify()).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 });
  });

  it("retries with backoff, audits every attempt and fails after the last one", async () => {
    const [a] = await alertsOf((await h.db.select().from(task).where(eq(task.title, "Correction voulue")))[0]!.id);
    const [d] = await h.db
      .insert(notificationDispatch)
      .values({ alertId: a!.id, userId: adminId, dedupKey: `${a!.id}:${adminId}:email:retry`, priority: a!.priority, nextRetryAt: now })
      .returning();
    expect(await notify({ mailer: failing })).toMatchObject({ claimed: 1, retried: 1 });
    let row = (await dispatchesOf(a!.id)).find((r) => r.id === d!.id)!;
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "smtp: connection refused", provider: "down-mailer" });
    expect(row.nextRetryAt!.getTime()).toBeGreaterThan(now.getTime());
    // Not due yet: nothing is claimed.
    expect(await notify({ mailer: failing })).toMatchObject({ claimed: 0 });
    const later = () => new Date(now.getTime() + 86_400_000);
    expect(await notify({ mailer: failing, now: later })).toMatchObject({ claimed: 1, retried: 1 });
    expect(await notify({ mailer: failing, now: () => new Date(now.getTime() + 2 * 86_400_000) })).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    row = (await dispatchesOf(a!.id)).find((r) => r.id === d!.id)!;
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    const trail = (await audits("notification.send")).filter((e) => e.details?.dispatchId === d!.id).map((e) => e.details?.result);
    expect(trail).toEqual(["retry", "retry", "failed"]);
    const listed = await parse(await h.request(`/alerts?state=open`, {}, admin));
    expect(listed.find((x: { id: string }) => x.id === a!.id)).toMatchObject({ emailStatus: "failed" });
  });

  it("skips e-mails for alerts acknowledged or resolved before sending, and without WEB_APP_URL", async () => {
    const [acked] = await h.db.select().from(alert).where(and(eq(alert.state, "open"), eq(alert.kind, "task_blocked"))).limit(1);
    expect((await post(`/alerts/${acked!.id}/acknowledge`, {}, admin)).status).toBe(200);
    const [resolved] = await h.db.select().from(alert).where(eq(alert.state, "resolved")).limit(1);
    const [open] = await h.db.select().from(alert).where(and(eq(alert.state, "open"), eq(alert.kind, "publication_failed"))).limit(1);
    const rows = await h.db
      .insert(notificationDispatch)
      .values([
        { alertId: acked!.id, userId: adminId, dedupKey: `${acked!.id}:skip-ack`, priority: "p2", nextRetryAt: now },
        { alertId: resolved!.id, userId: adminId, dedupKey: `${resolved!.id}:skip-resolved`, priority: "p2", nextRetryAt: now },
      ])
      .returning();
    const before = h.mailer.sent.length;
    expect(await notify()).toMatchObject({ claimed: 0, skipped: 2, sent: 0 });
    expect(h.mailer.sent.length).toBe(before);
    const after = await Promise.all(rows.map((r) => h.db.select().from(notificationDispatch).where(eq(notificationDispatch.id, r.id)).then((x) => x[0]!)));
    expect(after.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(after[0]!.lastError).toContain("acquittée");
    expect(after[1]!.lastError).toContain("résolue");

    const [noUrl] = await h.db
      .insert(notificationDispatch)
      .values({ alertId: open!.id, userId: adminId, dedupKey: `${open!.id}:skip-url`, priority: "p1", nextRetryAt: now })
      .returning();
    expect(await notify({ webAppUrl: null })).toMatchObject({ skipped: 1, sent: 0 });
    const [u] = await h.db.select().from(notificationDispatch).where(eq(notificationDispatch.id, noUrl!.id));
    expect(u).toMatchObject({ status: "skipped", lastError: expect.stringContaining("WEB_APP_URL") });
    expect((await audits("notification.send")).filter((e) => e.details?.result === "skipped").length).toBeGreaterThanOrEqual(3);
  });

  it("fails a claim whose lease expired as uncertain and never sends it", async () => {
    const [open] = await h.db.select().from(alert).where(eq(alert.state, "open")).limit(1);
    const [stuck] = await h.db
      .insert(notificationDispatch)
      .values({ alertId: open!.id, userId: adminId, dedupKey: `${open!.id}:stuck`, priority: "p1", status: "sending", attempts: 1, claimedUntil: hoursAgo(1) })
      .returning();
    const before = h.mailer.sent.length;
    expect(await notify()).toMatchObject({ claimed: 0, failed: 1, sent: 0 });
    expect(h.mailer.sent.length).toBe(before);
    const [row] = await h.db.select().from(notificationDispatch).where(eq(notificationDispatch.id, stuck!.id));
    expect(row).toMatchObject({ status: "failed", claimedUntil: null, lastError: expect.stringContaining("incertaine") });
    expect((await audits("notification.send")).find((e) => e.details?.dispatchId === stuck!.id)?.details?.result).toBe("uncertain");
    expect(await notify()).toMatchObject({ claimed: 0, failed: 0 });
  });
});

describe("routes", () => {
  it("lists alerts within the caller's products and audience, sorted by priority, with filters", async () => {
    expect((await h.request("/alerts")).status).toBe(401);
    const all = await parse(await h.request("/alerts", {}, admin));
    expect(all.length).toBeGreaterThan(3);
    const ranks = all.map((a: { priority: string }) => a.priority);
    expect([...ranks].sort()).toEqual(ranks);
    expect(all.every((a: { state: string }) => a.state !== "resolved")).toBe(true);
    expect(all.some((a: { productId: string }) => a.productId === "atelier")).toBe(true);

    const mine = await parse(await h.request("/alerts", {}, operator));
    expect(mine.every((a: { productId: string; kind: string }) => a.productId === "insight" && a.kind !== "approval_required")).toBe(true);
    const theirs = await parse(await h.request("/alerts", {}, reviewer));
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((a: { kind: string }) => a.kind === "approval_required")).toBe(true);

    const p1 = await parse(await h.request("/alerts?priority=p1&productId=insight", {}, admin));
    expect(p1.every((a: { priority: string; productId: string }) => a.priority === "p1" && a.productId === "insight")).toBe(true);
    expect((await h.request("/alerts?state=nope", {}, admin)).status).toBe(400);
    const resolved = await parse(await h.request("/alerts?state=resolved", {}, admin));
    expect(resolved.every((a: { state: string; resolvedAt: string | null }) => a.state === "resolved" && a.resolvedAt !== null)).toBe(true);
  });

  it("acknowledges once, within the audience, and never a resolved alert", async () => {
    expect((await post(`/alerts/${crypto.randomUUID()}/acknowledge`, {}, admin)).status).toBe(404);
    const [fix] = await h.db.select().from(alert).where(and(eq(alert.kind, "content_fix"), eq(alert.state, "open"))).limit(1);
    expect((await post(`/alerts/${fix!.id}/acknowledge`, {}, reviewer)).status).toBe(403);
    const before = (await audits("alert.acknowledge")).length;
    const first = await parse(await post(`/alerts/${fix!.id}/acknowledge`, {}, operator));
    expect(first).toMatchObject({ state: "acknowledged", acknowledgedBy: operatorId, version: fix!.version + 1 });
    const again = await parse(await post(`/alerts/${fix!.id}/acknowledge`, {}, admin));
    expect(again).toMatchObject({ state: "acknowledged", acknowledgedBy: operatorId, version: fix!.version + 1 });
    expect((await audits("alert.acknowledge")).length).toBe(before + 1);
    const [resolved] = await h.db.select().from(alert).where(eq(alert.state, "resolved")).limit(1);
    expect((await post(`/alerts/${resolved!.id}/acknowledge`, {}, admin)).status).toBe(409);
  });

  it("lets an admin run the reconciliation now, idempotently", async () => {
    expect((await post("/alerts/reconcile", {}, operator)).status).toBe(403);
    const headers = { "idempotency-key": crypto.randomUUID() };
    const res = await post("/alerts/reconcile", {}, admin, headers);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await parse(res);
    expect(body).toEqual({
      reconcile: { opened: expect.any(Number), updated: expect.any(Number), escalated: expect.any(Number), resolved: expect.any(Number), queued: expect.any(Number) },
      notify: { claimed: expect.any(Number), sent: expect.any(Number), retried: expect.any(Number), failed: expect.any(Number), skipped: expect.any(Number) },
    });
    expect(await parse(await post("/alerts/reconcile", {}, admin, headers))).toEqual(body);
  });

  it("exposes notification preferences with code defaults and upserts only the changes", async () => {
    const defaults = await parse(await h.request("/me/notification-preferences", {}, admin));
    expect(defaults).toEqual([
      { kind: "task_blocked", email: "off", source: "default" },
      { kind: "content_fix", email: "off", source: "default" },
      { kind: "approval_required", email: "immediate", source: "default" },
      { kind: "publication_failed", email: "immediate", source: "default" },
    ]);
    expect((await h.request("/me/notification-preferences")).status).toBe(401);
    expect((await patch("/me/notification-preferences", { preferences: [{ kind: "bogus", email: "off" }] }, admin)).status).toBe(400);
    const before = (await audits("notification.preferences")).length;
    const updated = await parse(await patch("/me/notification-preferences", { preferences: [{ kind: "task_blocked", email: "immediate" }] }, admin));
    expect(updated.find((p: { kind: string }) => p.kind === "task_blocked")).toEqual({ kind: "task_blocked", email: "immediate", source: "user" });
    expect((await audits("notification.preferences")).length).toBe(before + 1);
    await patch("/me/notification-preferences", { preferences: [{ kind: "task_blocked", email: "immediate" }] }, admin);
    expect((await audits("notification.preferences")).length).toBe(before + 1);
    const back = await parse(await patch("/me/notification-preferences", { preferences: [{ kind: "task_blocked", email: "off" }] }, admin));
    expect(back.find((p: { kind: string }) => p.kind === "task_blocked")).toMatchObject({ email: "off", source: "user" });
    const reviewerPrefs = await parse(await h.request("/me/notification-preferences", {}, reviewer));
    expect(reviewerPrefs.find((p: { kind: string }) => p.kind === "approval_required")).toEqual({ kind: "approval_required", email: "off", source: "user" });
  });
});
