import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize } from "../src/auth/middleware.ts";
import { decide, type Principal } from "../src/auth/rbac.ts";
import { auditEvent } from "../src/db/schema.ts";
import type { AppEnv } from "../src/env.ts";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
let admin: string;
let operator: string;
let reviewer: string;
let operatorId: string;

beforeAll(async () => {
  h = await createHarness();
  admin = await h.signIn("admin@example.com");
  operator = await h.signIn("operator@example.com");
  reviewer = await h.signIn("reviewer@example.com");
  await h.grant(await h.userIdOf(admin), "admin");
  operatorId = await h.userIdOf(operator);
  await h.grant(operatorId, "operator", "product-a");
  await h.grant(await h.userIdOf(reviewer), "reviewer");
});
afterAll(() => h.close());

const json = { "content-type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();

// Drizzle wraps driver errors; the trigger message sits on the cause.
const rootMessage = (e: unknown): string => {
  const cause = (e as { cause?: unknown })?.cause;
  return cause ? rootMessage(cause) : String((e as Error)?.message ?? e);
};

describe("role administration", () => {
  it("401 without a session, 403 for non-admins, 200 for admins", async () => {
    expect((await h.request("/roles")).status).toBe(401);
    expect((await h.request("/roles", {}, operator)).status).toBe(403);
    expect((await h.request("/roles", {}, reviewer)).status).toBe(403);
    const res = await h.request("/roles", {}, admin);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(3);
  });

  it("grants a role idempotently and audits the change in the same transaction", async () => {
    const body = JSON.stringify({ userId: operatorId, role: "reviewer", productId: "product-b" });
    const first = await h.request("/roles", { method: "POST", headers: json, body }, admin);
    expect(first.status).toBe(201);
    const second = await h.request("/roles", { method: "POST", headers: json, body }, admin);
    expect(second.status).toBe(200);
    expect((await parse(second)).id).toBe((await parse(first)).id);

    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "role.grant"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "allowed", resourceType: "role", details: { role: "reviewer" } });
    expect(rows[0]!.requestId).toBeTruthy();
  });

  it("refuses a grant for an unknown user with a 404 problem", async () => {
    const res = await h.request(
      "/roles",
      { method: "POST", headers: json, body: JSON.stringify({ userId: "nobody", role: "admin" }) },
      admin,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("rejects an unknown role with a 400 problem", async () => {
    const res = await h.request(
      "/roles",
      { method: "POST", headers: json, body: JSON.stringify({ userId: operatorId, role: "owner" }) },
      admin,
    );
    expect(res.status).toBe(400);
  });

  it("audits denied attempts", async () => {
    await h.request("/roles", { method: "POST", headers: json, body: "{}" }, reviewer);
    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.outcome, "denied"));
    expect(rows.some((r) => r.action === "role.grant")).toBe(true);
  });

  it("revokes an assignment (204) and audits it", async () => {
    const list = await parse(await h.request("/roles", {}, admin));
    const target = list.find((r: { productId: string | null }) => r.productId === "product-b");
    const res = await h.request(`/roles/${target.id}`, { method: "DELETE" }, admin);
    expect(res.status).toBe(204);
    expect((await h.request(`/roles/${target.id}`, { method: "DELETE" }, admin)).status).toBe(404);
    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "role.revoke"));
    expect(rows).toHaveLength(1);
  });
});

describe("publish policy", () => {
  it("publish without approval is 403 even for an operator", async () => {
    const op: Principal = {
      userId: "u",
      email: "o@x",
      name: "o",
      grants: [{ role: "operator", productId: "product-a" }],
    };
    expect(decide("content.publish", op, { type: "content", attributes: { approved: false } })).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/approved/),
    });
    expect(decide("content.publish", op, { type: "content", attributes: { approved: true } })).toEqual({
      allowed: true,
    });
  });

  it("a reviewer may review but never publish; a product-scoped operator stays in their product", async () => {
    const rev: Principal = { userId: "r", email: "r@x", name: "r", grants: [{ role: "reviewer", productId: null }] };
    expect(decide("content.review", rev, { type: "content" }).allowed).toBe(true);
    expect(decide("content.publish", rev, { type: "content", attributes: { approved: true } }).allowed).toBe(false);
    const op: Principal = { userId: "o", email: "o@x", name: "o", grants: [{ role: "operator", productId: "product-a" }] };
    expect(decide("content.write", op, { type: "content", productId: "product-a" }).allowed).toBe(true);
    expect(decide("content.write", op, { type: "content", productId: "product-b" }).allowed).toBe(false);
  });

  it("the middleware turns a denied decision into a 403 problem and an audit row", async () => {
    // A throwaway route wired with the real middleware: content lands in a later increment.
    const wired = new OpenAPIHono<AppEnv>()
      .use("*", async (c, next) => {
        c.set("db", h.db);
        c.set("requestId", "test");
        c.set("principal", {
          userId: operatorId,
          email: "operator@example.com",
          name: "operator",
          grants: [{ role: "operator", productId: "product-a" }],
        });
        await next();
      })
      .post(
        "/content/:id/publish",
        authorize("content.publish", (c) => ({ type: "content", id: c.req.param("id"), attributes: { approved: false } })),
        (c) => c.json({ published: true }),
      );
    const res = await wired.request("/content/42/publish", { method: "POST" });
    expect(res.status).toBe(403);
    expect((await parse(res)).detail).toMatch(/approved/);
    const rows = await h.db.select().from(auditEvent).where(eq(auditEvent.action, "content.publish"));
    expect(rows[0]).toMatchObject({ outcome: "denied", resourceId: "42", actorId: operatorId });
  });
});

describe("audit journal", () => {
  it("rejects UPDATE and DELETE whatever the caller", async () => {
    await expect(h.db.execute(sql`update audit_event set action = 'x'`).catch((e) => Promise.reject(rootMessage(e)))).rejects.toMatch(/append-only/);
    await expect(h.db.execute(sql`delete from audit_event`).catch((e) => Promise.reject(rootMessage(e)))).rejects.toMatch(/append-only/);
  });
});
