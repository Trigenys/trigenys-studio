import { readFile } from "node:fs/promises";
import { auditEvent, product, roleAssignment } from "../src/db/schema.ts";
import { describe, expect, it } from "vitest";
import { bootstrapAdmin, BootstrapError, DEFAULT_PRODUCTS } from "../src/admin/bootstrap.ts";
import { createHarness } from "./support/harness.ts";

describe("bootstrapAdmin", () => {
  it("grants admin to a signed-in account, seeds the products and converges", async () => {
    const h = await createHarness();
    try {
      const token = await h.signIn("jennifer@exemple.com");
      expect(await bootstrapAdmin(h.db, "  Jennifer@Exemple.com ")).toEqual({ granted: true, productsCreated: 3 });
      expect(await bootstrapAdmin(h.db, "jennifer@exemple.com")).toEqual({ granted: false, productsCreated: 0 });

      expect(await h.db.select({ role: roleAssignment.role }).from(roleAssignment)).toEqual([{ role: "admin" }]);
      const audits = await h.db.select({ action: auditEvent.action }).from(auditEvent);
      expect(audits.filter((a) => a.action === "admin.bootstrap")).toHaveLength(1);
      const res = await h.request("/products", { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
    } finally {
      await h.close();
    }
  });

  it("refuses an unknown account and an invalid address without writing", async () => {
    const h = await createHarness();
    try {
      await expect(bootstrapAdmin(h.db, "personne@exemple.com")).rejects.toBeInstanceOf(BootstrapError);
      await expect(bootstrapAdmin(h.db, "pas-un-email")).rejects.toBeInstanceOf(BootstrapError);
      expect(await h.db.select().from(product)).toEqual([]);
      expect(await h.db.select().from(roleAssignment)).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("seeds the same products as scripts/bootstrap-local.sql", async () => {
    const script = await readFile("./scripts/bootstrap-local.sql", "utf8");
    for (const p of DEFAULT_PRODUCTS) expect(script).toContain(`('${p.id}', '${p.name}')`);
  });
});
