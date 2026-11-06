import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { delivery, importItem, metricSnapshot, task } from "../db/schema.ts";
import type { MetricTarget, MetricsProvider } from "../integrations/types.ts";

// Idempotent snapshot refresh: measure the published targets (sent deliveries
// with a permalink, published articles with a URL) that were not fetched for
// `staleMinutes`, a bounded batch per run, one try/catch per target, and an
// insert that ignores a snapshot already stored for the same measurement.
// A second run with nothing new writes nothing.

export class MetricsNotConnectedError extends Error {
  constructor(provider: MetricsProvider) {
    super(`Metrics provider "${provider.name}" is not a verified source; connect a live provider (INTEGRATION_METRICS_MODE=live with METRICS_BASE_URL and the METRICS_TOKEN secret)`);
    this.name = "MetricsNotConnectedError";
  }
}

export type MetricsRefreshReport = {
  provider: string;
  considered: number;
  written: number;
  unchanged: number;
  errors: { ref: string; message: string }[];
};

type Candidate = { target: MetricTarget; productId: string; deliveryId: string | null; taskId: string | null };

const MAX_CANDIDATES = 500;

export async function refreshMetrics(options: {
  db: Db | Tx;
  provider: MetricsProvider;
  staleMinutes: number;
  batch: number;
  now?: () => Date;
}): Promise<MetricsRefreshReport> {
  const { db, provider } = options;
  if (!provider.verified) throw new MetricsNotConnectedError(provider);
  const now = options.now?.() ?? new Date();
  const threshold = new Date(now.getTime() - options.staleMinutes * 60_000);

  const sent = await db
    .select({ id: delivery.id, taskId: delivery.taskId, productId: task.productId, permalink: delivery.permalink })
    .from(delivery)
    .innerJoin(task, eq(task.id, delivery.taskId))
    .where(and(eq(delivery.status, "sent"), isNotNull(delivery.permalink)))
    .orderBy(delivery.sentAt)
    .limit(MAX_CANDIDATES);
  const articles = await db
    .select({ taskId: task.id, productId: task.productId, url: importItem.url })
    .from(task)
    .innerJoin(importItem, eq(importItem.taskId, task.id))
    .where(and(eq(task.type, "article"), inArray(task.state, ["published", "measured"]), isNotNull(importItem.url)))
    .orderBy(task.updatedAt)
    .limit(MAX_CANDIDATES);
  const candidates: Candidate[] = [
    ...sent.map((d) => ({ target: { kind: "deliverable" as const, ref: d.permalink! }, productId: d.productId, deliveryId: d.id, taskId: d.taskId })),
    ...articles.map((a) => ({ target: { kind: "url" as const, ref: a.url! }, productId: a.productId, deliveryId: null, taskId: a.taskId })),
  ];

  const last = candidates.length
    ? await db
        .select({ kind: metricSnapshot.targetKind, ref: metricSnapshot.targetRef, fetchedAt: sql<Date>`max(${metricSnapshot.fetchedAt})` })
        .from(metricSnapshot)
        .where(and(eq(metricSnapshot.provider, provider.name), inArray(metricSnapshot.targetRef, candidates.map((c) => c.target.ref))))
        .groupBy(metricSnapshot.targetKind, metricSnapshot.targetRef)
    : [];
  const lastOf = new Map(last.map((l) => [`${l.kind}\n${l.ref}`, new Date(l.fetchedAt).getTime()]));
  const due = candidates
    .map((c) => ({ c, at: lastOf.get(`${c.target.kind}\n${c.target.ref}`) ?? Number.NEGATIVE_INFINITY }))
    .filter(({ at }) => at < threshold.getTime())
    .sort((a, b) => a.at - b.at)
    .slice(0, options.batch)
    .map(({ c }) => c);

  const report: MetricsRefreshReport = { provider: provider.name, considered: due.length, written: 0, unchanged: 0, errors: [] };
  for (const c of due) {
    try {
      const snapshot = await provider.fetch(c.target);
      if (!snapshot) {
        report.unchanged += 1;
        continue;
      }
      const inserted = await db
        .insert(metricSnapshot)
        .values({
          productId: c.productId,
          targetKind: c.target.kind,
          targetRef: c.target.ref,
          deliveryId: c.deliveryId,
          taskId: c.taskId,
          provider: provider.name,
          measuredAt: new Date(snapshot.measuredAt),
          fetchedAt: now,
          metrics: snapshot.metrics,
        })
        .onConflictDoNothing({ target: [metricSnapshot.provider, metricSnapshot.targetKind, metricSnapshot.targetRef, metricSnapshot.measuredAt] })
        .returning({ id: metricSnapshot.id });
      if (inserted.length) report.written += 1;
      else report.unchanged += 1;
    } catch (e) {
      report.errors.push({ ref: c.target.ref, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}
