import type { Role } from "../db/schema.ts";

export type RoleGrant = { role: Role; productId: string | null };

export type Principal = {
  userId: string;
  email: string;
  name: string;
  grants: RoleGrant[];
};

// Everything a policy may need to know about the target of an action.
// Resource loaders fill it from the database before authorization runs.
export type Resource = {
  type: string;
  id?: string;
  productId?: string | null;
  attributes?: Record<string, unknown>;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

export type Policy = (principal: Principal, resource: Resource) => Decision;

export function hasRole(principal: Principal, roles: readonly Role[], productId?: string | null): boolean {
  return principal.grants.some(
    (g) => roles.includes(g.role) && (g.productId === null || productId == null || g.productId === productId),
  );
}

const allow: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

function roleOf(roles: readonly Role[], what: string): Policy {
  return (p, r) => (hasRole(p, roles, r.productId) ? allow : deny(`${what} requires one of: ${roles.join(", ")}`));
}

// Declarative policy table. Actions are "<resource>.<verb>"; the table is the
// single place product rules about who-may-do-what live.
export const policies = {
  "role.read": roleOf(["admin"], "Reading role assignments"),
  "role.grant": roleOf(["admin"], "Granting a role"),
  "role.revoke": roleOf(["admin"], "Revoking a role"),
  "product.read": roleOf(["admin", "operator", "reviewer"], "Reading products"),
  "product.manage": roleOf(["admin"], "Managing products"),
  "content.read": roleOf(["admin", "operator", "reviewer"], "Reading content"),
  "content.write": roleOf(["admin", "operator"], "Editing content"),
  "content.review": roleOf(["admin", "reviewer"], "Reviewing content"),
  // Publishing needs an operator *and* an approved item: approval is a state
  // of the resource, not a role, so a missing approval is a 403 as well.
  "social.read": roleOf(["admin", "operator", "reviewer"], "Reading social accounts"),
  "social.manage": roleOf(["admin"], "Managing social accounts"),
  "delivery.dispatch": roleOf(["admin"], "Running the publishing outbox"),
  "report.read": roleOf(["admin", "operator", "reviewer"], "Reading reports"),
  "objective.manage": roleOf(["admin"], "Managing contract objectives"),
  "metrics.refresh": roleOf(["admin"], "Refreshing verified metrics"),
  "alert.read": roleOf(["admin", "operator", "reviewer"], "Reading alerts"),
  "alert.acknowledge": roleOf(["admin", "operator", "reviewer"], "Acknowledging an alert"),
  "alert.reconcile": roleOf(["admin"], "Running the alert reconciliation"),
  "content.publish": (p, r) => {
    const base = roleOf(["admin", "operator"], "Publishing content")(p, r);
    if (!base.allowed) return base;
    return r.attributes?.approved === true ? allow : deny("Content must be approved before it is published");
  },
} satisfies Record<string, Policy>;

export type Action = keyof typeof policies;

export function decide(action: Action, principal: Principal, resource: Resource): Decision {
  return policies[action](principal, resource);
}

// Products the principal may read; null means all of them.
export const readableProducts = (p: Principal): string[] | null =>
  p.grants.some((g) => g.productId === null) ? null : [...new Set(p.grants.map((g) => g.productId!))];
