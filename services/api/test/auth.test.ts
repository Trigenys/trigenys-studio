import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.ts";

let h: Harness;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (res: Response): Promise<any> => res.json();
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("authentication", () => {
  it("rejects anonymous access to /me with a 401 problem document", async () => {
    const res = await h.request("/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ status: 401, instance: "/me" });
  });

  it("signs in through a magic link and exposes a bearer token for native clients", async () => {
    const token = await h.signIn("alice@example.com", "Alice");
    const res = await h.request("/me", {}, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "alice@example.com", name: "Alice", grants: [] });
  });

  it("rejects a forged bearer token", async () => {
    const res = await h.request("/me", {}, "not-a-session-token");
    expect(res.status).toBe(401);
  });

  it("does not offer password sign-up", async () => {
    const res = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ email: "x@example.com", password: "password-1234", name: "x" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("serves passkey registration options to a signed-in user", async () => {
    const token = await h.signIn("bob@example.com");
    const res = await h.request("/api/auth/passkey/generate-register-options", {}, token);
    expect(res.status).toBe(200);
    const options = await parse(res);
    expect(options.rp).toMatchObject({ id: "localhost" });
    expect(options.user.name).toBe("bob@example.com");
  });

  it("answers 503 with an actionable problem when auth is not configured", async () => {
    const { createApp } = await import("../src/app.ts");
    const res = await createApp({ db: h.db }).request("/me", {}, {});
    expect(res.status).toBe(503);
    expect((await parse(res)).detail).toMatch(/AUTH_SECRET/);
  });
});
