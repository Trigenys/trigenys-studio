import { describe, expect, it } from "vitest";
import { AuthConfigError, authConfigFromEnv } from "../src/auth/auth.ts";

const base = { AUTH_BASE_URL: "https://studio.example" };
const strong = "s".repeat(32);

describe("authConfigFromEnv", () => {
  it("accepts the AppFactory-generated production secret", () => {
    expect(authConfigFromEnv({ ...base, TRIGENYS_STUDIO_AUTH_SECRET: strong }).secret).toBe(strong);
  });

  it("prefers AUTH_SECRET when both are set", () => {
    const own = "a".repeat(40);
    expect(authConfigFromEnv({ ...base, AUTH_SECRET: own, TRIGENYS_STUDIO_AUTH_SECRET: strong }).secret).toBe(own);
  });

  it("rejects a missing or weak secret", () => {
    expect(() => authConfigFromEnv(base)).toThrow(AuthConfigError);
    expect(() => authConfigFromEnv({ ...base, TRIGENYS_STUDIO_AUTH_SECRET: "short" })).toThrow(/at least 32/);
  });
});
