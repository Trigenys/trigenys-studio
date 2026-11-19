import { describe, expect, it } from "vitest";
import { isAppNavigation, withWebApp } from "../src/web/spa.ts";

const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://studio.example${path}`, { method, headers });
const nav = { "sec-fetch-mode": "navigate", accept: "text/html,application/xhtml+xml" };

describe("isAppNavigation", () => {
  it("sends a browser page load of a shared path to the app", () => {
    expect(isAppNavigation(req("/tasks/42", nav))).toBe(true);
    expect(isAppNavigation(req("/", nav))).toBe(true);
  });

  it("keeps fetch() calls on the API, even on the same path", () => {
    expect(isAppNavigation(req("/tasks/42", { "sec-fetch-mode": "cors", accept: "application/json" }))).toBe(false);
    expect(isAppNavigation(req("/tasks/42"))).toBe(false);
    expect(isAppNavigation(req("/tasks/42", { accept: "*/*" }))).toBe(false);
  });

  it("never sends server-only paths to the app", () => {
    for (const path of ["/api/auth/magic-link/verify?token=x", "/mcp", "/health", "/health/ready", "/openapi.json"]) {
      expect(isAppNavigation(req(path, nav))).toBe(false);
    }
  });

  it("treats an explicit HTML request without Fetch Metadata as a page load", () => {
    expect(isAppNavigation(req("/calendar", { accept: "text/html" }))).toBe(true);
  });

  it("ignores mutations", () => {
    expect(isAppNavigation(req("/tasks", nav, "POST"))).toBe(false);
  });
});

describe("withWebApp", () => {
  const api = () => new Response("api");
  const ASSETS = { fetch: async () => new Response("app") };

  it("routes page loads to the assets and the rest to the API", async () => {
    const handler = withWebApp(api);
    expect(await (await handler(req("/tasks/42", nav), { ASSETS }, {})).text()).toBe("app");
    expect(await (await handler(req("/tasks/42"), { ASSETS }, {})).text()).toBe("api");
  });

  it("is a no-op without the ASSETS binding (local dev, tests)", async () => {
    expect(await (await withWebApp(api)(req("/tasks/42", nav), {}, {})).text()).toBe("api");
  });
});
