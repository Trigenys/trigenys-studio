import { createDb } from "../db/client.ts";
import type { Bindings } from "../env.ts";
import { createIntegrations } from "../integrations/registry.ts";
import { refreshMetrics, type MetricsRefreshReport } from "../reporting/refresh.ts";
import { dispatch, type DispatchReport } from "./dispatch.ts";

// Cron entry point: the same outbox the admin route runs, on the Worker's
// schedule. Tuning comes from vars; the publisher from the integration mode.
export function dispatchTuning(env: Bindings): { leadMinutes: number } {
  const raw = env.PUBLISH_LEAD_MINUTES?.trim();
  const lead = raw ? Number(raw) : Number.NaN;
  return { leadMinutes: Number.isFinite(lead) && lead >= 0 ? lead : 10 };
}

export async function runScheduledDispatch(env: Bindings): Promise<DispatchReport> {
  if (!env.HYPERDRIVE) throw new Error("HYPERDRIVE binding is required for the scheduled dispatch");
  const db = createDb(env.HYPERDRIVE.connectionString);
  const { publisher } = createIntegrations(env);
  const report = await dispatch({ db, publisher, trigger: "cron", ...dispatchTuning(env) });
  console.log("dispatch", JSON.stringify(report));
  return report;
}

export function metricsTuning(env: Bindings): { staleMinutes: number; batch: number } {
  const stale = Number(env.METRICS_REFRESH_MINUTES?.trim() || Number.NaN);
  const batch = Number(env.METRICS_BATCH?.trim() || Number.NaN);
  return {
    staleMinutes: Number.isFinite(stale) && stale >= 0 ? stale : 360,
    batch: Number.isFinite(batch) && batch >= 1 ? Math.min(Math.floor(batch), 25) : 25,
  };
}

// Verified metrics refresh, next to the dispatch on the same cron. An
// unverified (mock) provider is a logged no-op: nothing fictitious is stored.
export async function runScheduledMetrics(env: Bindings): Promise<MetricsRefreshReport | null> {
  if (!env.HYPERDRIVE) throw new Error("HYPERDRIVE binding is required for the scheduled metrics refresh");
  const { metrics } = createIntegrations(env);
  if (!metrics.verified) {
    console.log("metrics skipped", JSON.stringify({ provider: metrics.name, reason: "not verified" }));
    return null;
  }
  const db = createDb(env.HYPERDRIVE.connectionString);
  const report = await refreshMetrics({ db, provider: metrics, ...metricsTuning(env) });
  console.log("metrics", JSON.stringify(report));
  return report;
}
