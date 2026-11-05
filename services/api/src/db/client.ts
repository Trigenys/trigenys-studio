import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

// Driver-agnostic handle: postgres-js through Hyperdrive in the Worker,
// PGlite in tests. Product code never depends on the driver.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// One client per request: Hyperdrive owns the connection pool, so the
// per-request handshake is cheap and nothing leaks across isolates.
export function createDb(connectionString: string): Db {
  const client = postgres(connectionString, { max: 5, fetch_types: false });
  return drizzle({ client, schema });
}

export async function pingDb(connectionString: string): Promise<boolean> {
  const client = postgres(connectionString, { max: 1, fetch_types: false });
  try {
    await client`select 1`;
    return true;
  } finally {
    await client.end({ timeout: 1 });
  }
}
