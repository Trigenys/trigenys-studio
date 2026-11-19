import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { bootstrapAdmin, BootstrapError } from "../src/admin/bootstrap.ts";
import { migrationCredentials } from "../src/db/migration-credentials.ts";
import * as schema from "../src/db/schema.ts";

// Run by the infrastructure workflow with the leased DATABASE_URL (never
// printed) and the ADMIN_EMAIL dispatch input.
const url = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL ?? "";
if (!url) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

// The leased URL carries no sslmode: same TLS rule as the migrations
// (verify-full for any non-local host), never a plain connection to Neon.
const client = postgres({ ...migrationCredentials(url), max: 1, fetch_types: false });
try {
  const report = await bootstrapAdmin(drizzle({ client, schema }), email);
  console.log(`Admin bootstrap: role ${report.granted ? "granted" : "already present"}, products created: ${report.productsCreated}.`);
} catch (e) {
  // A Postgres error code (SQLSTATE) is safe to print; messages and URLs are not.
  const code = typeof (e as { code?: unknown })?.code === "string" ? ` (code ${(e as { code: string }).code})` : "";
  console.error(e instanceof BootstrapError ? e.message : `Admin bootstrap failed: database error${code}.`);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
