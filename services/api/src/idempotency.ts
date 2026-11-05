import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "./db/client.ts";
import { idempotencyKey } from "./db/schema.ts";
import type { AppEnv } from "./env.ts";
import { sha256 } from "./pipeline/engine.ts";
import { ProblemError } from "./problem.ts";

export type Replayable<S extends number, B> = { status: S; body: B };

const isUniqueViolation = (e: unknown): boolean => {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

// Idempotency-Key semantics (IETF draft-ietf-httpapi-idempotency-key-header):
// same key + same request replays the stored response; same key with a
// different request is a 422. Keys are per actor. Without the header the
// work simply runs.
export async function idempotent<S extends number, B>(
  c: Context<AppEnv>,
  payload: unknown,
  work: () => Promise<Replayable<S, B>>,
): Promise<Replayable<S, B>> {
  const key = c.req.header("idempotency-key");
  const actorId = c.var.principal?.userId;
  if (!key || !actorId) return work();
  const db: Db = c.var.db;
  const scope = `${c.req.method} ${c.req.routePath}`;
  const fingerprint = await sha256(`${scope}\n${JSON.stringify(payload ?? null)}`);

  const replay = async (): Promise<Replayable<S, B> | null> => {
    const [row] = await db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.actorId, actorId)));
    if (!row) return null;
    if (row.fingerprint !== fingerprint) {
      throw new ProblemError(422, "Idempotency-Key reused for a different request", {
        detail: `Key "${key}" was already used with another payload or route`,
      });
    }
    return { status: row.status as S, body: row.body as B };
  };

  const stored = await replay();
  if (stored) return stored;
  const result = await work();
  try {
    await db
      .insert(idempotencyKey)
      .values({ key, actorId, scope, fingerprint, status: result.status, body: result.body as never });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost a race against an identical request: hand back what it stored.
    const winner = await replay();
    if (winner) return winner;
    throw e;
  }
  return result;
}
