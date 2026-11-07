import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcileAlerts } from "../src/alerts/reconcile.ts";
import { alert, delivery, product, task, taskTransition } from "../src/db/schema.ts";
import { TOOLS } from "../src/mcp/tools.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// The MCP endpoint is a façade over the REST routes: every tool call must end
// with the same decision (status, policy, audit, idempotency) as the HTTP call
// it replays. These tests drive it with raw JSON-RPC, exactly like a client.

let h: Harness;
let admin: string;
let operator: string;
let reviewer: string;
let linkedin: string;

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown, token: string) =>
  h.request(path, { method: "POST", headers: json, body: JSON.stringify(body) }, token);

let seq = 0;
const rpc = (method: string, params: unknown, token?: string, headers: Record<string, string> = {}) =>
  h.request(
    "/mcp",
    {
      method: "POST",
      headers: { ...json, accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
    },
    token,
  );
const call = async (name: string, args: unknown, token: string) => {
  const res = await rpc("tools/call", { name, arguments: args }, token);
  expect(res.status, await res.clone().text()).toBe(200);
  const body = await parse(res);
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result as { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: unknown };
};
const payload = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text);

beforeAll(async () => {
  h = await createHarness();
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
  const account = await post(
    "/social-accounts",
    { productId: "insight", channel: "linkedin", provider: "buffer", externalRef: "mock-linkedin-1", handle: "@trigenys", displayName: "Trigenys" },
    admin,
  );
  linkedin = (await parse(account)).id;
});
afterAll(() => h.close());

// A task of the insight product brought to awaiting_approval by the operator.
const awaitingTask = async (title = "Lancement") => {
  const t = await parse(await post("/tasks", { productId: "insight", type: "post", title }, operator));
  const move = (to: string) => post(`/tasks/${t.id}/transitions`, { to }, operator);
  expect((await move("preparing")).status).toBe(200);
  expect((await post(`/tasks/${t.id}/versions`, { channel: "linkedin", body: "Bonjour" }, operator)).status).toBe(201);
  for (const to of ["reviewing", "visuals", "awaiting_approval"]) expect((await move(to)).status).toBe(200);
  return t.id as string;
};
const taskState = async (id: string) => (await h.db.select({ state: task.state }).from(task).where(eq(task.id, id)))[0]!.state;

describe("transport", () => {
  it("requires a session and advertises bearer auth", async () => {
    const res = await rpc("tools/list", {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("refuses browser origins outside the trusted list, accepts trusted ones", async () => {
    expect((await rpc("tools/list", {}, operator, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc("tools/list", {}, operator, { origin: "http://localhost:5173" })).status).toBe(200);
  });

  it("accepts POST only", async () => {
    const res = await h.request("/mcp", { method: "GET", headers: { accept: "text/event-stream" } }, operator);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("initializes statelessly with JSON responses", async () => {
    const res = await rpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      operator,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = await parse(res);
    expect(body.result.serverInfo.name).toBe("trigenys-studio");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("lists every tool of the table with its annotations", async () => {
    const body = await parse(await rpc("tools/list", {}, reviewer));
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([...TOOLS.map((t) => t.name)].sort());
    const schedule = body.result.tools.find((t: { name: string }) => t.name === "schedule_task");
    expect(schedule.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(schedule.inputSchema.required).toEqual(expect.arrayContaining(["taskId", "socialAccountId", "scheduledAt"]));
    const list = body.result.tools.find((t: { name: string }) => t.name === "list_tasks");
    expect(list.annotations.readOnlyHint).toBe(true);
  });

  it("reports invalid arguments as a tool error without touching a route", async () => {
    const res = await rpc("tools/call", { name: "schedule_task", arguments: { taskId: "x" } }, operator);
    const body = await parse(res);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Invalid arguments for tool schedule_task");
    expect(await h.db.select().from(delivery)).toHaveLength(0);
  });
});

describe("tools replay the routes with the caller's rights", () => {
  it("reads tasks scoped like the REST route and returns structured content", async () => {
    const id = await awaitingTask("Visible");
    const rest = await parse(await h.request("/tasks?state=awaiting_approval", {}, operator));
    const mcp = await call("list_tasks", { state: "awaiting_approval" }, operator);
    expect(mcp.isError).toBeUndefined();
    expect(payload(mcp)).toEqual(rest);
    expect((mcp.structuredContent as { items: { id: string }[] }).items.map((t) => t.id)).toContain(id);
    const one = await call("get_task", { taskId: id }, operator);
    expect(payload(one)).toMatchObject({ id, state: "awaiting_approval" });
  });

  it("denies an operator the approval it cannot give over REST, with the same problem", async () => {
    const id = await awaitingTask("Pas pour moi");
    const rest = await post(`/tasks/${id}/approvals`, { decision: "approved" }, operator);
    expect(rest.status).toBe(403);
    const mcp = await call("decide_approval", { taskId: id, decision: "approved" }, operator);
    expect(mcp.isError).toBe(true);
    expect(payload(mcp)).toMatchObject({ status: 403, title: (await parse(rest)).title });
    expect(await taskState(id)).toBe("awaiting_approval");
  });

  it("walks approval, readiness and scheduling; the replay key makes scheduling idempotent", async () => {
    const id = await awaitingTask("À publier");
    const decided = await call("decide_approval", { taskId: id, decision: "approved", comment: "OK" }, reviewer);
    expect(decided.isError).toBeUndefined();
    expect(await taskState(id)).toBe("approved");

    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
    const ready = await call("check_publish_readiness", { taskId: id, socialAccountId: linkedin, scheduledAt }, operator);
    expect(payload(ready).ready).toBe(true);

    const args = { taskId: id, socialAccountId: linkedin, scheduledAt, idempotencyKey: "mcp-plan-1" };
    const first = await call("schedule_task", args, operator);
    expect(first.isError).toBeUndefined();
    const second = await call("schedule_task", args, operator);
    expect(payload(second).id).toBe(payload(first).id);
    expect(await h.db.select().from(delivery).where(eq(delivery.taskId, id))).toHaveLength(1);
    expect(await taskState(id)).toBe("scheduled");

    const reviewerTry = await call("schedule_task", { ...args, idempotencyKey: "mcp-plan-2" }, reviewer);
    expect(reviewerTry.isError).toBe(true);
    expect(payload(reviewerTry).status).toBe(403);
  });

  it("acknowledges alerts and reads the editorial report", async () => {
    const id = await awaitingTask("En attente depuis longtemps");
    await h.db
      .update(taskTransition)
      .set({ createdAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(taskTransition.taskId, id));
    await reconcileAlerts({ db: h.db, now: new Date() });
    const [row] = await h.db.select().from(alert).where(eq(alert.taskId, id));
    expect(row).toMatchObject({ kind: "approval_required", state: "open" });

    // Approval alerts are the reviewers' and admins' (parity with the route).
    expect(payload(await call("list_alerts", { state: "open" }, operator))).toEqual([]);
    const open = await call("list_alerts", { state: "open" }, reviewer);
    expect(payload(open).map((a: { id: string }) => a.id)).toContain(row!.id);
    const ack = await call("acknowledge_alert", { alertId: row!.id }, reviewer);
    expect(ack.isError).toBeUndefined();
    expect(payload(ack).state).toBe("acknowledged");

    const report = await call("get_editorial_report", { productId: "insight" }, reviewer);
    expect(report.isError).toBeUndefined();
    expect(payload(report).verified).toEqual([expect.objectContaining({ productId: "insight" })]);
  });
});

describe("official SDK client", () => {
  it("connects, lists tools and calls one through the stateless transport", async () => {
    // The client fetch is routed to the in-process app: same bytes a Worker would see.
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: async (url, init) => h.request(new URL(String(url)).pathname, init as RequestInit, operator),
    });
    const client = new Client({ name: "studio-test", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_tasks", "schedule_task"]));
      const result = await client.callTool({ name: "list_social_accounts", arguments: { productId: "insight" } });
      expect(result.isError).toBeFalsy();
      const items = (result.structuredContent as { items: { id: string }[] }).items;
      expect(items.map((a) => a.id)).toContain(linkedin);
    } finally {
      await client.close();
    }
  });
});
