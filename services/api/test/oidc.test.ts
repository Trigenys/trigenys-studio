import { and, eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isJwtAccessToken, oidcConfigFromEnv, type OidcConfig } from "../src/auth/oidc.ts";
import type { Bindings } from "../src/env.ts";
import { account, auditEvent, roleAssignment } from "../src/db/schema.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// A fake Trigenys Auth: discovery, JWKS and userinfo answered by a stubbed
// fetch, access tokens signed with an Ed25519 key like the real issuer.
const ISSUER = "https://auth.test";
const RESOURCE = "http://localhost/mcp";
const config: OidcConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  app: "trigenys-studio",
  orgs: ["trigenys"],
  scopes: ["openid", "email", "roles"],
};

let privateKey: CryptoKey;
let foreignKey: CryptoKey;
let jwk: Record<string, unknown>;
const userinfo = new Map<string, { email?: string; email_verified?: boolean; name?: string }>();

type Claims = Record<string, unknown> & { sub: string };
const token = (claims: Claims, opts: { key?: CryptoKey; typ?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT({ app: "trigenys-studio", org: { id: "org_1", slug: "trigenys", role: "member" }, ...claims })
    .setProtectedHeader({ alg: "EdDSA", typ: opts.typ ?? "at+jwt", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? RESOURCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);

const fakeIdp = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.origin !== ISSUER) throw new Error(`unexpected fetch ${url.origin}`);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  switch (url.pathname) {
    case "/.well-known/openid-configuration":
      return reply({
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/jwks`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        id_token_signing_alg_values_supported: ["EdDSA", "HS256"],
      });
    case "/jwks":
      return reply({ keys: [jwk] });
    case "/userinfo": {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const [, payload] = auth.replace(/^Bearer /, "").split(".");
      const sub = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
      const info = userinfo.get(sub);
      return info ? reply({ sub, ...info }) : reply({ error: "invalid_token" }, 401);
    }
  }
  return reply({}, 404);
};

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  privateKey = pair.privateKey;
  ({ privateKey: foreignKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" }));
  const publicKey = await exportJWK(pair.publicKey);
  jwk = { ...publicKey, kid: "k1", alg: "EdDSA", use: "sig" };
  vi.stubGlobal("fetch", vi.fn(fakeIdp));
});
afterAll(() => vi.unstubAllGlobals());

describe("configuration", () => {
  const env = (vars: Partial<Bindings>) => vars as Bindings;

  it("is disabled without an issuer", () => {
    expect(oidcConfigFromEnv(env({}))).toBeNull();
  });

  it("requires the resource and the organisations once enabled", () => {
    expect(() => oidcConfigFromEnv(env({ OIDC_ISSUER: ISSUER, OIDC_ORGS: "trigenys" }))).toThrow(/OIDC_RESOURCE/);
    expect(() => oidcConfigFromEnv(env({ OIDC_ISSUER: ISSUER, OIDC_RESOURCE: RESOURCE }))).toThrow(/OIDC_ORGS/);
  });

  it("normalises the issuer and defaults app and scopes", () => {
    const parsed = oidcConfigFromEnv(env({ OIDC_ISSUER: `${ISSUER}/`, OIDC_RESOURCE: RESOURCE, OIDC_ORGS: "trigenys, org_2" }));
    expect(parsed).toMatchObject({ issuer: ISSUER, app: "trigenys-studio", orgs: ["trigenys", "org_2"] });
    expect(parsed!.scopes).toContain("offline_access");
  });

  it("recognises JWT access tokens only", async () => {
    expect(isJwtAccessToken(await token({ sub: "u" }))).toBe(true);
    expect(isJwtAccessToken(await token({ sub: "u" }, { typ: "JWT" }))).toBe(false);
    expect(isJwtAccessToken("opaque-session-token")).toBe(false);
  });
});

describe("MCP as a protected resource of Trigenys Auth", () => {
  let h: Harness;
  let seq = 0;
  const rpc = (bearer?: string, headers: Record<string, string> = {}) =>
    h.request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/list", params: {} }),
      },
      bearer,
    );
  const idpRoles = (userId: string) =>
    h.db
      .select({ role: roleAssignment.role, source: roleAssignment.source })
      .from(roleAssignment)
      .where(eq(roleAssignment.userId, userId));
  const meOf = async (bearer: string) =>
    (await (await h.request("/me", {}, bearer)).json()) as { userId: string; email: string; name: string };
  const syncEvents = async () =>
    (await h.db.select().from(auditEvent).where(eq(auditEvent.action, "role.sync"))).length;

  beforeAll(async () => {
    h = await createHarness({ oidc: config });
  });
  afterAll(() => h.close());

  it("publishes the protected resource metadata (path-inserted and root)", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await h.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: config.scopes,
        bearer_methods_supported: ["header"],
        resource_name: "Trigenys Studio",
      });
    }
  });

  it("challenges an anonymous call with the metadata URL", async () => {
    const res = await rpc();
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate")!;
    expect(challenge).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('scope="openid email roles"');
    expect(challenge).not.toContain("invalid_token");
  });

  it("rejects tokens for another audience, app, organisation, signer or already expired", async () => {
    const bad = [
      await token({ sub: "x" }, { aud: "https://other.example/mcp" }),
      await token({ sub: "x", app: "trigenys-sign" }),
      await token({ sub: "x", org: { id: "org_9", slug: "acme" } }),
      await token({ sub: "x" }, { key: foreignKey }),
      await token({ sub: "x" }, { exp: "-10m" }),
    ];
    for (const t of bad) {
      const res = await rpc(t);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  it("links a verified e-mail to the existing Studio user and copies the roles", async () => {
    const session = await h.signIn("tiffany@trigenys.test");
    const userId = await h.userIdOf(session);
    await h.grant(userId, "reviewer", "insight"); // local, product-scoped: untouched

    const jwt = await token({ sub: "idp-tiffany", email: "Tiffany@Trigenys.test", email_verified: true, roles: ["operator"] });
    expect((await rpc(jwt)).status).toBe(200);
    const me = await meOf(jwt);
    expect(me.userId).toBe(userId);
    expect(await idpRoles(userId)).toEqual(
      expect.arrayContaining([
        { role: "operator", source: "idp" },
        { role: "reviewer", source: "local" },
      ]),
    );
    const links = await h.db
      .select()
      .from(account)
      .where(and(eq(account.providerId, "trigenys-auth"), eq(account.accountId, "idp-tiffany")));
    expect(links).toHaveLength(1);
  });

  it("is idempotent once converged and removes only the roles Trigenys Auth withdrew", async () => {
    const jwt = await token({ sub: "idp-tiffany", roles: ["operator"] });
    const before = await syncEvents();
    expect((await rpc(jwt)).status).toBe(200);
    expect(await syncEvents()).toBe(before); // no write when nothing changed

    const userId = (await meOf(jwt)).userId;
    await h.grant(userId, "admin"); // a local global role stays local
    expect((await rpc(await token({ sub: "idp-tiffany", roles: ["admin"] }))).status).toBe(200);
    expect(await idpRoles(userId)).toEqual(
      expect.arrayContaining([
        { role: "admin", source: "local" },
        { role: "reviewer", source: "local" },
      ]),
    );
    expect((await idpRoles(userId)).some((r) => r.source === "idp")).toBe(false);
    expect(await syncEvents()).toBe(before + 1);
  });

  it("creates the user from userinfo when the token carries no e-mail", async () => {
    userinfo.set("idp-new", { email: "new@trigenys.test", email_verified: true, name: "New Member" });
    const jwt = await token({ sub: "idp-new", roles: ["operator"] });
    expect((await rpc(jwt)).status).toBe(200);
    const me = await meOf(jwt);
    expect(me).toMatchObject({ email: "new@trigenys.test", name: "New Member" });
  });

  it("refuses a first connection without a verified e-mail", async () => {
    userinfo.set("idp-unverified", { email: "ghost@trigenys.test", email_verified: false });
    const res = await rpc(await token({ sub: "idp-unverified" }));
    expect(res.status).toBe(403);
  });

  it("keeps roles from Trigenys Auth out of local revocation", async () => {
    const admin = await h.signIn("admin@trigenys.test");
    await h.grant(await h.userIdOf(admin), "admin");
    const jwt = await token({ sub: "idp-new", roles: ["operator"] });
    const userId = (await meOf(jwt)).userId;
    const [row] = await h.db
      .select({ id: roleAssignment.id })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.userId, userId), eq(roleAssignment.source, "idp")));
    const res = await h.request(`/roles/${row!.id}`, { method: "DELETE" }, admin);
    expect(res.status).toBe(409);
  });

  it("accepts an OAuth token from a hosted client's own origin, still guards sessions", async () => {
    const jwt = await token({ sub: "idp-tiffany", roles: ["operator"] });
    expect((await rpc(jwt, { origin: "https://chatgpt.com" })).status).toBe(200);
    expect((await rpc(jwt, { origin: "https://chatgpt.com", cookie: "a=b" })).status).toBe(403);
    const session = await h.signIn("operator@trigenys.test");
    expect((await rpc(session, { origin: "https://chatgpt.com" })).status).toBe(403);
  });

  it("keeps Better Auth bearer sessions working next to OAuth tokens", async () => {
    const session = await h.signIn("operator@trigenys.test");
    expect((await rpc(session)).status).toBe(200);
  });
});

describe("with Trigenys Auth disabled", () => {
  it("serves no metadata and refuses JWT bearers", async () => {
    const h = await createHarness({ oidc: null });
    expect((await h.request("/.well-known/oauth-protected-resource/mcp")).status).toBe(404);
    const res = await h.request(
      "/mcp",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      await token({ sub: "x" }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="trigenys-studio"');
    await h.close();
  });
});
