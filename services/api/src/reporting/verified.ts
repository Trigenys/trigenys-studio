import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { metricSnapshot } from "../db/schema.ts";
import type { MetricsProvider } from "../integrations/types.ts";

// Verified measures: timestamped snapshots of a verified provider, with their
// provenance on every row. Without a verified provider the section says so
// and carries no number at all (ADR 0010): a mock is never a measure.

export type SnapshotView = {
  targetKind: "deliverable" | "url";
  targetRef: string;
  provider: string;
  measuredAt: string;
  fetchedAt: string;
  metrics: Record<string, number>;
};

export type VerifiedMetrics =
  | { productId: string; status: "not_connected"; reason: string }
  | { productId: string; status: "connected"; provider: string; snapshots: SnapshotView[]; totals: Record<string, number> };

export type VerifiedScope = { productIds: string[]; sentDeliveryIds: string[]; publishedTaskIds: string[] };

export const notConnectedReason = (provider: MetricsProvider) =>
  `Aucune source de mesure vérifiée : le fournisseur « ${provider.name} » n'est pas connecté (INTEGRATION_METRICS_MODE=live avec METRICS_BASE_URL et METRICS_TOKEN)`;

export async function verifiedSection(db: Db, provider: MetricsProvider, scope: VerifiedScope): Promise<VerifiedMetrics[]> {
  if (!provider.verified) {
    const reason = notConnectedReason(provider);
    return scope.productIds.map((productId) => ({ productId, status: "not_connected" as const, reason }));
  }
  const refs = [];
  if (scope.sentDeliveryIds.length) refs.push(inArray(metricSnapshot.deliveryId, scope.sentDeliveryIds));
  if (scope.publishedTaskIds.length) refs.push(inArray(metricSnapshot.taskId, scope.publishedTaskIds));
  const rows = refs.length
    ? await db
        .selectDistinctOn([metricSnapshot.targetKind, metricSnapshot.targetRef])
        .from(metricSnapshot)
        .where(and(eq(metricSnapshot.provider, provider.name), inArray(metricSnapshot.productId, scope.productIds), or(...refs)))
        .orderBy(metricSnapshot.targetKind, metricSnapshot.targetRef, sql`${metricSnapshot.measuredAt} desc`)
    : [];
  return scope.productIds.map((productId) => {
    const snapshots: SnapshotView[] = rows
      .filter((r) => r.productId === productId)
      .map((r) => ({
        targetKind: r.targetKind,
        targetRef: r.targetRef,
        provider: r.provider,
        measuredAt: r.measuredAt.toISOString(),
        fetchedAt: r.fetchedAt.toISOString(),
        metrics: r.metrics,
      }));
    const totals: Record<string, number> = {};
    for (const s of snapshots) for (const [k, v] of Object.entries(s.metrics)) totals[k] = (totals[k] ?? 0) + v;
    return { productId, status: "connected" as const, provider: provider.name, snapshots, totals };
  });
}
