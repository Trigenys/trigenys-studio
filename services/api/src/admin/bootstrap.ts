import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../auth/audit.ts";
import type { Db } from "../db/client.ts";
import { product, roleAssignment, user } from "../db/schema.ts";

// First admin of an environment, plus the product catalogue. No one can grant
// a role through the API before an admin exists, so this runs out of band
// (infrastructure workflow, or scripts/bootstrap-local.sql in development).
// Idempotent: a second run with the same e-mail writes nothing.

export const DEFAULT_PRODUCTS = [
  { id: "insight", name: "Trigenys Insight" },
  { id: "precis", name: "Précis Translator" },
  { id: "atelier", name: "Atelier Maître" },
] as const;

export type BootstrapReport = { granted: boolean; productsCreated: number };

export class BootstrapError extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapAdmin(db: Db, email: string): Promise<BootstrapReport> {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) throw new BootstrapError("ADMIN_EMAIL is not a valid e-mail address.");

  return db.transaction(async (tx) => {
    const [account] = await tx.select({ id: user.id }).from(user).where(eq(user.email, address));
    if (!account) {
      throw new BootstrapError("No account for this e-mail yet: sign in once with the magic link, then rerun.");
    }

    const existing = await tx
      .select({ id: roleAssignment.id })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.userId, account.id), eq(roleAssignment.role, "admin"), isNull(roleAssignment.productId)));
    const granted = existing.length === 0;
    if (granted) await tx.insert(roleAssignment).values({ userId: account.id, role: "admin", productId: null });

    const created = await tx.insert(product).values([...DEFAULT_PRODUCTS]).onConflictDoNothing().returning({ id: product.id });

    if (granted || created.length > 0) {
      await recordAudit(tx, {
        actor: null,
        action: "admin.bootstrap",
        resource: { type: "role" },
        outcome: "allowed",
        details: { userId: account.id, granted, productsCreated: created.map((p) => p.id) },
      });
    }
    return { granted, productsCreated: created.length };
  });
}
