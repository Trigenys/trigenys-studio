import { defineConfig } from "drizzle-kit";

// DATABASE_URL is supplied at migration time by the AppFactory database lease
// (OIDC) in CI, or by a Neon dev branch locally. Never committed.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  migrations: { table: "drizzle_migrations", schema: "drizzle" },
});
