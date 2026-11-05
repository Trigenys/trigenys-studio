import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { AuthConfig } from "../../src/auth/auth.ts";
import { createApp } from "../../src/app.ts";
import type { Db } from "../../src/db/client.ts";
import * as schema from "../../src/db/schema.ts";
import { roleAssignment, type Role } from "../../src/db/schema.ts";
import { MockMailer } from "../../src/integrations/mock/mailer.ts";
import { MemoryMediaStore } from "../../src/integrations/mock/media.ts";
import type { Integrations } from "../../src/integrations/types.ts";

export const authConfig: AuthConfig = {
  secret: "test-secret-test-secret-test-secret-1234",
  baseURL: "http://localhost",
  trustedOrigins: ["http://localhost:5173"],
  rpID: "localhost",
  rpName: "Trigenys Studio (test)",
};

// A fresh in-memory Postgres per harness, migrated with the committed SQL so
// the migrations themselves are exercised by every test run.
export async function createHarness(options: { integrations?: Partial<Integrations> } = {}) {
  const client = new PGlite();
  const db = drizzle({ client, schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle", migrationsTable: "drizzle_migrations", migrationsSchema: "drizzle" });
  const mailer = new MockMailer();
  const media = new MemoryMediaStore();
  const app = createApp({ db, authConfig, integrations: { email: mailer, media, ...options.integrations } });

  const request = (path: string, init: RequestInit = {}, token?: string) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return app.request(path, { ...init, headers }, {});
  };

  // Full magic-link round trip: request a link, read it from the mock mailer,
  // verify it, keep the bearer token exposed for native clients.
  const signIn = async (email: string, name = email.split("@")[0]!): Promise<string> => {
    const sent = await request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ email, name }),
    });
    if (sent.status !== 200) throw new Error(`magic link request failed: ${sent.status} ${await sent.text()}`);
    const mail = mailer.sent.at(-1);
    const url = mail?.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error("no magic link in mailer");
    const verified = await request(new URL(url).pathname + new URL(url).search);
    const token = verified.headers.get("set-auth-token");
    if (!token) throw new Error(`magic link verify failed: ${verified.status} ${await verified.text()}`);
    return token;
  };

  const userIdOf = async (token: string): Promise<string> => {
    const res = await request("/me", {}, token);
    return ((await res.json()) as { userId: string }).userId;
  };

  const grant = async (userId: string, role: Role, productId: string | null = null) => {
    await db.insert(roleAssignment).values({ userId, role, productId });
  };

  return { app, db, mailer, media, request, signIn, userIdOf, grant, close: () => client.close() };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
