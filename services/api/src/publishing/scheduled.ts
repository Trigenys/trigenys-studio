import { createDb } from "../db/client.ts";
import type { Bindings } from "../env.ts";
import { createIntegrations } from "../integrations/registry.ts";
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
