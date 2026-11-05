import type { Bindings, IntegrationMode } from "../env.ts";
import { MockCms, MockLlm, MockMetrics, MockPublisher } from "./mock/index.ts";
import type { Integrations } from "./types.ts";

export class IntegrationNotAvailableError extends Error {
  constructor(kind: keyof Integrations, mode: IntegrationMode) {
    super(`Integration "${kind}" has no "${mode}" adapter yet`);
    this.name = "IntegrationNotAvailableError";
  }
}

function normalise(value: IntegrationMode | undefined): IntegrationMode {
  return value === "live" ? "live" : "mock";
}

export function integrationModes(env: Bindings): Record<keyof Integrations, IntegrationMode> {
  return {
    publisher: normalise(env.INTEGRATION_PUBLISHER_MODE),
    cms: normalise(env.INTEGRATION_CMS_MODE),
    metrics: normalise(env.INTEGRATION_METRICS_MODE),
    llm: normalise(env.INTEGRATION_LLM_MODE),
  };
}

// Live adapters are added one by one (Buffer, Insight CMS, SEO Monitor,
// AI Gateway). Until then a "live" mode is an explicit, actionable error
// instead of a silent fallback to mock.
export function createIntegrations(env: Bindings): Integrations {
  const modes = integrationModes(env);
  for (const kind of Object.keys(modes) as (keyof Integrations)[]) {
    if (modes[kind] === "live") throw new IntegrationNotAvailableError(kind, "live");
  }
  return {
    publisher: new MockPublisher(),
    cms: new MockCms(),
    metrics: new MockMetrics(),
    llm: new MockLlm(),
  };
}
