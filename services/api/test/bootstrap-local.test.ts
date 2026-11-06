import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness.ts";

// scripts/bootstrap-local.sql grants the first admin and seeds the three
// products after a first sign-in; it must converge (a second run writes nothing).
describe("scripts/bootstrap-local.sql", () => {
  it("grants admin to the signed-in user and seeds the products, idempotently", async () => {
    const h = await createHarness();
    try {
      await h.signIn("vous@exemple.com");
      const script = await readFile("./scripts/bootstrap-local.sql", "utf8");
      const statements = script.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
      for (let pass = 0; pass < 2; pass++) for (const s of statements) await h.db.execute(sql.raw(s));
      const roles = await h.db.execute(sql`select role from role_assignment`);
      expect(roles.rows).toEqual([{ role: "admin" }]);
      const products = await h.db.execute(sql`select id from product order by id`);
      expect(products.rows.map((r) => r.id)).toEqual(["atelier", "insight", "precis"]);
      const res = await h.request("/products", { headers: { authorization: `Bearer ${await h.signIn("vous@exemple.com")}` } });
      expect(res.status).toBe(200);
    } finally {
      await h.close();
    }
  });
});
