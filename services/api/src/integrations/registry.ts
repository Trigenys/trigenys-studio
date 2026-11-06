import type { Bindings, IntegrationMode } from "../env.ts";
import { AnthropicLlm } from "./anthropic/llm.ts";
import { BufferPublisher } from "./buffer/publisher.ts";
import { EditorialOsRadar } from "./editorial-os/radar.ts";
import { HttpJsonMetrics } from "./http-json/metrics.ts";
import { InsightCms } from "./insight/cms.ts";
import { MockCms, MockLlm, MockMetrics, MockPublisher, MockRadar } from "./mock/index.ts";
import { MockMailer } from "./mock/mailer.ts";
import { MemoryMediaStore } from "./mock/media.ts";
import { R2MediaStore } from "./r2/media.ts";
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
  publisher: (env) => {
    if (!env.BUFFER_API_KEY) {
      throw new IntegrationNotAvailableError("publisher", "live", "INTEGRATION_PUBLISHER_MODE=live requires the BUFFER_API_KEY secret");
    }
    return new BufferPublisher({ apiKey: env.BUFFER_API_KEY, baseUrl: env.BUFFER_BASE_URL, organizationId: env.BUFFER_ORGANIZATION_ID });
  },
  media: (env) => {
    if (!env.VISUALS) throw new IntegrationNotAvailableError("media", "live", "INTEGRATION_MEDIA_MODE=live requires the VISUALS R2 bucket binding");
    return new R2MediaStore(env.VISUALS);
  },
  llm: (env) => {
    if (!env.ANTHROPIC_API_KEY) {
      throw new IntegrationNotAvailableError("llm", "live", 'INTEGRATION_LLM_MODE=live requires the ANTHROPIC_API_KEY secret');
    }
    return new AnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });
  },
  cms: (env) => {
    if (!env.INSIGHT_BASE_URL || !env.INSIGHT_PUBLISHING_TOKEN) {
      throw new IntegrationNotAvailableError("cms", "live", "INTEGRATION_CMS_MODE=live requires INSIGHT_BASE_URL and the INSIGHT_PUBLISHING_TOKEN secret");
    }
    return new InsightCms({ baseUrl: env.INSIGHT_BASE_URL, token: env.INSIGHT_PUBLISHING_TOKEN });
  },
  metrics: (env) => {
    if (!env.METRICS_BASE_URL || !env.METRICS_TOKEN) {
      throw new IntegrationNotAvailableError("metrics", "live", "INTEGRATION_METRICS_MODE=live requires METRICS_BASE_URL and the METRICS_TOKEN secret");
    }
    return new HttpJsonMetrics({ baseUrl: env.METRICS_BASE_URL, token: env.METRICS_TOKEN });
  },
  radar: (env) => {
    if (!env.EDITORIAL_OS_BASE_URL || !env.EDITORIAL_OS_TOKEN) {
      throw new IntegrationNotAvailableError("radar", "live", "INTEGRATION_RADAR_MODE=live requires EDITORIAL_OS_BASE_URL and the EDITORIAL_OS_TOKEN secret");
    }
    return new EditorialOsRadar({ baseUrl: env.EDITORIAL_OS_BASE_URL, token: env.EDITORIAL_OS_TOKEN });
  },
};

function normalise(value: IntegrationMode | undefined): IntegrationMode {
  return value === "live" ? "live" : "mock";
}

export function integrationModes(env: Bindings): Record<keyof Integrations, IntegrationMode> {
  return {
    publisher: normalise(env.INTEGRATION_PUBLISHER_MODE),
    cms: normalise(env.INTEGRATION_CMS_MODE),
    radar: normalise(env.INTEGRATION_RADAR_MODE),
    metrics: normalise(env.INTEGRATION_METRICS_MODE),
    llm: normalise(env.INTEGRATION_LLM_MODE),
    email: normalise(env.INTEGRATION_EMAIL_MODE),
    media: normalise(env.INTEGRATION_MEDIA_MODE),
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
    radar: new MockRadar(),
    metrics: new MockMetrics(),
    llm: new MockLlm(),
    email: new MockMailer((line) => console.log(line)),
    media: new MemoryMediaStore(),
    ...selected,
    ...overrides,
  };
}
