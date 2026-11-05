import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { product, task } from "../src/db/schema.ts";
import { MockPublisher } from "../src/integrations/mock/index.ts";
import type { ProviderAccount, PublishRequest, PublishResult, Publisher, RemotePost } from "../src/integrations/types.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// The outbox and the routes around it, against a mock provider whose clock the
// test drives. Scripted results exercise retry and failure paths.
class ScriptedPublisher implements Publisher {
  readonly name = "scripted";
  readonly queue: PublishResult[] = [];
  readonly cancelled: string[] = [];
  readonly inner: MockPublisher;
  constructor(now: () => Date) {
    this.inner = new MockPublisher({ now });
  }
  publish(r: PublishRequest): Promise<PublishResult> {
    const next = this.queue.shift();
    return next ? Promise.resolve(next) : this.inner.publish(r);
  }
  cancel(id: string) {
    this.cancelled.push(id);
    return this.inner.cancel(id);
  }
  status(id: string): Promise<RemotePost | null> {
    return this.inner.status(id);
  }
  lookup(q: { accountRef: string; body: string; since: string }) {
    return this.inner.lookup(q);
  }
  listAccounts(): Promise<ProviderAccount[]> {
    return this.inner.listAccounts();
  }
}

const clock = { now: new Date("2026-12-05T10:00:00Z") };
const at = (iso: string) => {
  clock.now = new Date(iso);
};
const publisher = new ScriptedPublisher(() => clock.now);

let h: Harness;
let admin: string;
let operator: string;
let reviewer: string;
let linkedin: { id: string; version: number };
let facebook: { id: string };

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);
const put = (path: string, body: unknown, token: string) => h.request(path, { method: "PUT", headers: json, body: JSON.stringify(body) }, token);
const patch = (path: string, body: unknown, token: string) => h.request(path, { method: "PATCH", headers: json, body: JSON.stringify(body) }, token);
const get = (path: string, token: string) => h.request(path, {}, token);

const plan = async (taskId: string, scheduledAt: string) => {
  const res = await post(`/tasks/${taskId}/deliveries`, { socialAccountId: linkedin.id, scheduledAt }, operator);
  expect(res.status, await res.clone().text()).toBe(201);
  return parse(res);
};
const dispatchNow = async () => parse(await post("/deliveries/dispatch", { now: clock.now.toISOString() }, admin));
const taskState = async (id: string) => (await h.db.select({ state: task.state }).from(task).where(eq(task.id, id)))[0]!.state;
const deliveryOf = async (taskId: string, id: string) => (await parse(await get(`/tasks/${taskId}/deliveries`, operator))).find((d: { id: string }) => d.id === id);

beforeAll(async () => {
  h = await createHarness({ integrations: { publisher } });
  admin = await h.signIn("admin@example.com");
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  await h.grant(await h.userIdOf(admin), "admin");
  await h.grant(await h.userIdOf(operator), "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([
    { id: "insight", name: "Trigenys Insight" },
    { id: "atelier", name: "Atelier Maître" },
  ]);
});
afterAll(() => h.close());

// An approved LinkedIn post of the insight product.
const approvedTask = async (body = "Bonjour") => {
  const t = await parse(await post("/tasks", { productId: "insight", type: "post", title: "Lancement" }, operator));
  const move = (to: string) => post(`/tasks/${t.id}/transitions`, { to }, operator);
  expect((await move("preparing")).status).toBe(200);
  expect((await post(`/tasks/${t.id}/versions`, { channel: "linkedin", body }, operator)).status).toBe(201);
  for (const to of ["reviewing", "visuals", "awaiting_approval"]) expect((await move(to)).status).toBe(200);
  expect((await post(`/tasks/${t.id}/approvals`, { decision: "approved" }, reviewer)).status).toBe(201);
  expect(await taskState(t.id)).toBe("approved");
  return t.id as string;
};

describe("social accounts", () => {
  it("admin maps provider channels to products, idempotently; operators only read their products", async () => {
    const body = { productId: "insight", channel: "linkedin", provider: "buffer", externalRef: "mock-linkedin-1", handle: "@trigenys", displayName: "Trigenys" };
    expect((await post("/social-accounts", body, operator)).status).toBe(403);
    expect((await post("/social-accounts", { ...body, productId: "nope" }, admin)).status).toBe(404);
    const created = await post("/social-accounts", body, admin);
    expect(created.status).toBe(201);
    linkedin = await parse(created);
    expect((await post("/social-accounts", body, admin)).status).toBe(200);
    expect((await post("/social-accounts", { ...body, handle: "@other" }, admin)).status).toBe(409);
    facebook = await parse(
      await post("/social-accounts", { ...body, channel: "facebook", externalRef: "mock-facebook-1", handle: "trigenys.fb" }, admin),
    );
    await post("/social-accounts", { ...body, productId: "atelier", externalRef: "mock-threads-1", channel: "threads", handle: "@atelier" }, admin);

    const mine = await parse(await get("/social-accounts", operator));
    expect(mine.map((a: { productId: string }) => a.productId)).toEqual(["insight", "insight"]);
    expect((await parse(await get("/social-accounts", admin))).length).toBe(3);
    expect((await get("/social-accounts", await h.signIn("nobody@example.com"))).status).toBe(403);
  });

  it("lists the provider's channels for admins and updates with optimistic versions", async () => {
    const channels = await get("/social-accounts/provider-channels", admin);
    expect(channels.status).toBe(200);
    expect((await parse(channels)).map((c: { externalRef: string }) => c.externalRef)).toContain("mock-linkedin-1");
    expect((await get("/social-accounts/provider-channels", operator)).status).toBe(403);

    expect((await patch(`/social-accounts/${linkedin.id}`, { displayName: "Trigenys SAS", version: 99 }, admin)).status).toBe(409);
    const renamed = await patch(`/social-accounts/${linkedin.id}`, { displayName: "Trigenys SAS", version: linkedin.version }, admin);
    expect(renamed.status).toBe(200);
    linkedin = await parse(renamed);
    expect(linkedin.version).toBe(2);
    expect((await patch(`/social-accounts/${linkedin.id}`, { active: true, version: 2 }, admin)).status).toBe(200);
  });
});

describe("readiness and planning", () => {
  it("explains what blocks a publication", async () => {
    const id = await approvedTask();
    const ask = async (q: string, token = operator) => parse(await get(`/tasks/${id}/publish-readiness?${q}`, token));
    expect((await ask(`socialAccountId=${linkedin.id}&scheduledAt=2026-12-06T09:00:00Z`)).ready).toBe(true);
    const wrongChannel = await ask(`socialAccountId=${facebook.id}&scheduledAt=2026-12-06T09:00:00Z`);
    expect(wrongChannel.ready).toBe(false);
    expect(wrongChannel.checks.account.ok).toBe(false);
    expect((await ask(`socialAccountId=${linkedin.id}&scheduledAt=2020-01-01T00:00:00Z`)).checks.window.ok).toBe(false);
    expect((await ask(`socialAccountId=${linkedin.id}&scheduledAt=2026-12-06T09:00:00Z`, reviewer)).checks.permission.ok).toBe(false);
  });

  it("plans an approved task once per account, moving the task to scheduled", async () => {
    const id = await approvedTask();
    const body = { socialAccountId: linkedin.id, scheduledAt: "2026-12-06T09:00:00Z" };
    expect((await post(`/tasks/${id}/deliveries`, { ...body, socialAccountId: facebook.id }, operator)).status).toBe(422);
    expect((await post(`/tasks/${id}/deliveries`, body, reviewer)).status).toBe(403);
    const created = await post(`/tasks/${id}/deliveries`, body, operator);
    expect(created.status).toBe(201);
    const d = await parse(created);
    expect(d).toMatchObject({ status: "scheduled", attempts: 0, account: { handle: "@trigenys" } });
    expect(await taskState(id)).toBe("scheduled");
    expect((await post(`/tasks/${id}/deliveries`, body, operator)).status).toBe(200);
    expect((await post(`/tasks/${id}/deliveries`, { ...body, scheduledAt: "2026-12-07T09:00:00Z" }, operator)).status).toBe(409);

    // Moving the date needs the current version; cancelling frees the slot and the task.
    expect((await post(`/deliveries/${d.id}/schedule`, { scheduledAt: "2026-12-07T09:00:00Z", version: 42 }, operator)).status).toBe(409);
    expect((await post(`/deliveries/${d.id}/schedule`, { scheduledAt: "2027-06-01T09:00:00Z", version: d.version }, operator)).status).toBe(422);
    const moved = await parse(await post(`/deliveries/${d.id}/schedule`, { scheduledAt: "2026-12-07T09:00:00Z", version: d.version }, operator));
    expect(moved.scheduledAt).toBe("2026-12-07T09:00:00.000Z");
    const cancelled = await post(`/deliveries/${d.id}/cancel`, { version: moved.version }, operator);
    expect(cancelled.status).toBe(200);
    expect((await parse(cancelled)).status).toBe("cancelled");
    expect(await taskState(id)).toBe("approved");
    expect((await post(`/deliveries/${d.id}/cancel`, { version: moved.version + 1 }, operator)).status).toBe(409);
  });

  it("refuses to plan a task that is not approved", async () => {
    const t = await parse(await post("/tasks", { productId: "insight", type: "post", title: "Brouillon" }, operator));
    expect((await post(`/tasks/${t.id}/deliveries`, { socialAccountId: linkedin.id }, operator)).status).toBe(403);
  });
});

describe("outbox", () => {
  it("hands a due delivery to the provider, then marks it sent once the provider confirms", async () => {
    at("2026-12-05T10:00:00Z");
    const id = await approvedTask("Post A");
    const d = await plan(id, "2026-12-05T12:00:00Z");
    expect(await dispatchNow()).toMatchObject({ claimed: 0 });

    at("2026-12-05T11:55:00Z");
    expect(await dispatchNow()).toMatchObject({ claimed: 1, handedOff: 1 });
    let row = await deliveryOf(id, d.id);
    expect(row).toMatchObject({ status: "handed_off", attempts: 1 });
    expect(row.externalId).toMatch(/^mock-/);
    expect(await taskState(id)).toBe("scheduled");

    at("2026-12-05T12:01:00Z");
    expect(await dispatchNow()).toMatchObject({ polled: 1, sent: 1 });
    row = await deliveryOf(id, d.id);
    expect(row).toMatchObject({ status: "sent" });
    expect(row.permalink).toContain("example.invalid");
    expect(await taskState(id)).toBe("published");

    const attempts = await parse(await get(`/deliveries/${d.id}/attempts`, operator));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ n: 1, trigger: "manual", outcome: "handed_off" });

    expect((await put(`/deliveries/${d.id}/permalink`, { url: "https://evil.example/x", version: row.version }, operator)).status).toBe(422);
    expect((await put(`/deliveries/${d.id}/permalink`, { url: "https://www.linkedin.com/posts/1", version: row.version }, operator)).status).toBe(200);
  });

  it("backs off on a retryable error, fails on a fatal one, and comes back through retry", async () => {
    at("2026-12-10T10:00:00Z");
    const id = await approvedTask("Post B");
    const d = await plan(id, "2026-12-10T10:05:00Z");

    publisher.queue.push({ status: "failed", error: "rate limited", retryable: true, retryAfterSeconds: 120, code: "rate_limit" });
    expect(await dispatchNow()).toMatchObject({ claimed: 1, retried: 1 });
    let row = await deliveryOf(id, d.id);
    expect(row).toMatchObject({ status: "scheduled", attempts: 1, lastError: "rate limited" });
    expect(new Date(row.nextRetryAt).getTime()).toBeGreaterThan(clock.now.getTime());
    expect(await taskState(id)).toBe("scheduled");

    at("2026-12-10T10:01:00Z");
    expect(await dispatchNow()).toMatchObject({ claimed: 0 });

    at("2026-12-10T10:10:00Z");
    publisher.queue.push({ status: "failed", error: "channel disconnected", retryable: false, code: "rejected" });
    expect(await dispatchNow()).toMatchObject({ claimed: 1, failed: 1 });
    row = await deliveryOf(id, d.id);
    expect(row).toMatchObject({ status: "failed", attempts: 2 });
    expect(await taskState(id)).toBe("failed");

    const calendar = await parse(await get("/calendar?from=2026-12-10T00:00:00Z&to=2026-12-11T00:00:00Z", operator));
    expect(calendar.deliveries).toHaveLength(1);
    expect(calendar.deliveries[0]).toMatchObject({ taskId: id, status: "failed", channel: "linkedin", accountHandle: "@trigenys" });

    const retried = await post(`/deliveries/${d.id}/retry`, { version: row.version }, operator);
    expect(retried.status).toBe(200);
    expect(await parse(retried)).toMatchObject({ status: "scheduled", maxAttempts: 5, lastError: null });
    expect(await taskState(id)).toBe("scheduled");

    expect(await dispatchNow()).toMatchObject({ claimed: 1, sent: 1 });
    row = await deliveryOf(id, d.id);
    expect(row.status).toBe("sent");
    expect(await taskState(id)).toBe("published");
    expect((await parse(await get(`/deliveries/${d.id}/attempts`, operator))).map((a: { outcome: string }) => a.outcome)).toEqual(["retryable_error", "fatal_error", "handed_off"]);
  });

  it("recalls a handed-off delivery from the provider when cancelled", async () => {
    at("2026-12-12T10:00:00Z");
    const id = await approvedTask("Post C");
    const d = await plan(id, "2026-12-12T10:05:00Z");
    expect(await dispatchNow()).toMatchObject({ handedOff: 1 });
    const row = await deliveryOf(id, d.id);
    const cancelled = await post(`/deliveries/${d.id}/cancel`, { version: row.version }, operator);
    expect(cancelled.status).toBe(200);
    expect(publisher.cancelled).toContain(row.externalId);
    expect(await taskState(id)).toBe("approved");
  });

  it("fails without calling the provider when the content changed after planning", async () => {
    at("2026-12-13T10:00:00Z");
    const id = await approvedTask("Post D");
    const d = await plan(id, "2026-12-13T10:05:00Z");
    expect((await post(`/tasks/${id}/transitions`, { to: "approved" }, operator)).status).toBe(200);
    expect((await post(`/tasks/${id}/versions`, { channel: "linkedin", body: "Post D v2" }, operator)).status).toBe(201);
    const before = publisher.inner.published.size;
    // Refused under lock, before any provider call: not a claim, a failure.
    expect(await dispatchNow()).toMatchObject({ claimed: 0, failed: 1 });
    expect(publisher.inner.published.size).toBe(before);
    expect(await deliveryOf(id, d.id)).toMatchObject({ status: "failed" });
    // The task is back in preparing: content.publish no longer applies.
    expect((await post(`/deliveries/${d.id}/retry`, { version: 2 }, operator)).status).toBe(403);
  });

  it("only admins run the outbox, and the simulated clock is a mock-only tool", async () => {
    expect((await post("/deliveries/dispatch", {}, operator)).status).toBe(403);
    expect((await post("/deliveries/dispatch", {}, admin)).status).toBe(200);
  });
});

describe("calendar", () => {
  it("rejects an empty or oversized window and scopes to readable products", async () => {
    expect((await get("/calendar?from=2026-12-10T00:00:00Z&to=2026-12-10T00:00:00Z", operator)).status).toBe(422);
    expect((await get("/calendar?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z", operator)).status).toBe(422);
    const all = await parse(await get("/calendar?from=2026-12-01T00:00:00Z&to=2026-12-31T00:00:00Z", admin));
    expect(all.deliveries.length).toBeGreaterThan(0);
    expect(all.deliveries.every((d: { status: string }) => d.status !== "cancelled")).toBe(true);
    const none = await parse(await get("/calendar?from=2026-12-01T00:00:00Z&to=2026-12-31T00:00:00Z&productId=atelier", admin));
    expect(none.deliveries).toEqual([]);
  });
});
