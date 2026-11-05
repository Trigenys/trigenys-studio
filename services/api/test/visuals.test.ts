import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, product } from "../src/db/schema.ts";
import { sha256 } from "../src/pipeline/engine.ts";
import { kitBody } from "./brand-kits.test.ts";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
let admin: string;
let operator: string;
let reviewer: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const send = (method: string, path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method, headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);
const post = (path: string, body: unknown, token: string, headers?: Record<string, string>) => send("POST", path, body, token, headers);

beforeAll(async () => {
  h = await createHarness();
  admin = await h.signIn("admin@example.com");
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  await h.grant(await h.userIdOf(admin), "admin");
  await h.grant(await h.userIdOf(operator), "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([{ id: "insight", name: "Trigenys Insight" }]);
});
afterAll(() => h.close());

const createTask = async (title = "Lancement") => {
  const res = await post("/tasks", { productId: "insight", type: "post", title }, operator);
  expect(res.status).toBe(201);
  return (await parse(res)).id as string;
};
const move = (id: string, to: string, token = operator) => post(`/tasks/${id}/transitions`, { to }, token);
const detail = async (id: string) => parse(await h.request(`/tasks/${id}`, {}, operator));

describe("rendering", () => {
  let taskId: string;
  let kitId: string;

  it("needs an approved brand kit", async () => {
    taskId = await createTask();
    const res = await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin" }, operator);
    expect(res.status).toBe(409);
    expect((await parse(res)).title).toBe("No approved brand kit");
    const kit = await parse(await post("/products/insight/brand-kits", kitBody(), admin));
    kitId = kit.id;
    await post(`/brand-kits/${kitId}/approve`, {}, admin);
  });

  it("renders a content-addressed visual, dedups identical renders, numbers variants", async () => {
    expect((await detail(taskId)).currentAssetSetHash).toBe(await sha256("[]"));
    const res = await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin", subtitle: "Trigenys Studio" }, operator, { "idempotency-key": "r1" });
    expect(res.status).toBe(201);
    const v1 = await parse(res);
    expect(v1).toMatchObject({ formatId: "linkedin", variant: 1, status: "active", renderer: "svg@1", mime: "image/svg+xml", width: 1200, height: 627, title: "Lancement", brandKitId: kitId });
    expect(v1.storageKey).toBeUndefined();
    expect(h.media.objects.has(`visuals/sha256/${v1.contentHash}.svg`)).toBe(true);

    // Replay with the key: 201 again, same row. Without the key, same bytes: 200, same row.
    expect((await parse(await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin", subtitle: "Trigenys Studio" }, operator, { "idempotency-key": "r1" }))).id).toBe(v1.id);
    const again = await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin", subtitle: "Trigenys Studio" }, operator);
    expect(again.status).toBe(200);
    expect((await parse(again)).id).toBe(v1.id);

    // A different subtitle is a new variant with a different hash.
    const v2 = await parse(await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin", subtitle: "Autre" }, operator));
    expect(v2.variant).toBe(2);
    expect(v2.contentHash).not.toBe(v1.contentHash);
    const list = await parse(await h.request(`/tasks/${taskId}/visuals`, {}, reviewer));
    expect(list.map((v: { variant: number }) => v.variant)).toEqual([1, 2]);
    const d = await detail(taskId);
    expect(d.currentAssetSetHash).not.toBe(await sha256("[]"));
    expect((await h.db.select().from(auditEvent).where(eq(auditEvent.action, "visual.render"))).length).toBe(2);
  });

  it("serves the bytes with immutable caching and an ETag, 304 on revalidation", async () => {
    const [v1] = await parse(await h.request(`/tasks/${taskId}/visuals`, {}, operator));
    const res = await h.request(`/visuals/${v1.id}/file`, {}, reviewer);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("etag")).toBe(`"${v1.contentHash}"`);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toContain("Lancement");
    const cached = await h.request(`/visuals/${v1.id}/file`, { headers: { "if-none-match": `"${v1.contentHash}"` } }, reviewer);
    expect(cached.status).toBe(304);
  });

  it("refuses unknown formats, reviewers, and renders on frozen tasks", async () => {
    expect((await post(`/tasks/${taskId}/visuals`, { formatId: "nope" }, operator)).status).toBe(422);
    expect((await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin" }, reviewer)).status).toBe(403);
  });

  it("discard is logical, listed on demand, and reuses no variant number", async () => {
    const [v1, v2] = await parse(await h.request(`/tasks/${taskId}/visuals`, {}, operator));
    const res = await h.request(`/tasks/${taskId}/visuals/${v2.id}`, { method: "DELETE" }, operator);
    expect(res.status).toBe(200);
    expect((await parse(res)).status).toBe("discarded");
    expect((await parse(await h.request(`/tasks/${taskId}/visuals`, {}, operator))).map((v: { id: string }) => v.id)).toEqual([v1.id]);
    expect((await parse(await h.request(`/tasks/${taskId}/visuals?include=discarded`, {}, operator))).length).toBe(2);
    // Discarding again is a no-op; a reviewer may not discard.
    expect((await h.request(`/tasks/${taskId}/visuals/${v2.id}`, { method: "DELETE" }, operator)).status).toBe(200);
    expect((await h.request(`/tasks/${taskId}/visuals/${v1.id}`, { method: "DELETE" }, reviewer)).status).toBe(403);
    const v3 = await parse(await post(`/tasks/${taskId}/visuals`, { formatId: "linkedin", subtitle: "Autre" }, operator));
    expect(v3.variant).toBe(3);
  });

  it("refuses a render whose logo no longer matches the kit hash", async () => {
    const kits = await parse(await h.request("/products/insight/brand-kits", {}, admin));
    const approved = kits.find((k: { status: string }) => k.status === "approved");
    const key = `logos/sha256/${approved.logoHash}.svg`;
    const original = h.media.objects.get(key)!;
    h.media.objects.set(key, { ...original, bytes: new TextEncoder().encode("<svg/>") });
    const res = await post(`/tasks/${taskId}/visuals`, { formatId: "story" }, operator);
    expect(res.status).toBe(409);
    expect((await parse(res)).title).toBe("Brand kit logo integrity");
    h.media.objects.set(key, original);
  });
});

describe("approval binding", () => {
  // Drives a task to awaiting_approval with one version and one visual.
  const submit = async () => {
    const id = await createTask("Binding");
    await move(id, "preparing");
    await post(`/tasks/${id}/versions`, { channel: "linkedin", body: "Bonjour" }, operator);
    for (const to of ["reviewing", "visuals"]) await move(id, to);
    const visual = await parse(await post(`/tasks/${id}/visuals`, { formatId: "article" }, operator));
    await move(id, "awaiting_approval");
    const approved = await post(`/tasks/${id}/approvals`, { decision: "approved" }, reviewer);
    expect(approved.status).toBe(201);
    expect((await detail(id)).approvalValid).toBe(true);
    return { id, visual };
  };

  it("a new visual after approval sends the task back and invalidates the approval", async () => {
    const { id } = await submit();
    const res = await post(`/tasks/${id}/visuals`, { formatId: "instagram" }, operator);
    expect(res.status).toBe(201);
    const d = await detail(id);
    expect(d.state).toBe("preparing");
    expect(d.approvalValid).toBe(false);
    expect(d.latestApproval.assetSetHash).not.toBe(d.currentAssetSetHash);
  });

  it("discarding an approved visual invalidates the approval too", async () => {
    const { id, visual } = await submit();
    expect((await h.request(`/tasks/${id}/visuals/${visual.id}`, { method: "DELETE" }, operator)).status).toBe(200);
    const d = await detail(id);
    expect(d.state).toBe("preparing");
    expect(d.approvalValid).toBe(false);
    expect(d.currentAssetSetHash).toBe(await sha256("[]"));
  });

  it("renders and discards are refused once the task is scheduled", async () => {
    const { id, visual } = await submit();
    expect((await move(id, "scheduled")).status).toBe(200);
    expect((await post(`/tasks/${id}/visuals`, { formatId: "instagram" }, operator)).status).toBe(409);
    expect((await h.request(`/tasks/${id}/visuals/${visual.id}`, { method: "DELETE" }, operator)).status).toBe(409);
  });
});
