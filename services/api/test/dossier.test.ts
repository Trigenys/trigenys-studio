import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, product } from "../src/db/schema.ts";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
let operator: string;
let reviewer: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);

beforeAll(async () => {
  h = await createHarness();
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  await h.grant(await h.userIdOf(operator), "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([{ id: "insight", name: "Trigenys Insight" }]);
});
afterAll(() => h.close());

const createTask = async (brief = "Annoncer Insight aux équipes data.") => {
  const res = await post("/tasks", { productId: "insight", type: "post", title: "Lancement", brief }, operator);
  expect(res.status).toBe(201);
  return (await parse(res)).id as string;
};
const move = (id: string, to: string) => post(`/tasks/${id}/transitions`, { to }, operator);
const withVersion = async () => {
  const id = await createTask();
  expect((await move(id, "preparing")).status).toBe(200);
  expect((await post(`/tasks/${id}/versions`, { channel: "linkedin", body: "Bonjour" }, operator)).status).toBe(201);
  return id;
};
const approved = async () => {
  const id = await withVersion();
  for (const to of ["reviewing", "visuals", "awaiting_approval"]) expect((await move(id, to)).status).toBe(200);
  expect((await post(`/tasks/${id}/approvals`, { decision: "approved" }, reviewer)).status).toBe(201);
  return id;
};

describe("sources", () => {
  it("operators attach and detach sources; reviewers only read; everything is audited", async () => {
    const id = await createTask();
    const body = { title: "Doc Insight", url: "https://example.com/insight", note: "Chapitre 2" };
    expect((await post(`/tasks/${id}/sources`, body, reviewer)).status).toBe(403);
    const created = await post(`/tasks/${id}/sources`, body, operator);
    expect(created.status).toBe(201);
    const source = await parse(created);
    expect(source).toMatchObject({ taskId: id, origin: "manual", ...body });

    const list = await parse(await h.request(`/tasks/${id}/sources`, {}, reviewer));
    expect(list).toHaveLength(1);

    expect((await h.request(`/tasks/${id}/sources/${source.id}`, { method: "DELETE" }, reviewer)).status).toBe(403);
    expect((await h.request(`/tasks/${id}/sources/${source.id}`, { method: "DELETE" }, operator)).status).toBe(204);
    expect((await h.request(`/tasks/${id}/sources/${source.id}`, { method: "DELETE" }, operator)).status).toBe(404);
    expect(await parse(await h.request(`/tasks/${id}/sources`, {}, operator))).toEqual([]);

    const audit = await h.db.select().from(auditEvent).where(eq(auditEvent.resourceId, id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["source.add", "source.remove"]));
  });

  it("rejects a malformed url", async () => {
    const id = await createTask();
    expect((await post(`/tasks/${id}/sources`, { title: "x", url: "not a url" }, operator)).status).toBe(400);
  });
});

describe("assistant", () => {
  it("builds the proposal from the dossier and journals it without touching the content", async () => {
    const id = await withVersion();
    const src = await parse(await post(`/tasks/${id}/sources`, { title: "Note interne", note: "Chiffres Q3" }, operator));
    const res = await post(`/tasks/${id}/assistant`, { action: "propose", channel: "linkedin" }, operator);
    expect(res.status).toBe(201);
    const i = await parse(res);
    expect(i).toMatchObject({ taskId: id, action: "propose", channel: "linkedin", status: "proposed", model: "mock", acceptedVersionId: null });
    expect(i.output).toMatch(/^\[propose\]/);
    expect(i.contextRefs).toEqual([`task:${id}`, `source:${src.id}`, expect.stringMatching(/^version:/)]);
    expect(i.inputHash).toHaveLength(64);

    const detail = await parse(await h.request(`/tasks/${id}`, {}, operator));
    expect(detail.latestVersion.n).toBe(1);
    expect(detail.latestVersion.body).toBe("Bonjour");

    const listed = await parse(await h.request(`/tasks/${id}/assistant`, {}, reviewer));
    expect(listed).toHaveLength(1);
    const audit = await h.db.select().from(auditEvent).where(eq(auditEvent.resourceId, id));
    const run = audit.find((a) => a.action === "ai.interact");
    expect(run?.details).toMatchObject({ action: "propose", model: "mock", contextRefs: i.contextRefs });
  });

  it("refuses the actions that need a version when there is none, and refuses reviewers", async () => {
    const id = await createTask();
    expect((await post(`/tasks/${id}/assistant`, { action: "fix", channel: "linkedin" }, operator)).status).toBe(409);
    expect((await post(`/tasks/${id}/assistant`, { action: "propose", channel: "linkedin" }, operator)).status).toBe(201);
    expect((await post(`/tasks/${id}/assistant`, { action: "propose", channel: "linkedin" }, reviewer)).status).toBe(403);
  });

  it("accepting creates an assisted version through the pipeline rules; accepting twice is refused", async () => {
    const id = await withVersion();
    const i = await parse(await post(`/tasks/${id}/assistant`, { action: "fix", channel: "x" }, operator));
    const accepted = await post(`/tasks/${id}/assistant/${i.id}/accept`, {}, operator);
    expect(accepted.status).toBe(201);
    const v = await parse(accepted);
    expect(v).toMatchObject({ n: 2, channel: "x", body: i.output, aiAssisted: true });

    const [after] = await parse(await h.request(`/tasks/${id}/assistant`, {}, operator));
    expect(after).toMatchObject({ id: i.id, status: "accepted", acceptedVersionId: v.id });
    expect((await post(`/tasks/${id}/assistant/${i.id}/accept`, {}, operator)).status).toBe(409);
    expect((await post(`/tasks/${id}/assistant/${i.id}/dismiss`, {}, operator)).status).toBe(409);

    const versions = await parse(await h.request(`/tasks/${id}/versions`, {}, operator));
    expect(versions.map((x: { n: number; body: string }) => [x.n, x.body])).toEqual([
      [2, i.output],
      [1, "Bonjour"],
    ]);
  });

  it("never replaces an approved version silently: accepting sends the task back and invalidates the approval", async () => {
    const id = await approved();
    const i = await parse(await post(`/tasks/${id}/assistant`, { action: "adapt", channel: "newsletter" }, operator));
    expect((await post(`/tasks/${id}/assistant/${i.id}/accept`, {}, operator)).status).toBe(201);
    const t = await parse(await h.request(`/tasks/${id}`, {}, operator));
    expect(t).toMatchObject({ state: "preparing", approvalValid: false });
    expect(t.latestVersion).toMatchObject({ n: 2, aiAssisted: true });
    const history = await parse(await h.request(`/tasks/${id}/transitions`, {}, operator));
    expect(history.at(-1)).toMatchObject({ fromState: "approved", toState: "preparing" });
  });

  it("is unavailable once the content is frozen", async () => {
    const id = await approved();
    const i = await parse(await post(`/tasks/${id}/assistant`, { action: "fix", channel: "linkedin" }, operator));
    expect((await move(id, "scheduled")).status).toBe(200);
    expect((await post(`/tasks/${id}/assistant`, { action: "propose", channel: "linkedin" }, operator)).status).toBe(409);
    expect((await post(`/tasks/${id}/assistant/${i.id}/accept`, {}, operator)).status).toBe(409);
    expect((await post(`/tasks/${id}/assistant/${i.id}/dismiss`, {}, operator)).status).toBe(200);
  });

  it("replays the same Idempotency-Key instead of calling the model twice", async () => {
    const id = await withVersion();
    const headers = { "idempotency-key": crypto.randomUUID() };
    const a = await parse(await post(`/tasks/${id}/assistant`, { action: "summarize", channel: "x" }, operator, headers));
    const b = await parse(await post(`/tasks/${id}/assistant`, { action: "summarize", channel: "x" }, operator, headers));
    expect(b.id).toBe(a.id);
    expect(await parse(await h.request(`/tasks/${id}/assistant`, {}, operator))).toHaveLength(1);
  });
});
