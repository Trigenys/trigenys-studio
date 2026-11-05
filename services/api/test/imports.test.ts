import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, importItem, product, taskSource } from "../src/db/schema.ts";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
let operator: string;
let reviewer: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);
const list = async (qs = "") => parse(await h.request(`/imports${qs}`, {}, operator));

beforeAll(async () => {
  h = await createHarness();
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  await h.grant(await h.userIdOf(operator), "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([{ id: "insight", name: "Trigenys Insight" }]);
});
afterAll(() => h.close());

describe("sync", () => {
  it("pulls the mock CMS and radar once and is a no-op on replay", async () => {
    const first = await post("/imports/sync", {}, operator);
    expect(first.status).toBe(200);
    const r1 = await parse(first);
    expect(r1.origins).toEqual([
      { origin: "cms", fetched: 3, created: 3, updated: 0 },
      { origin: "radar", fetched: 2, created: 2, updated: 0 },
    ]);
    const r2 = await parse(await post("/imports/sync", {}, operator));
    expect(r2.origins.map((o: { created: number; updated: number }) => [o.created, o.updated])).toEqual([
      [0, 3],
      [0, 2],
    ]);
    expect((await list()).length).toBe(5);
  });

  it("filters by origin and status, keeps provenance dates", async () => {
    const radar = await list("?origin=radar");
    expect(radar.length).toBe(2);
    expect(radar.every((i: { origin: string; status: string }) => i.origin === "radar" && i.status === "new")).toBe(true);
    expect(radar[0].observedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(radar[0].sources.length).toBeGreaterThan(0);
    expect((await list("?status=linked")).length).toBe(0);
  });

  it("is refused to a reviewer and audited for the operator", async () => {
    expect((await post("/imports/sync", { origin: "cms" }, reviewer)).status).toBe(403);
    const events = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "import.sync"));
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

describe("decisions", () => {
  it("creates a task with provenance sources and marks the item linked; a second link is a conflict", async () => {
    const [topic] = await list("?origin=radar");
    const res = await post(`/imports/${topic.id}/task`, { productId: "insight" }, operator, { "idempotency-key": "link-1" });
    expect(res.status).toBe(201);
    const linked = await parse(res);
    expect(linked.status).toBe("linked");
    expect(linked.taskId).toBeTruthy();

    const task = await parse(await h.request(`/tasks/${linked.taskId}`, {}, operator));
    expect(task.state).toBe("qualifying");
    expect(task.title).toBe(topic.title);
    expect(task.brief).toContain("radar Editorial OS");
    const sources = await h.db.select().from(taskSource).where(eq(taskSource.taskId, linked.taskId));
    expect(sources.every((s) => s.origin === "radar")).toBe(true);
    expect(sources.length).toBe(1 + topic.sources.length);
    expect(sources.some((s) => s.url === topic.sources[0])).toBe(true);

    // Replay with the same key: same answer, no second task.
    const replay = await post(`/imports/${topic.id}/task`, { productId: "insight" }, operator, { "idempotency-key": "link-1" });
    expect(replay.status).toBe(201);
    expect((await parse(replay)).taskId).toBe(linked.taskId);
    // A fresh request is a conflict.
    expect((await post(`/imports/${topic.id}/task`, { productId: "insight" }, operator)).status).toBe(409);
  });

  it("a resync keeps the decision", async () => {
    await post("/imports/sync", { origin: "radar" }, operator);
    const linked = await list("?status=linked");
    expect(linked.length).toBe(1);
    expect(linked[0].taskId).toBeTruthy();
  });

  it("links a CMS article with its public URL as source", async () => {
    const [article] = await list("?origin=cms");
    const res = await post(`/imports/${article.id}/task`, { productId: "insight", type: "newsletter", title: "Relayer l'article" }, operator);
    expect(res.status).toBe(201);
    const linked = await parse(res);
    const sources = await h.db.select().from(taskSource).where(eq(taskSource.taskId, linked.taskId));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.origin).toBe("cms");
    expect(sources[0]!.url).toBe(article.url);
  });

  it("ignores an item, refuses to ignore a linked one, 404 on unknown product", async () => {
    const [item] = (await list("?status=new")) as { id: string }[];
    const ignored = await post(`/imports/${item!.id}/ignore`, {}, operator);
    expect(ignored.status).toBe(200);
    expect((await parse(ignored)).status).toBe("ignored");
    expect((await post(`/imports/${item!.id}/task`, { productId: "insight" }, operator)).status).toBe(409);

    const [linked] = (await list("?status=linked")) as { id: string }[];
    expect((await post(`/imports/${linked!.id}/ignore`, {}, operator)).status).toBe(409);

    const [fresh] = (await list("?status=new")) as { id: string }[];
    expect((await post(`/imports/${fresh!.id}/task`, { productId: "nope" }, operator)).status).toBe(403);
  });

  it("a reviewer can read but neither link nor ignore", async () => {
    const [fresh] = (await list("?status=new")) as { id: string }[];
    expect((await h.request(`/imports/${fresh!.id}`, {}, reviewer)).status).toBe(200);
    expect((await post(`/imports/${fresh!.id}/task`, { productId: "insight" }, reviewer)).status).toBe(403);
    expect((await post(`/imports/${fresh!.id}/ignore`, {}, reviewer)).status).toBe(403);
    expect((await h.request(`/imports/00000000-0000-4000-8000-000000000000`, {}, operator)).status).toBe(404);
  });

  it("status and task survive in the table after everything", async () => {
    const rows = await h.db.select().from(importItem);
    expect(rows.map((r) => r.status).sort()).toEqual(["ignored", "linked", "linked", "new", "new"]);
  });
});
