import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchNotifications } from "../src/alerts/notify.ts";
import { notificationDispatch, product } from "../src/db/schema.ts";
import { NotifyMailer, toHtml } from "../src/integrations/notify/mailer.ts";
import { UpstreamError } from "../src/integrations/upstream.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// Assigning a task to someone else queues one notification per (task,
// assignee, version) in the outbox; the dispatcher sends it with a link to the
// task, or skips it when the task moved on before it went out (ADR 0013).

let h: Harness;
let admin: string;
let tiffany: string;
let tiffanyId: string;
let reviewer: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const send = (method: string, path: string, body: unknown, token: string, headers: Record<string, string> = {}) =>
  h.request(path, { method, headers: { ...json, ...headers }, body: JSON.stringify(body) }, token);
const notices = (taskId: string) => h.db.select().from(notificationDispatch).where(eq(notificationDispatch.taskId, taskId));
const notify = () => dispatchNotifications({ db: h.db, mailer: h.mailer, now: () => new Date(), webAppUrl: "https://studio.example/" });

beforeAll(async () => {
  h = await createHarness();
  admin = await h.signIn("admin@example.com");
  tiffany = await h.signIn("tiffany@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  tiffanyId = await h.userIdOf(tiffany);
  await h.grant(await h.userIdOf(admin), "admin");
  await h.grant(tiffanyId, "operator", "insight");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
  await h.db.insert(product).values([
    { id: "insight", name: "Trigenys Insight" },
    { id: "atelier", name: "Atelier Maître" },
  ]);
});
afterAll(() => h.close());

describe("assignees", () => {
  it("lists users with a role on the product or a global role, for content writers only", async () => {
    const res = await h.request("/products/insight/assignees", {}, admin);
    expect(res.status).toBe(200);
    const list = (await parse(res)) as { email: string; roles: string[] }[];
    expect(list.map((u) => u.email).sort()).toEqual(["admin@example.com", "reviewer@example.com", "tiffany@example.com"]);
    expect(list.find((u) => u.email === "tiffany@example.com")?.roles).toEqual(["operator"]);

    const atelier = (await parse(await h.request("/products/atelier/assignees", {}, admin))) as { email: string }[];
    expect(atelier.map((u) => u.email)).not.toContain("tiffany@example.com");

    expect((await h.request("/products/atelier/assignees", {}, tiffany)).status).toBe(403);
    expect((await h.request("/products/insight/assignees", {}, reviewer)).status).toBe(403);
    expect((await h.request("/products/nope/assignees", {}, admin)).status).toBe(404);
  });
});

describe("task assignment notifications", () => {
  it("queues one notice when a task is created for someone else, none for oneself", async () => {
    const body = { productId: "insight", type: "post", title: "Carrousel lancement", brief: "3 slides", assigneeId: tiffanyId };
    const res = await send("POST", "/tasks", body, admin, { "idempotency-key": "assign-1" });
    expect(res.status).toBe(201);
    const t = await parse(res);
    expect(await notices(t.id)).toMatchObject([{ kind: "task_assigned", alertId: null, userId: tiffanyId, status: "pending" }]);

    // The idempotent replay does not queue a second notice.
    const replay = await send("POST", "/tasks", body, admin, { "idempotency-key": "assign-1" });
    expect((await parse(replay)).id).toBe(t.id);
    expect(await notices(t.id)).toHaveLength(1);

    const own = await parse(await send("POST", "/tasks", { productId: "insight", type: "post", title: "Pour moi", assigneeId: tiffanyId }, tiffany));
    expect(await notices(own.id)).toHaveLength(0);
  });

  it("refuses an assignee without access to the product", async () => {
    const res = await send("POST", "/tasks", { productId: "atelier", type: "post", title: "Hors périmètre", assigneeId: tiffanyId }, admin);
    expect(res.status).toBe(422);
    const unknown = await send("POST", "/tasks", { productId: "insight", type: "post", title: "Inconnu", assigneeId: "no-such-user" }, admin);
    expect(unknown.status).toBe(422);
  });

  it("notifies on reassignment only, and sends the e-mail with a link to the task", async () => {
    const t = await parse(await send("POST", "/tasks", { productId: "insight", type: "visual", title: "Bannière", dueAt: "2026-12-01T09:00:00Z" }, admin));
    expect(await notices(t.id)).toHaveLength(0);

    const assigned = await send("PATCH", `/tasks/${t.id}`, { version: t.version, assigneeId: tiffanyId }, admin);
    expect(assigned.status).toBe(200);
    const v2 = (await parse(assigned)).version;
    expect(await notices(t.id)).toHaveLength(1);

    // Same assignee again alongside another field: nothing new.
    const retitled = await send("PATCH", `/tasks/${t.id}`, { version: v2, title: "Bannière v2", assigneeId: tiffanyId }, admin);
    expect(retitled.status).toBe(200);
    expect(await notices(t.id)).toHaveLength(1);

    const before = h.mailer.sent.length;
    const report = await notify();
    expect(report.sent).toBeGreaterThanOrEqual(1);
    const mail = h.mailer.sent.slice(before).find((m) => m.text.includes(`/tasks/${t.id}`));
    expect(mail).toMatchObject({ to: "tiffany@example.com", template: "task-assigned" });
    expect(mail!.subject).toContain("Bannière v2");
    expect(mail!.text).toContain("Trigenys Insight");
    expect(mail!.text).toContain("2026-12-01");
    expect(mail!.text).toContain(`https://studio.example/tasks/${t.id}`);
    expect(mail!.key).toMatch(/.+:\d+$/);
    expect(await notices(t.id)).toMatchObject([{ status: "sent" }]);
  });

  it("skips a notice whose task was unassigned before it went out", async () => {
    const t = await parse(await send("POST", "/tasks", { productId: "insight", type: "post", title: "Relance", assigneeId: tiffanyId }, admin));
    const patched = await send("PATCH", `/tasks/${t.id}`, { version: t.version, assigneeId: null }, admin);
    expect(patched.status).toBe(200);
    const before = h.mailer.sent.length;
    await notify();
    expect(h.mailer.sent.slice(before).some((m) => m.text.includes(`/tasks/${t.id}`))).toBe(false);
    expect(await notices(t.id)).toMatchObject([{ status: "skipped" }]);
  });
});

describe("NotifyMailer (Trigenys Notify generic e-mail route)", () => {
  const now = () => new Date("2026-11-09T10:00:00.000Z");
  const recorder = (status = 202, body: unknown = { accepted: true }) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const mail = {
    to: "tiffany@example.com",
    template: "task-assigned" as const,
    subject: "[Studio] Nouvelle\r\ntâche",
    text: "Bonjour\n\nÀ traiter : https://studio.example/tasks/1?a=1&b=<2>",
    key: "d1:1",
  };
  const bodyOf = (call: { init: RequestInit }) => JSON.parse(String(call.init.body));

  it("posts a v1 event with the scoped key header and a stable id per attempt", async () => {
    const { calls, fetchImpl } = recorder();
    const mailer = new NotifyMailer({ baseUrl: "https://notify.example/", ingestKey: "k-secret", fetch: fetchImpl, now });
    await mailer.send(mail);
    await mailer.send(mail);
    expect(calls[0]!.url).toBe("https://notify.example/v1/dispatch/trigenys-studio/email");
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("x-notify-auth")).toBe("k-secret");
    const body = bodyOf(calls[0]!);
    expect(body).toMatchObject({
      version: 1,
      project: "trigenys-studio",
      occurredAt: "2026-11-09T10:00:00.000Z",
      expiresAt: "2026-11-10T10:00:00.000Z",
      recipient: "tiffany@example.com",
      message: { subject: "[Studio] Nouvelle tâche", text: mail.text },
    });
    expect(body.id).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyOf(calls[1]!).id).toBe(body.id);
    expect(body.message.html).toContain('<a href="https://studio.example/tasks/1?a=1&amp;b=&lt;2&gt;">');
    expect(body).not.toHaveProperty("from");

    await mailer.send({ ...mail, key: "d1:2" });
    expect(bodyOf(calls[2]!).id).not.toBe(body.id);
  });

  it("gives magic links a short expiry and honours the project id", async () => {
    const { calls, fetchImpl } = recorder();
    await new NotifyMailer({ baseUrl: "https://notify.example", ingestKey: "k", project: "studio-x", fetch: fetchImpl, now }).send({
      ...mail,
      template: "magic-link",
      key: undefined,
    });
    expect(calls[0]!.url).toBe("https://notify.example/v1/dispatch/studio-x/email");
    expect(bodyOf(calls[0]!).expiresAt).toBe("2026-11-09T10:15:00.000Z");
  });

  it("fails with the status only, never the key or the upstream body", async () => {
    const { fetchImpl } = recorder(401, { error: "bad key k-secret for tiffany@example.com" });
    const err = await new NotifyMailer({ baseUrl: "https://notify.example", ingestKey: "k-secret", fetch: fetchImpl, now })
      .send(mail)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).upstreamStatus).toBe(401);
    expect((err as Error).message).not.toContain("k-secret");
    expect((err as Error).message).not.toContain("tiffany");

    const refused = recorder(202, { accepted: false });
    await expect(new NotifyMailer({ baseUrl: "https://n", ingestKey: "k", fetch: refused.fetchImpl, now }).send(mail)).rejects.toThrow("not accepted");
  });

  it("renders plain text as escaped paragraphs", () => {
    expect(toHtml("a <b>\nc\n\nd")).toBe("<p>a &lt;b&gt;<br>c</p>\n<p>d</p>");
  });
});

describe("MCP: loading work for someone from an assistant", () => {
  let seq = 0;
  const call = async (name: string, args: unknown, token: string) => {
    const res = await h.request(
      "/mcp",
      {
        method: "POST",
        headers: { ...json, accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }),
      },
      token,
    );
    expect(res.status).toBe(200);
    const result = (await parse(res)).result as { isError?: boolean; content: { text: string }[] };
    return { isError: result.isError, data: JSON.parse(result.content[0]!.text) };
  };

  it("finds the assignee, creates the task for them and reassigns with optimistic concurrency", async () => {
    const people = await call("list_assignees", { productId: "insight" }, admin);
    expect(people.isError).toBeUndefined();
    const target = (people.data as { id: string; email: string }[]).find((u) => u.email === "tiffany@example.com")!;

    const created = await call(
      "create_task",
      { productId: "insight", type: "newsletter", title: "Newsletter novembre", brief: "Thème : lancement", assigneeId: target.id, idempotencyKey: "mcp-nl-1" },
      admin,
    );
    expect(created.isError).toBeUndefined();
    expect(created.data).toMatchObject({ title: "Newsletter novembre", assigneeId: target.id });
    expect(await notices(created.data.id)).toHaveLength(1);

    const stale = await call("assign_task", { taskId: created.data.id, assigneeId: null, version: created.data.version + 5 }, admin);
    expect(stale.isError).toBe(true);
    expect(stale.data).toMatchObject({ status: 409 });

    const unassigned = await call("assign_task", { taskId: created.data.id, assigneeId: null, version: created.data.version }, admin);
    expect(unassigned.isError).toBeUndefined();
    expect(unassigned.data.assigneeId).toBeNull();
  });
});
