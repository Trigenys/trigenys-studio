import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Db } from "../db/client.ts";
import { roleAssignment } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { problem } from "../problem.ts";
import { recordAudit } from "./audit.ts";
import { reconcileIdpGrants, resolveOidcUser } from "./identity.ts";
import { isJwtAccessToken, OidcTokenError } from "./oidc.ts";
import { decide, type Action, type Principal, type Resource } from "./rbac.ts";

export async function loadPrincipal(
  db: Db,
  user: { id: string; email: string; name: string },
): Promise<Principal> {
  const grants = await db
    .select({ role: roleAssignment.role, productId: roleAssignment.productId })
    .from(roleAssignment)
    .where(eq(roleAssignment.userId, user.id));
  return { userId: user.id, email: user.email, name: user.name, grants };
}

// Resolves the session (cookie or bearer token) once per request. Routes that
// need a user call requireSession(); public routes just read c.var.principal.
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // A JWT access token comes from Trigenys Auth (MCP clients over OAuth 2.1);
  // any other bearer or cookie stays a Better Auth session.
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (bearer && isJwtAccessToken(bearer)) {
    c.set("principal", c.var.oidc ? await oidcPrincipal(c, bearer) : null);
    if (!c.var.principal) c.set("tokenRejected", true);
    return next();
  }
  if (!c.var.auth) {
    c.set("principal", null);
    return next();
  }
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  c.set("principal", session ? await loadPrincipal(c.var.db, session.user) : null);
  await next();
});

async function oidcPrincipal(c: Context<AppEnv>, token: string): Promise<Principal | null> {
  const verifier = c.var.oidc!;
  let claims;
  try {
    claims = await verifier.verify(token);
  } catch (e) {
    if (e instanceof OidcTokenError) return null; // the reason is never echoed with the token
    throw e;
  }
  const user = await resolveOidcUser(c.var.db, claims, () => verifier.userinfo(token));
  await reconcileIdpGrants(c.var.db, user.id, claims.roles, c.var.requestId);
  return loadPrincipal(c.var.db, user);
}

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.principal) {
    return problem(401, "Authentication required", { instance: c.req.path });
  }
  await next();
});

export type ResourceLoader = (c: Context<AppEnv>) => Promise<Resource | null> | Resource | null;

// authorize(action, resource): 401 without session, 404 when the resource is
// missing, 403 (audited) when the policy denies. The decision is recorded on
// the context so handlers can audit the allowed outcome with their change.
export function authorize(action: Action, resource: ResourceLoader = () => ({ type: "service" })) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.var.principal;
    if (!principal) return problem(401, "Authentication required", { instance: c.req.path });
    const target = await resource(c);
    if (!target) return problem(404, "Not found", { instance: c.req.path });
    const decision = decide(action, principal, target);
    if (!decision.allowed) {
      await recordAudit(c.var.db, {
        actor: principal,
        action,
        resource: target,
        outcome: "denied",
        requestId: c.var.requestId,
        details: { reason: decision.reason },
      });
      return problem(403, "Forbidden", { instance: c.req.path, detail: decision.reason });
    }
    await next();
  });
}
