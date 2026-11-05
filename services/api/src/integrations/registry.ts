import type { Bindings, IntegrationMode } from "../env.ts";
import { AnthropicLlm } from "./anthropic/llm.ts";
import { MockCms, MockLlm, MockMetrics, MockPublisher } from "./mock/index.ts";
import { MockMailer } from "./mock/mailer.ts";
import type { Integrations } from "./types.ts";

export class IntegrationNotAvailableError extends Error {
  constructor(kind: keyof Integrations, mode: IntegrationMode, detail?: string) {
    super(detail ?? `Integration "${kind}" has no "${mode}" adapter yet`);
    this.name = "IntegrationNotAvailableError";
  }
}

// Live adapters, one per integration kind, built from the Worker bindings.
// A missing secret is an explicit, actionable error at request time.
const live: Partial<{ [K in keyof Integrations]: (env: Bindings) => Integrations[K] }> = {
  llm: (env) => {
    if (!env.ANTHROPIC_API_KEY) {
      throw new IntegrationNotAvailableError("llm", "live", 'INTEGRATION_LLM_MODE=live requires the ANTHROPIC_API_KEY secret');
    }
    return new AnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });
  },
};

function normalise(value: IntegrationMode | undefined): IntegrationMode {
  return value === "live" ? "live" : "mock";
}

export function integrationModes(env: Bindings): Record<keyof Integrations, IntegrationMode> {
  return {
    publisher: normalise(env.INTEGRATION_PUBLISHER_MODE),
    cms: normalise(env.INTEGRATION_CMS_MODE),
    metrics: normalise(env.INTEGRATION_METRICS_MODE),
    llm: normalise(env.INTEGRATION_LLM_MODE),
    email: normalise(env.INTEGRATION_EMAIL_MODE),
  };
}

// Live adapters are added one by one (Buffer, Insight CMS, SEO Monitor,
// AI Gateway). Until then a "live" mode is an explicit, actionable error
// instead of a silent fallback to mock.
export function createIntegrations(env: Bindings, overrides: Partial<Integrations> = {}): Integrations {
  const modes = integrationModes(env);
  const selected: Partial<Integrations> = {};
  for (const kind of Object.keys(modes) as (keyof Integrations)[]) {
    if (modes[kind] !== "live" || overrides[kind]) continue;
    const factory = live[kind];
    if (!factory) throw new IntegrationNotAvailableError(kind, "live");
    (selected as Record<string, unknown>)[kind] = factory(env);
  }
  return {
    publisher: new MockPublisher(),
    cms: new MockCms(),
    metrics: new MockMetrics(),
    llm: new MockLlm(),
    email: new MockMailer((line) => console.log(line)),
    ...selected,
    ...overrides,
  };
}
