import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { account, ROLES, roleAssignment, user, type Role } from "../db/schema.ts";
import { ProblemError } from "../problem.ts";
import { recordAudit } from "./audit.ts";
import type { OidcClaims } from "./oidc.ts";

// Links a Trigenys Auth identity to a Studio user and copies its roles. The
// link is a Better Auth `account` row (providerId, accountId = sub), the same
// one a future web sign-in through Trigenys Auth writes. Both steps are
// idempotent: a converged user costs reads only.

export const IDP_PROVIDER_ID = "trigenys-auth";

export type StudioUser = { id: string; email: string; name: string };

type Profile = { email: string | null; emailVerified: boolean; name: string | null };

export async function resolveOidcUser(
  db: Db,
  claims: OidcClaims,
  profile: () => Promise<Profile>,
): Promise<StudioUser> {
  const linked = await findLinked(db, claims.sub);
  if (linked) return linked;

  // First connection: the e-mail decides whether an existing Studio user (magic
  // link, passkey) is the same person. Only a verified e-mail may link.
  const info = claims.email ? claims : await profile();
  const email = info.email?.trim().toLowerCase();
  if (!email || !info.emailVerified) {
    throw new ProblemError(403, "Unverified identity", {
      detail: "Trigenys Auth did not provide a verified e-mail for this account; verify it there, then reconnect.",
    });
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`);
  let userId = existing?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await db
      .insert(user)
      .values({ id: userId, email, name: info.name?.trim() || email.split("@")[0]!, emailVerified: true })
      .onConflictDoNothing();
    // A concurrent first connection may have created it: read back by e-mail.
    const [row] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
    userId = row!.id;
  }
  const resolved = await linkIdentity(db, claims.sub, userId);
  if (!resolved) throw new ProblemError(500, "Identity link failed");
  return resolved;
}

// Writes the (providerId, sub) account row once; a concurrent writer wins
// silently and the link is read back.
export async function linkIdentity(db: Db, sub: string, userId: string): Promise<StudioUser | null> {
  await db
    .insert(account)
    .values({ id: crypto.randomUUID(), providerId: IDP_PROVIDER_ID, accountId: sub, userId, updatedAt: new Date() })
    .onConflictDoNothing();
  return findLinked(db, sub);
}

export async function findLinked(db: Db, sub: string): Promise<StudioUser | null> {
  const [row] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.providerId, IDP_PROVIDER_ID), eq(account.accountId, sub)));
  return row ?? null;
}

// Desired state: the token roles within the Studio vocabulary, for every
// product. Only rows with source "idp" are compared and removed; a role the
// user already holds locally is left as is (no duplicate, never deleted).
export async function reconcileIdpGrants(
  db: Db,
  userId: string,
  roles: readonly string[],
  requestId?: string,
): Promise<{ added: Role[]; removed: Role[] }> {
  const desired = new Set(ROLES.filter((r) => roles.includes(r)));
  const current = await db
    .select({ id: roleAssignment.id, role: roleAssignment.role, source: roleAssignment.source })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.userId, userId), isNull(roleAssignment.productId)));

  const held = new Set(current.map((r) => r.role));
  const added = [...desired].filter((r) => !held.has(r));
  const stale = current.filter((r) => r.source === "idp" && !desired.has(r.role));
  if (added.length === 0 && stale.length === 0) return { added: [], removed: [] };

  await db.transaction(async (tx) => {
    if (added.length > 0) {
      await tx
        .insert(roleAssignment)
        .values(added.map((role) => ({ userId, role, productId: null, source: "idp" as const })))
        .onConflictDoNothing();
    }
    if (stale.length > 0) {
      await tx.delete(roleAssignment).where(
        and(
          inArray(
            roleAssignment.id,
            stale.map((r) => r.id),
          ),
          eq(roleAssignment.source, "idp"),
        ),
      );
    }
    await recordAudit(tx, {
      actor: null,
      action: "role.sync",
      resource: { type: "role", id: userId },
      outcome: "allowed",
      requestId,
      details: { source: IDP_PROVIDER_ID, added, removed: stale.map((r) => r.role) },
    });
  });
  return { added, removed: stale.map((r) => r.role) };
}
