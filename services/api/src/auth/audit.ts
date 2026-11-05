import type { Db, Tx } from "../db/client.ts";
import { auditEvent, type AuditOutcome } from "../db/schema.ts";
import type { Principal, Resource } from "./rbac.ts";

export type AuditEntry = {
  actor: Principal | null;
  action: string;
  resource: Resource;
  outcome: AuditOutcome;
  requestId?: string;
  details?: Record<string, unknown>;
};

export async function recordAudit(db: Db | Tx, entry: AuditEntry): Promise<void> {
  await db.insert(auditEvent).values({
    actorId: entry.actor?.userId ?? null,
    action: entry.action,
    resourceType: entry.resource.type,
    resourceId: entry.resource.id ?? null,
    outcome: entry.outcome,
    requestId: entry.requestId ?? null,
    details: entry.details ?? null,
  });
}

// Runs a state change and its audit row in one transaction: either both are
// committed or neither is. Product code never writes audit rows by hand.
export async function audited<T>(
  db: Db,
  entry: Omit<AuditEntry, "outcome">,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await work(tx);
    await recordAudit(tx, { ...entry, outcome: "allowed" });
    return result;
  });
}
