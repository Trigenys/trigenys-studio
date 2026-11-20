import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { account, user } from "../db/schema.ts";
import type { Bindings } from "../env.ts";
import { recordAudit } from "./audit.ts";
import { findLinked, IDP_PROVIDER_ID, linkIdentity, reconcileIdpGrants } from "./identity.ts";
import { oidcConfigFromEnv } from "./oidc.ts";

// Directory sync: the team is entered once, in Trigenys Auth. The Studio reads
// the members of its organisations with a client_credentials token (scope
// `directory`) and converges its users on them: missing users are created and
// linked by `sub`, Trigenys Auth roles are copied (source "idp"), roles of
// members who left are withdrawn. Local users, local roles and local names are
// never touched. A converged directory costs reads only.

export type DirectoryConfig = {
  issuer: string;
  orgs: readonly string[];
  clientId: string;
  clientSecret: string;
  // Resource (token audience) and base URL of the directory endpoints.
  url: string;
};

export type DirectoryMember = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  orgRole: string | null;
  roles: string[];
};

export type DirectoryReport = {
  members: number;
  created: number;
  linked: number;
  renamed: number;
  rolesChanged: number;
  withdrawn: number;
  // Members not imported, with the reason; e-mails are never reported.
  skipped: { sub: string; reason: string }[];
};

export class DirectoryError extends Error {
  override name = "DirectoryError";
}

export function directoryConfigFromEnv(env: Bindings): DirectoryConfig | null {
  const oidc = oidcConfigFromEnv(env);
  const clientSecret = env.DIRECTORY_CLIENT_SECRET?.trim();
  if (!oidc || !clientSecret) return null;
  return {
    issuer: oidc.issuer,
    orgs: oidc.orgs,
    clientId: env.DIRECTORY_CLIENT_ID?.trim() || "trigenys-studio-directory",
    clientSecret,
    url: (env.DIRECTORY_URL?.trim() || `${oidc.issuer}/api/auth/directory`).replace(/\/+$/, ""),
  };
}

type Fetch = typeof fetch;

async function accessToken(config: DirectoryConfig, fetchImpl: Fetch): Promise<string> {
  const discovery = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
  });
  if (!discovery.ok) throw new DirectoryError(`discovery answered ${discovery.status}`);
  const doc = (await discovery.json()) as { issuer?: string; token_endpoint?: unknown };
  if (doc.issuer !== config.issuer) throw new DirectoryError("discovery issuer does not match OIDC_ISSUER");
  if (typeof doc.token_endpoint !== "string") throw new DirectoryError("discovery has no token_endpoint");

  const basic = btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`);
  const res = await fetchImpl(doc.token_endpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "directory", resource: config.url }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
  if (!res.ok || typeof body.access_token !== "string") {
    throw new DirectoryError(`token endpoint answered ${res.status}${typeof body.error === "string" ? ` (${body.error})` : ""}`);
  }
  return body.access_token;
}

// Members of every configured organisation, merged by `sub` (roles united).
// Any failure aborts the whole listing: a partial view must never withdraw roles.
export async function fetchDirectory(config: DirectoryConfig, fetchImpl: Fetch = fetch): Promise<DirectoryMember[]> {
  const token = await accessToken(config, fetchImpl);
  const merged = new Map<string, DirectoryMember>();
  for (const org of config.orgs) {
    const res = await fetchImpl(`${config.url}/members?${new URLSearchParams({ org })}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) throw new DirectoryError(`directory answered ${res.status} for organisation ${org}`);
    const body = (await res.json()) as { members?: unknown };
    if (!Array.isArray(body.members)) throw new DirectoryError(`directory returned no member list for ${org}`);
    for (const raw of body.members as Partial<DirectoryMember>[]) {
      if (typeof raw.sub !== "string" || !raw.sub) continue;
      const roles = Array.isArray(raw.roles) ? raw.roles.filter((r): r is string => typeof r === "string") : [];
      const prev = merged.get(raw.sub);
      merged.set(raw.sub, {
        sub: raw.sub,
        email: typeof raw.email === "string" ? raw.email : (prev?.email ?? null),
        emailVerified: raw.emailVerified === true || prev?.emailVerified === true,
        name: typeof raw.name === "string" ? raw.name : (prev?.name ?? null),
        orgRole: typeof raw.orgRole === "string" ? raw.orgRole : (prev?.orgRole ?? null),
        roles: [...new Set([...(prev?.roles ?? []), ...roles])],
      });
    }
  }
  return [...merged.values()];
}

// Finds or creates the Studio user of a member. An existing Studio user with
// the same e-mail is linked only when Trigenys Auth verified that e-mail; a new
// user is created otherwise, keeping the e-mail status Trigenys Auth reports.
async function resolveMember(
  db: Db,
  member: DirectoryMember,
  report: DirectoryReport,
): Promise<{ id: string; name: string } | null> {
  const linked = await findLinked(db, member.sub);
  if (linked) return linked;
  const email = member.email?.trim().toLowerCase();
  if (!email) {
    report.skipped.push({ sub: member.sub, reason: "no e-mail" });
    return null;
  }
  const [existing] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
  if (existing && !member.emailVerified) {
    report.skipped.push({ sub: member.sub, reason: "e-mail already used by a Studio user and not verified in Trigenys Auth" });
    return null;
  }
  let userId = existing?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await db
      .insert(user)
      .values({
        id: userId,
        email,
        name: member.name?.trim() || email.split("@")[0]!,
        emailVerified: member.emailVerified,
      })
      .onConflictDoNothing();
    const [row] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
    userId = row!.id;
    if (userId !== existing?.id) report.created++;
  }
  const resolved = await linkIdentity(db, member.sub, userId);
  if (resolved) report.linked++;
  return resolved;
}

export async function syncDirectory(db: Db, members: readonly DirectoryMember[], requestId?: string): Promise<DirectoryReport> {
  const report: DirectoryReport = { members: members.length, created: 0, linked: 0, renamed: 0, rolesChanged: 0, withdrawn: 0, skipped: [] };
  const present = new Set<string>();
  for (const member of members) {
    present.add(member.sub);
    const studioUser = await resolveMember(db, member, report);
    if (!studioUser) continue;
    // Only an empty name is filled: a name set in the Studio stays.
    const name = member.name?.trim();
    if (name && !studioUser.name.trim()) {
      await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, studioUser.id));
      report.renamed++;
    }
    const { added, removed } = await reconcileIdpGrants(db, studioUser.id, member.roles, requestId);
    if (added.length + removed.length > 0) report.rolesChanged++;
  }

  // Linked users absent from the directory left the organisations: their
  // Trigenys Auth roles go, the user and its local roles stay.
  const links = await db
    .select({ sub: account.accountId, userId: account.userId })
    .from(account)
    .where(eq(account.providerId, IDP_PROVIDER_ID));
  for (const link of links) {
    if (present.has(link.sub)) continue;
    const { removed } = await reconcileIdpGrants(db, link.userId, [], requestId);
    if (removed.length > 0) report.withdrawn++;
  }

  if (report.created + report.linked + report.renamed + report.rolesChanged + report.withdrawn > 0) {
    await recordAudit(db, {
      actor: null,
      action: "directory.sync",
      resource: { type: "directory" },
      outcome: "allowed",
      requestId,
      details: { source: IDP_PROVIDER_ID, ...report },
    });
  }
  return report;
}
