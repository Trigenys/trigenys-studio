import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, product } from "../src/db/schema.ts";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
let admin: string;
let operator: string;
let reviewer: string;
let operatorId: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);

beforeAll(async () => {
  h = await createHarness();
  admin = await h.signIn("admin@example.com");
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  await h.grant(await h.userIdOf(admin), "admin");
  operatorId = await h.userIdOf(operator);
  await h.grant(operatorId, "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([
    { id: "insight", name: "Trigenys Insight" },
    { id: "atelier", name: "Atelier Maître" },
  ]);
});
afterAll(() => h.close());

const createTask = async (productId = "insight", token = operator) => {
  const res = await post("/tasks", { productId, type: "post", title: "Lancement" }, token);
  expect(res.status).toBe(201);
  return parse(res);
};

const move = (id: string, to: string, token: string, headers?: Record<string, string>) =>
  post(`/tasks/${id}/transitions`, { to }, token, headers);

// Drives a task up to awaiting_approval with one content version by the operator.
const submit = async () => {
  const t = await createTask();
  expect((await move(t.id, "preparing", operator)).status).toBe(200);
  const v = await post(`/tasks/${t.id}/versions`, { channel: "linkedin", body: "Bonjour" }, operator);
  expect(v.status).toBe(201);
  for (const to of ["reviewing", "visuals", "awaiting_approval"]) expect((await move(t.id, to, operator)).status).toBe(200);
  return t.id as string;
};

describe("products", () => {
  it("admin creates idempotently; operators read, never create", async () => {
    const body = { id: "precis", name: "Précis Translator" };
    expect((await post("/products", body, admin)).status).toBe(201);
    expect((await post("/products", body, admin)).status).toBe(200);
    expect((await post("/products", { ...body, name: "Other" }, admin)).status).toBe(409);
    expect((await post("/products", body, operator)).status).toBe(403);
    expect((await h.request("/products", {}, operator)).status).toBe(200);
    expect((await h.request("/products")).status).toBe(401);
  });
});

describe("tasks", () => {
  it("starts in the initial state and offers the right next steps", async () => {
    const t = await createTask();
    expect(t).toMatchObject({ state: "qualifying", version: 1, approvalValid: false, allowedTransitions: ["preparing"] });
    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "task.create"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("scopes writes and reads to the operator's product", async () => {
    expect((await post("/tasks", { productId: "atelier", type: "post", title: "x" }, operator)).status).toBe(403);
    expect((await post("/tasks", { productId: "nope", type: "post", title: "x" }, admin)).status).toBe(404);
    const other = await createTask("atelier", admin);
    expect((await h.request(`/tasks/${other.id}`, {}, operator)).status).toBe(403);
    const mine = await parse(await h.request("/tasks", {}, operator));
    expect(mine.every((t: { productId: string }) => t.productId === "insight")).toBe(true);
    expect((await h.request("/tasks/00000000-0000-0000-0000-000000000000", {}, admin)).status).toBe(404);
    expect((await h.request("/tasks/not-a-uuid", {}, admin)).status).toBe(404);
  });

  it("updates with optimistic concurrency", async () => {
    const t = await createTask();
    const ok = await h.request(`/tasks/${t.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ version: 1, title: "V2" }) }, operator);
    expect(ok.status).toBe(200);
    expect((await parse(ok)).version).toBe(2);
    const stale = await h.request(`/tasks/${t.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ version: 1, title: "V3" }) }, operator);
    expect(stale.status).toBe(409);
  });

  it("filters my day: assignee=me and dueBefore", async () => {
    const t = await createTask();
    await h.request(
      `/tasks/${t.id}`,
      { method: "PATCH", headers: json, body: JSON.stringify({ version: 1, assigneeId: operatorId, dueAt: "2026-01-01T09:00:00.000Z" }) },
      operator,
    );
    const mine = await parse(await h.request("/tasks?assigneeId=me&dueBefore=2026-01-02T00:00:00Z", {}, operator));
    expect(mine.map((x: { id: string }) => x.id)).toEqual([t.id]);
  });
});

describe("pipeline transitions", () => {
  it("refuses undefined transitions and unmet guards with 409", async () => {
    const t = await createTask();
    expect((await move(t.id, "published", operator)).status).toBe(409);
    expect((await move(t.id, "preparing", operator)).status).toBe(200);
    const noContent = await move(t.id, "reviewing", operator);
    expect(noContent.status).toBe(409);
    expect((await parse(noContent)).detail).toMatch(/no content/i);
  });

  it("decides the role per transition and audits denials", async () => {
    const t = await createTask();
    expect((await move(t.id, "preparing", reviewer)).status).toBe(403);
    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.outcome, "denied"));
    expect(rows.some((r) => r.action === "content.write" && r.resourceId === t.id)).toBe(true);
    expect((await move(t.id, "preparing", operator)).status).toBe(200);
    const history = await parse(await h.request(`/tasks/${t.id}/transitions`, {}, operator));
    expect(history).toMatchObject([{ fromState: "qualifying", toState: "preparing", actorId: operatorId }]);
  });

  it("never reaches approved through a transition", async () => {
    const id = await submit();
    expect((await move(id, "approved", operator)).status).toBe(409);
    expect((await move(id, "approved", admin)).status).toBe(409);
  });
});

describe("approvals", () => {
  it("binds the approval to the content hash and unlocks scheduling", async () => {
    const id = await submit();
    expect((await post(`/tasks/${id}/approvals`, { decision: "approved" }, operator)).status).toBe(403);
    const decided = await post(`/tasks/${id}/approvals`, { decision: "approved", comment: "ok" }, reviewer);
    expect(decided.status).toBe(201);
    const d = await parse(decided);
    expect(d).toMatchObject({ state: "approved", approvalValid: true });
    expect(d.latestApproval.contentHash).toBe(d.latestVersion.contentHash);
    expect((await move(id, "scheduled", operator)).status).toBe(200);
    expect((await post(`/tasks/${id}/versions`, { channel: "linkedin", body: "trop tard" }, operator)).status).toBe(409);
  });

  it("invalidates the approval when the content changes afterwards", async () => {
    const id = await submit();
    expect((await post(`/tasks/${id}/approvals`, { decision: "approved" }, reviewer)).status).toBe(201);
    const v2 = await post(`/tasks/${id}/versions`, { channel: "linkedin", body: "Bonjour v2" }, operator);
    expect(v2.status).toBe(201);
    const t = await parse(await h.request(`/tasks/${id}`, {}, operator));
    expect(t).toMatchObject({ state: "preparing", approvalValid: false });
    for (const to of ["reviewing", "visuals", "awaiting_approval"]) expect((await move(id, to, operator)).status).toBe(200);
    // The old approval does not match the new hash: still not publishable.
    const again = await post(`/tasks/${id}/approvals`, { decision: "rejected", comment: "non" }, reviewer);
    expect((await parse(again)).state).toBe("rejected");
    expect((await move(id, "scheduled", operator)).status).toBe(409);
  });

  it("forbids self-approval (four-eyes) and audits it", async () => {
    const id = await submit();
    // The admin may review, but as author of the latest version may not decide.
    await move(id, "preparing", admin);
    expect((await post(`/tasks/${id}/versions`, { channel: "linkedin", body: "par admin" }, admin)).status).toBe(201);
    for (const to of ["reviewing", "visuals", "awaiting_approval"]) await move(id, to, admin);
    const res = await post(`/tasks/${id}/approvals`, { decision: "approved" }, admin);
    expect(res.status).toBe(403);
    expect((await parse(res)).title).toMatch(/self-approval/i);
    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.resourceId, id));
    expect(rows.some((r) => r.outcome === "denied" && r.details?.reason === "self-approval")).toBe(true);
    expect((await post(`/tasks/${id}/approvals`, { decision: "approved" }, reviewer)).status).toBe(201);
  });

  it("only decides on awaiting_approval", async () => {
    const t = await createTask();
    expect((await post(`/tasks/${t.id}/approvals`, { decision: "approved" }, reviewer)).status).toBe(409);
  });
});

describe("idempotency", () => {
  it("replays an identical POST and rejects a reused key with another payload", async () => {
    const t = await createTask();
    const key = { "idempotency-key": "k-1" };
    const first = await move(t.id, "preparing", operator, key);
    const second = await move(t.id, "preparing", operator, key);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await parse(second)).toEqual(await parse(first));
    const history = await parse(await h.request(`/tasks/${t.id}/transitions`, {}, operator));
    expect(history).toHaveLength(1);
    expect((await move(t.id, "reviewing", operator, key)).status).toBe(422);
    // Without the header the second call is a real request and fails on state.
    expect((await move(t.id, "preparing", operator)).status).toBe(409);
  });

  it("does not duplicate comments or versions on retry", async () => {
    const t = await createTask();
    const key = { "idempotency-key": "k-2" };
    const body = { body: "Un commentaire" };
    expect((await post(`/tasks/${t.id}/comments`, body, operator, key)).status).toBe(201);
    expect((await post(`/tasks/${t.id}/comments`, body, operator, key)).status).toBe(201);
    expect(await parse(await h.request(`/tasks/${t.id}/comments`, {}, operator))).toHaveLength(1);
    // Keys are per actor: the same key from another user is a new request.
    expect((await post(`/tasks/${t.id}/comments`, body, admin, key)).status).toBe(201);
    expect(await parse(await h.request(`/tasks/${t.id}/comments`, {}, operator))).toHaveLength(2);
  });
});
