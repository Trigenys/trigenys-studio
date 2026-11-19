import { defineConfig } from "drizzle-kit";
import { migrationCredentials } from "./src/db/migration-credentials.ts";

// DATABASE_URL is supplied at migration time by the AppFactory database lease
// (OIDC, .github/workflows/appfactory-infrastructure.yml), or by a Neon dev
// branch / local Postgres. Never committed. `db:generate` needs no database.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: databaseUrl ? migrationCredentials(databaseUrl) : { url: "" },
  migrations: { table: "drizzle_migrations", schema: "drizzle" },
});
