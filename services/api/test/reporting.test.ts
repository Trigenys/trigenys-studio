import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approval, contentVersion, delivery, importItem, metricSnapshot, product, socialAccount, task, taskTransition } from "../src/db/schema.ts";
import { MockMetrics } from "../src/integrations/mock/index.ts";
import type { MetricSnapshot, MetricTarget, MetricsProvider } from "../src/integrations/types.ts";
import { runScheduledMetrics } from "../src/publishing/scheduled.ts";
import { refreshMetrics } from "../src/reporting/refresh.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// Editorial report and verified metrics (ADR 0010). Two harnesses: one with
// the mock metrics (never a measure) and one with a verified provider whose
// answers the test scripts.

class FakeVerified implements MetricsProvider {
  readonly name = "fake-seo-monitor";
  readonly verified = true;
  readonly calls: MetricTarget[] = [];
  failing = new Set<string>();
  missing = new Set<string>();
  measuredAt = "2026-11-10T06:00:00Z";
  async fetch(target: MetricTarget): Promise<MetricSnapshot | null> {
    this.calls.push(target);
    if (this.failing.has(target.ref)) throw new Error(`upstream down for ${target.ref}`);
    if (this.missing.has(target.ref)) return null;
    return { target, measuredAt: this.measuredAt, metrics: { impressions: 100, clicks: 7 } };
  }
}

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();

type Seeded = { h: Harness; admin: string; operator: string; reviewer: string; adminId: string; articleId: string; postId: string; deliveryId: string };

// November 2026 fixtures for the insight product plus one atelier task:
// - article due 5 Nov, published 6 Nov with a CMS URL;
// - post due 10 Nov, published 12 Nov, one delivery sent 12 Nov on LinkedIn;
// - post due 15 Nov, still in preparation (late once now > 15 Nov);
// - post due 20 Nov, rejected (never late);
// - article due in December (out of the month);
// - atelier post due 3 Nov, published 4 Nov.
async function seed(h: Harness): Promise<Seeded> {
  const admin = await h.signIn("admin@example.com");
  const operator = await h.signIn("operator@example.com");
  const reviewer = await h.signIn("reviewer@example.com");
  const adminId = await h.userIdOf(admin);
  await h.grant(adminId, "admin");
  await h.grant(await h.userIdOf(operator), "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([
    { id: "insight", name: "Trigenys Insight" },
    { id: "atelier", name: "Atelier Maître" },
  ]);
  const db = h.db;
  const mk = async (row: Partial<typeof task.$inferInsert> & { productId: string; type: string; title: string }) => (await db.insert(task).values(row).returning())[0]!.id;
  const publishedAt = async (taskId: string, at: string) => {
    await db.insert(taskTransition).values([
      { taskId, fromState: "approved", toState: "scheduled", createdAt: new Date(new Date(at).getTime() - 3600_000) },
      { taskId, fromState: "scheduled", toState: "published", createdAt: new Date(at) },
    ]);
  };
  const articleId = await mk({ productId: "insight", type: "article", title: "Neon vs Supabase", state: "published", dueAt: new Date("2026-11-05T09:00:00Z") });
  await publishedAt(articleId, "2026-11-06T08:00:00Z");
  await db.insert(importItem).values({
    origin: "cms",
    externalRef: "12:fr",
    title: "Neon vs Supabase",
    url: "https://insight.example/fr/posts/neon-vs-supabase",
    observedAt: new Date("2026-11-06T08:00:00Z"),
    status: "linked",
    taskId: articleId,
  });
  const postId = await mk({ productId: "insight", type: "post", title: "Lancement", state: "published", dueAt: new Date("2026-11-10T09:00:00Z") });
  await publishedAt(postId, "2026-11-12T10:00:00Z");
  const lateId = await mk({ productId: "insight", type: "post", title: "En retard", state: "preparing", dueAt: new Date("2026-11-15T09:00:00Z") });
  const rejectedId = await mk({ productId: "insight", type: "post", title: "Refusé", state: "rejected", dueAt: new Date("2026-11-20T09:00:00Z") });
  await mk({ productId: "insight", type: "article", title: "Décembre", state: "qualifying", dueAt: new Date("2026-12-02T09:00:00Z") });
  const atelierId = await mk({ productId: "atelier", type: "post", title: "Atelier", state: "published", dueAt: new Date("2026-11-03T09:00:00Z") });
  await publishedAt(atelierId, "2026-11-04T10:00:00Z");

  const [account] = await db
    .insert(socialAccount)
    .values({ productId: "insight", channel: "linkedin", provider: "mock", externalRef: "ch_1", handle: "@insight", displayName: "Insight" })
    .returning();
  // One non-cancelled delivery per task and account: each delivery gets its own task.
  const deliver = async (taskId: string, row: Partial<typeof delivery.$inferInsert> & { idempotencyKey: string }) => {
    const [version] = await db.insert(contentVersion).values({ taskId, n: 1, channel: "linkedin", body: "Bonjour", contentHash: `h-${row.idempotencyKey}` }).returning();
    const [ok] = await db.insert(approval).values({ taskId, contentVersionId: version!.id, contentHash: version!.contentHash, assetSetHash: "a1", decision: "approved" }).returning();
    return (await db.insert(delivery).values({ taskId, socialAccountId: account!.id, contentVersionId: version!.id, approvalId: ok!.id, ...row }).returning())[0]!;
  };
  const sent = await deliver(postId, { idempotencyKey: "d1", status: "sent", scheduledAt: new Date("2026-11-12T09:00:00Z"), sentAt: new Date("2026-11-12T10:00:00Z"), permalink: "https://www.linkedin.com/feed/update/urn:li:share:1" });
  await deliver(lateId, { idempotencyKey: "d2", status: "failed", scheduledAt: new Date("2026-11-13T09:00:00Z"), lastError: "boom" });
  await deliver(rejectedId, { idempotencyKey: "d3", status: "scheduled", scheduledAt: new Date("2026-11-28T09:00:00Z") });
  const octoberId = await mk({ productId: "insight", type: "post", title: "Octobre", state: "published", dueAt: new Date("2026-10-28T09:00:00Z") });
  await publishedAt(octoberId, "2026-10-30T09:05:00Z");
  await deliver(octoberId, { idempotencyKey: "d4", status: "sent", scheduledAt: new Date("2026-10-30T09:00:00Z"), sentAt: new Date("2026-10-30T09:05:00Z"), permalink: "https://www.linkedin.com/feed/update/urn:li:share:0" });
  return { h, admin, operator, reviewer, adminId, articleId, postId, deliveryId: sent.id };
}

describe("editorial report (operational regime)", () => {
  let s: Seeded;
  const get = (path: string, token: string) => s.h.request(path, {}, token);
  beforeAll(async () => {
    s = await seed(await createHarness({ integrations: { metrics: new MockMetrics() } }));
  }, 60_000);
  afterAll(() => s?.h.close());

  it("counts due, done and late per product and type for the month, in UTC", async () => {
    const res = await get("/reports/editorial?month=2026-11", s.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await parse(res);
    expect(r).toMatchObject({ month: "2026-11", from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" });
    // Fixed fixtures, real clock: "En retard" (due 15 Nov 2026) is late only once that date has passed.
    const lateExpected = Date.now() > Date.parse("2026-11-15T09:00:00Z") ? 1 : 0;
    expect(r.operational.tasks).toEqual([
      { productId: "atelier", type: "post", due: 1, done: 1, late: 0 },
      { productId: "insight", type: "article", due: 1, done: 1, late: 0 },
      { productId: "insight", type: "post", due: 3, done: 1, late: lateExpected },
    ]);
    expect(r.operational.publishedArticles).toEqual([
      { taskId: s.articleId, productId: "insight", title: "Neon vs Supabase", publishedAt: "2026-11-06T08:00:00.000Z", url: "https://insight.example/fr/posts/neon-vs-supabase" },
    ]);
    expect(r.operational.campaigns).toEqual([{ productId: "insight", channel: "linkedin", scheduled: 1, handedOff: 0, sent: 1, failed: 1, cancelled: 0 }]);
    expect(r.products.map((p: { id: string }) => p.id)).toEqual(["atelier", "insight"]);
  });

  it("says the verified section is not connected, with no number, when only the mock is configured", async () => {
    const r = await parse(await get("/reports/editorial?month=2026-11&productId=insight", s.admin));
    expect(r.verified).toEqual([{ productId: "insight", status: "not_connected", reason: expect.stringContaining("mock-metrics") }]);
    expect(JSON.stringify(r.verified)).not.toMatch(/impressions|clicks|snapshots/);
    expect(r.products).toEqual([{ id: "insight", name: "Trigenys Insight", seoMonitorUrl: null }]);
  });

  it("scopes the report to the caller's products and refuses others", async () => {
    const mine = await parse(await get("/reports/editorial?month=2026-11", s.operator));
    expect(mine.operational.tasks.map((t: { productId: string }) => t.productId)).toEqual(["insight", "insight"]);
    expect(mine.products.map((p: { id: string }) => p.id)).toEqual(["insight"]);
    expect((await get("/reports/editorial?month=2026-11&productId=atelier", s.operator)).status).toBe(403);
    expect((await get("/reports/editorial?month=2026-11&productId=nope", s.admin)).status).toBe(404);
    expect((await get("/reports/editorial?month=2026-13", s.admin)).status).toBe(400);
  });

  it("defaults to the current month and reports zero rows outside the fixtures", async () => {
    const r = await parse(await get("/reports/editorial?month=2025-01", s.admin));
    expect(r.operational).toEqual({ tasks: [], publishedArticles: [], campaigns: [] });
    const current = await parse(await get("/reports/editorial", s.admin));
    expect(current.month).toBe(new Date().toISOString().slice(0, 7));
  });

  it("manages contract objectives: admin only, one active per scope, versioned, deactivated not deleted", async () => {
    const post = (path: string, body: unknown, token: string) => s.h.request(path, { method: "POST", headers: json, body: JSON.stringify(body) }, token);
    const patch = (path: string, body: unknown, token: string) => s.h.request(path, { method: "PATCH", headers: json, body: JSON.stringify(body) }, token);
    expect((await post("/products/insight/objectives", { metric: "tasks_completed", target: 4 }, s.operator)).status).toBe(403);
    expect((await post("/products/nope/objectives", { metric: "tasks_completed", target: 4 }, s.admin)).status).toBe(404);
    expect((await post("/products/insight/objectives", { metric: "tasks_completed", target: 0 }, s.admin)).status).toBe(400);
    expect((await post("/products/insight/objectives", { metric: "tasks_completed", channel: "linkedin", target: 2 }, s.admin)).status).toBe(400);

    const created = await post("/products/insight/objectives", { metric: "tasks_completed", target: 4 }, s.admin);
    expect(created.status, await created.clone().text()).toBe(201);
    const o1 = await parse(created);
    expect(o1).toMatchObject({ productId: "insight", metric: "tasks_completed", taskType: null, channel: null, period: "month", target: 4, active: true, version: 1, createdBy: s.adminId });
    expect((await post("/products/insight/objectives", { metric: "tasks_completed", target: 9 }, s.admin)).status).toBe(409);
    const o2 = await parse(await post("/products/insight/objectives", { metric: "tasks_completed", taskType: "post", target: 3 }, s.admin));
    const o3 = await parse(await post("/products/insight/objectives", { metric: "articles_published", target: 2 }, s.admin));
    const o4 = await parse(await post("/products/insight/objectives", { metric: "deliveries_sent", channel: "linkedin", target: 2 }, s.admin));
    expect([o2.id, o3.id, o4.id].every(Boolean)).toBe(true);

    const report = await parse(await get("/reports/editorial?month=2026-11&productId=insight", s.reviewer));
    expect(report.objectives.map((p: { objective: { id: string }; actual: number; ratio: number }) => [p.objective.id, p.actual, p.ratio])).toEqual([
      [o3.id, 1, 0.5],
      [o4.id, 1, 0.5],
      [o1.id, 2, 0.5],
      [o2.id, 1, 0.333],
    ]);

    expect((await patch(`/objectives/${o1.id}`, { version: 7, target: 6 }, s.admin)).status).toBe(409);
    expect((await patch(`/objectives/${o1.id}`, { version: 1, target: 6 }, s.operator)).status).toBe(403);
    const bumped = await parse(await patch(`/objectives/${o1.id}`, { version: 1, target: 6 }, s.admin));
    expect(bumped).toMatchObject({ target: 6, version: 2 });
    const off = await parse(await patch(`/objectives/${o2.id}`, { version: 1, active: false }, s.admin));
    expect(off).toMatchObject({ active: false, version: 2 });
    // A new objective may take the freed scope; the old row stays listed.
    expect((await post("/products/insight/objectives", { metric: "tasks_completed", taskType: "post", target: 5 }, s.admin)).status).toBe(201);
    const list = await parse(await get("/products/insight/objectives", s.reviewer));
    expect(list).toHaveLength(5);
    expect(list.filter((o: { active: boolean }) => !o.active).map((o: { id: string }) => o.id)).toEqual([o2.id]);
    expect((await get("/products/insight/objectives", s.operator)).status).toBe(200);
    expect((await get("/products/atelier/objectives", s.operator)).status).toBe(403);
    const after = await parse(await get("/reports/editorial?month=2026-11&productId=insight", s.admin));
    expect(after.objectives.map((p: { objective: { id: string } }) => p.objective.id)).not.toContain(o2.id);
  });

  it("refuses a metrics refresh while no verified provider is connected", async () => {
    const res = await s.h.request("/reports/metrics/refresh", { method: "POST", headers: json, body: JSON.stringify({}) }, s.admin);
    expect(res.status).toBe(409);
    const body = await parse(res);
    expect(body.type).toBe("https://trigenys.com/problems/metrics-not-connected");
    expect(body.detail).toMatch(/METRICS_BASE_URL/);
    expect((await s.h.request("/reports/metrics/refresh", { method: "POST", headers: json, body: JSON.stringify({}) }, s.operator)).status).toBe(403);
    await expect(refreshMetrics({ db: s.h.db, provider: new MockMetrics(), staleMinutes: 1, batch: 5 })).rejects.toThrow(/not a verified source/);
  });

  it("lets an admin set the SEO Monitor URL of a product (https only)", async () => {
    const patch = (path: string, body: unknown, token: string) => s.h.request(path, { method: "PATCH", headers: json, body: JSON.stringify(body) }, token);
    expect((await patch("/products/insight", { seoMonitorUrl: "http://seo.example/insight" }, s.admin)).status).toBe(400);
    expect((await patch("/products/insight", { seoMonitorUrl: "https://seo.example/insight" }, s.operator)).status).toBe(403);
    expect((await patch("/products/nope", { seoMonitorUrl: "https://seo.example/insight" }, s.admin)).status).toBe(404);
    const res = await patch("/products/insight", { seoMonitorUrl: "https://seo.example/insight" }, s.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await parse(res)).toMatchObject({ id: "insight", seoMonitorUrl: "https://seo.example/insight" });
    const r = await parse(await get("/reports/editorial?month=2026-11&productId=insight", s.operator));
    expect(r.products[0].seoMonitorUrl).toBe("https://seo.example/insight");
    expect(await parse(await patch("/products/insight", { seoMonitorUrl: null }, s.admin))).toMatchObject({ seoMonitorUrl: null });
  });
});

describe("verified metrics (connected provider)", () => {
  let s: Seeded;
  const provider = new FakeVerified();
  const refresh = (body: unknown = {}, headers: Record<string, string> = {}) =>
    s.h.request("/reports/metrics/refresh", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, s.admin);
  beforeAll(async () => {
    s = await seed(await createHarness({ integrations: { metrics: provider } }));
  }, 60_000);
  afterAll(() => s?.h.close());

  it("snapshots every published target once, then writes nothing on a rerun", async () => {
    const first = await refresh({ now: "2026-11-12T12:00:00Z" });
    expect(first.status, await first.clone().text()).toBe(200);
    // Two sent deliveries with a permalink (Oct and Nov) + one published article with a URL.
    expect(await parse(first)).toEqual({ provider: "fake-seo-monitor", considered: 3, written: 3, unchanged: 0, errors: [] });
    expect(provider.calls.map((c) => c.kind).sort()).toEqual(["deliverable", "deliverable", "url"]);
    const again = await parse(await refresh({ now: "2026-11-12T12:30:00Z" }));
    expect(again).toEqual({ provider: "fake-seo-monitor", considered: 0, written: 0, unchanged: 0, errors: [] });
    // Past the staleness window the targets are fetched again, but the same measurement is not stored twice.
    const later = await parse(await refresh({ now: "2026-11-13T12:00:00Z" }));
    expect(later).toMatchObject({ considered: 3, written: 0, unchanged: 3 });
    expect(await s.h.db.select({ id: metricSnapshot.id }).from(metricSnapshot)).toHaveLength(3);
  });

  it("keeps going when one target fails and reports it", async () => {
    provider.failing.add("https://insight.example/fr/posts/neon-vs-supabase");
    provider.measuredAt = "2026-11-14T06:00:00Z";
    const r = await parse(await refresh({ now: "2026-11-14T12:00:00Z" }));
    expect(r).toMatchObject({ considered: 3, written: 2, unchanged: 0 });
    expect(r.errors).toEqual([{ ref: "https://insight.example/fr/posts/neon-vs-supabase", message: expect.stringContaining("upstream down") }]);
    provider.failing.clear();
  });

  it("reports the latest snapshot per target of the month, with provenance and totals", async () => {
    const r = await parse(await s.h.request("/reports/editorial?month=2026-11&productId=insight", {}, s.operator));
    expect(r.verified).toHaveLength(1);
    const v = r.verified[0];
    expect(v).toMatchObject({ productId: "insight", status: "connected", provider: "fake-seo-monitor", totals: { impressions: 200, clicks: 14 } });
    expect(v.snapshots.map((x: { targetKind: string; targetRef: string; measuredAt: string; provider: string }) => [x.targetKind, x.targetRef, x.measuredAt, x.provider])).toEqual([
      ["deliverable", "https://www.linkedin.com/feed/update/urn:li:share:1", "2026-11-14T06:00:00.000Z", "fake-seo-monitor"],
      ["url", "https://insight.example/fr/posts/neon-vs-supabase", "2026-11-10T06:00:00.000Z", "fake-seo-monitor"],
    ]);
    // The October delivery was measured but is not part of November.
    const october = await parse(await s.h.request("/reports/editorial?month=2026-10&productId=insight", {}, s.operator));
    expect(october.verified[0].snapshots.map((x: { targetRef: string }) => x.targetRef)).toEqual(["https://www.linkedin.com/feed/update/urn:li:share:0"]);
    expect(await parse(await s.h.request("/reports/editorial?month=2026-11&productId=atelier", {}, s.admin))).toMatchObject({
      verified: [{ productId: "atelier", status: "connected", snapshots: [], totals: {} }],
    });
  });

  it("replays an idempotent refresh and audits it", async () => {
    const a = await parse(await refresh({ now: "2026-11-20T12:00:00Z" }, { "idempotency-key": "r-1" }));
    const b = await parse(await refresh({ now: "2026-11-20T12:00:00Z" }, { "idempotency-key": "r-1" }));
    expect(b).toEqual(a);
    expect((await refresh({ now: "2026-11-21T12:00:00Z" }, { "idempotency-key": "r-1" })).status).toBe(422);
  });

  it("treats a 'not measured yet' answer as unchanged and never touches the task state", async () => {
    provider.missing.add("https://www.linkedin.com/feed/update/urn:li:share:1");
    const r = await parse(await refresh({ now: "2026-11-30T12:00:00Z" }));
    expect(r.unchanged).toBeGreaterThanOrEqual(1);
    expect(r.errors).toEqual([]);
    expect((await s.h.db.select({ state: task.state }).from(task).where(eq(task.id, s.postId)))[0]!.state).toBe("published");
    provider.missing.clear();
  });
});

describe("scheduled metrics", () => {
  it("skips quietly when the configured provider is not verified", async () => {
    const env = { HYPERDRIVE: { connectionString: "postgres://unused" }, INTEGRATION_METRICS_MODE: "mock" } as never;
    expect(await runScheduledMetrics(env)).toBeNull();
  });
});
