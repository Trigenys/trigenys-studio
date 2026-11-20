import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { directoryConfigFromEnv, type DirectoryMember } from "../src/auth/directory.ts";
import { account, auditEvent, roleAssignment, user } from "../src/db/schema.ts";
import type { Bindings } from "../src/env.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// A fake Trigenys Auth: discovery, the client_credentials token endpoint and
// the directory listing, answered by a stubbed fetch.
const ISSUER = "https://auth.test";
const DIRECTORY = `${ISSUER}/api/auth/directory`;
const SECRET = "directory-secret";
const env: Partial<Bindings> = {
  OIDC_ISSUER: ISSUER,
  OIDC_RESOURCE: "http://localhost/mcp",
  OIDC_ORGS: "trigenys",
  OIDC_APP: "trigenys-studio",
  DIRECTORY_CLIENT_SECRET: SECRET,
};

let members: DirectoryMember[] = [];
let listingStatus = 200;
const tokenRequests: URLSearchParams[] = [];

const fakeIdp = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.origin !== ISSUER) throw new Error(`unexpected fetch ${url.origin}`);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  switch (url.pathname) {
    case "/.well-known/openid-configuration":
      return reply({ issuer: ISSUER, token_endpoint: `${ISSUER}/api/auth/oauth2/token` });
    case "/api/auth/oauth2/token": {
      const form = new URLSearchParams(String(init?.body));
      tokenRequests.push(form);
      if (auth !== `Basic ${btoa(`trigenys-studio-directory:${SECRET}`)}`) return reply({ error: "invalid_client" }, 401);
      return reply({ access_token: "directory-token", token_type: "Bearer", expires_in: 300 });
    }
    case "/api/auth/directory/members":
      if (auth !== "Bearer directory-token") return reply({ error: "invalid_token" }, 401);
      if (url.searchParams.get("org") !== "trigenys") return reply({ error: "not_found" }, 404);
      if (listingStatus !== 200) return reply({ error: "server_error" }, listingStatus);
      return reply({ organization: { id: "org_1", slug: "trigenys", name: "Trigenys" }, app: "trigenys-studio", members });
  }
  return reply({}, 404);
};

const member = (sub: string, email: string | null, roles: string[], extra: Partial<DirectoryMember> = {}): DirectoryMember => ({
  sub,
  email,
  emailVerified: false,
  name: null,
  orgRole: "member",
  roles,
  ...extra,
});

describe("configuration", () => {
  it("is disabled without the client secret or the issuer", () => {
    expect(directoryConfigFromEnv({ ...env, DIRECTORY_CLIENT_SECRET: undefined } as Bindings)).toBeNull();
    expect(directoryConfigFromEnv({ DIRECTORY_CLIENT_SECRET: SECRET } as Bindings)).toBeNull();
  });

  it("defaults the client id and the directory URL from the issuer", () => {
    expect(directoryConfigFromEnv(env as Bindings)).toEqual({
      issuer: ISSUER,
      orgs: ["trigenys"],
      clientId: "trigenys-studio-directory",
      clientSecret: SECRET,
      url: DIRECTORY,
    });
  });
});

describe("directory sync", () => {
  let h: Harness;
  let adminToken: string;
  let adminId: string;
  let existingId: string;

  const sync = (token = adminToken) => h.request("/directory/sync", { method: "POST" }, token);
  const linkedUser = async (sub: string) => {
    const [row] = await h.db
      .select({ id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(and(eq(account.providerId, "trigenys-auth"), eq(account.accountId, sub)));
    return row;
  };
  const rolesOf = async (userId: string) =>
    (await h.db.select().from(roleAssignment).where(eq(roleAssignment.userId, userId)))
      .map((r) => `${r.role}:${r.source}`)
      .sort();
  const auditCount = async (action: string) =>
    (await h.db.select().from(auditEvent).where(eq(auditEvent.action, action))).length;

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeIdp));
    h = await createHarness({ env, oidc: null });
    adminToken = await h.signIn("admin@example.com");
    adminId = await h.userIdOf(adminToken);
    await h.grant(adminId, "admin");
    existingId = await h.userIdOf(await h.signIn("ibrahim@example.com"));
    // A Studio user without a name: the directory may fill it.
    await h.db.update(user).set({ name: "" }).where(eq(user.id, existingId));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await h.close();
  });

  it("is reserved to admins", async () => {
    const operator = await h.signIn("operator@example.com");
    await h.grant(await h.userIdOf(operator), "operator");
    expect((await sync(operator)).status).toBe(403);
  });

  it("imports the team: creates, links, copies roles, skips unsafe e-mails", async () => {
    members = [
      // New to the Studio, e-mail not verified yet in Trigenys Auth.
      member("sub-tiffany", "Tiffany@Example.com", ["operator"], { name: "Tiffany" }),
      // Existing Studio user, verified e-mail: linked, not duplicated.
      member("sub-ibrahim", "ibrahim@example.com", ["admin", "unknown-role"], { emailVerified: true, name: "Ibrahim", orgRole: "owner" }),
      // Unverified e-mail of an existing Studio user: never linked to it.
      member("sub-squatter", "admin@example.com", ["admin"]),
      member("sub-nomail", null, ["operator"]),
    ];
    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: 4,
      created: 1,
      linked: 2,
      renamed: 1,
      rolesChanged: 2,
      withdrawn: 0,
      skipped: [
        { sub: "sub-squatter", reason: expect.stringContaining("not verified") },
        { sub: "sub-nomail", reason: "no e-mail" },
      ],
    });

    // The token is a client_credentials grant for the directory resource only.
    expect(Object.fromEntries(tokenRequests.at(-1)!)).toEqual({
      grant_type: "client_credentials",
      scope: "directory",
      resource: DIRECTORY,
    });

    const tiffany = await linkedUser("sub-tiffany");
    expect(tiffany).toMatchObject({ email: "tiffany@example.com", name: "Tiffany", emailVerified: false });
    expect(await rolesOf(tiffany!.id)).toEqual(["operator:idp"]);

    const ibrahim = await linkedUser("sub-ibrahim");
    expect(ibrahim).toMatchObject({ id: existingId, name: "Ibrahim" });
    expect(await rolesOf(existingId)).toEqual(["admin:idp"]);

    expect(await linkedUser("sub-squatter")).toBeUndefined();
    expect(await rolesOf(adminId)).toEqual(["admin:local"]);
    expect(await auditCount("directory.sync")).toBe(1);
  });

  it("is a no-op once converged and keeps names set in the Studio", async () => {
    members = members.map((m) => (m.sub === "sub-tiffany" ? { ...m, name: "Tiff (Auth)" } : m));
    const audits = (await h.db.select().from(auditEvent)).length;
    const res = await sync();
    expect(await res.json()).toMatchObject({ created: 0, linked: 0, renamed: 0, rolesChanged: 0, withdrawn: 0 });
    expect((await h.db.select().from(auditEvent)).length).toBe(audits);
    expect((await linkedUser("sub-tiffany"))!.name).toBe("Tiffany");
  });

  it("aborts on a failed listing without withdrawing anyone", async () => {
    listingStatus = 503;
    const res = await sync();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { detail: string }).detail).toContain("503");
    listingStatus = 200;
    expect(await rolesOf(existingId)).toEqual(["admin:idp"]);
  });

  it("withdraws the Trigenys Auth roles of a member who left, keeping the user and local roles", async () => {
    const tiffany = (await linkedUser("sub-tiffany"))!;
    await h.grant(tiffany.id, "reviewer");
    members = members.filter((m) => m.sub !== "sub-tiffany");
    const res = await sync();
    expect(await res.json()).toMatchObject({ withdrawn: 1, rolesChanged: 0 });
    expect(await linkedUser("sub-tiffany")).toBeDefined();
    expect(await rolesOf(tiffany.id)).toEqual(["reviewer:local"]);

    // Coming back restores the role; the link is reused.
    members.push(member("sub-tiffany", "tiffany@example.com", ["operator"], { name: "Tiffany" }));
    expect(await (await sync()).json()).toMatchObject({ created: 0, linked: 0, rolesChanged: 1 });
    expect(await rolesOf(tiffany.id)).toEqual(["operator:idp", "reviewer:local"]);
  });

  it("answers 503 when not configured", async () => {
    const bare = await createHarness({ oidc: null });
    try {
      const token = await bare.signIn("root@example.com");
      await bare.grant(await bare.userIdOf(token), "admin");
      expect((await bare.request("/directory/sync", { method: "POST" }, token)).status).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
