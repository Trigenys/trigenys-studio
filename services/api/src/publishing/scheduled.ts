import { dispatchNotifications, type NotifyReport } from "../alerts/notify.ts";
import { reconcileAlerts, type ReconcileReport } from "../alerts/reconcile.ts";
import { DEFAULT_ALERT_TUNING, type AlertTuning } from "../alerts/rules.ts";
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

const hoursOr = (raw: string | undefined, fallback: number) => {
  const n = Number(raw?.trim() || Number.NaN);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function alertTuning(env: Bindings): AlertTuning {
  return {
    approvalHours: hoursOr(env.ALERT_APPROVAL_HOURS, DEFAULT_ALERT_TUNING.approvalHours),
    stallHours: hoursOr(env.ALERT_STALL_HOURS, DEFAULT_ALERT_TUNING.stallHours),
    dueSoonHours: hoursOr(env.ALERT_DUE_SOON_HOURS, DEFAULT_ALERT_TUNING.dueSoonHours),
  };
}

// Base of the links in notification e-mails: WEB_APP_URL, else the first
// trusted browser origin, else nothing (and nothing is sent).
export function webAppUrl(env: Bindings): string | null {
  const explicit = env.WEB_APP_URL?.trim();
  if (explicit) return explicit;
  const first = env.AUTH_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).find((s) => s.length > 0);
  return first ?? null;
}

// Alerts after the outbox on the same cron: reconcile first (needs only the
// database), then send what was queued. A mailer that cannot be built in
// live mode fails the sending, not the reconciliation.
export async function runScheduledAlerts(env: Bindings): Promise<{ reconcile: ReconcileReport; notify: NotifyReport | null }> {
  if (!env.HYPERDRIVE) throw new Error("HYPERDRIVE binding is required for the scheduled alerts");
  const db = createDb(env.HYPERDRIVE.connectionString);
  const reconcile = await reconcileAlerts({ db, tuning: alertTuning(env) });
  console.log("alerts", JSON.stringify(reconcile));
  const { email } = createIntegrations(env);
  const notify = await dispatchNotifications({ db, mailer: email, webAppUrl: webAppUrl(env) });
  console.log("notifications", JSON.stringify(notify));
  return { reconcile, notify };
}
