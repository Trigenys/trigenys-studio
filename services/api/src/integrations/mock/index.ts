import type {
  Cms,
  Llm,
  LlmRequest,
  MetricsProvider,
  MetricTarget,
  PublishRequest,
  Publisher,
} from "../types.ts";

// Deterministic mocks: same input, same output, no network. They let every
// pipeline test run without a single external credential.

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class MockPublisher implements Publisher {
  readonly name = "mock-publisher";
  readonly published = new Map<string, PublishRequest>();

  async publish(request: PublishRequest) {
    const externalId = `mock-${(await sha256Hex(request.idempotencyKey)).slice(0, 12)}`;
    this.published.set(externalId, request);
    return {
      status: request.scheduledAt ? ("scheduled" as const) : ("published" as const),
      externalId,
      permalink: `https://example.invalid/${request.channel}/${externalId}`,
    };
  }

  async cancel(externalId: string) {
    this.published.delete(externalId);
  }
}

export class MockCms implements Cms {
  readonly name = "mock-cms";
  async listRecent(limit: number) {
    return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      externalRef: `mock-article-${i + 1}`,
      title: `Article de démonstration ${i + 1}`,
      url: `https://example.invalid/insight/article-${i + 1}`,
      publishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      excerpt: "Contenu fictif pour les tests.",
    }));
  }
}

export class MockMetrics implements MetricsProvider {
  readonly name = "mock-metrics";
  async fetch(target: MetricTarget) {
    const base = parseInt((await sha256Hex(target.ref)).slice(0, 4), 16) % 1000;
    return {
      target,
      measuredAt: new Date(0).toISOString(),
      metrics: { impressions: base * 10, clicks: base, reactions: Math.floor(base / 3) },
    };
  }
}

export class MockLlm implements Llm {
  readonly name = "mock-llm";
  async complete(request: LlmRequest) {
    return {
      model: "mock",
      output: `[${request.step}] ${request.prompt.slice(0, 80)}`,
      tokens: { input: request.prompt.length, output: 16 },
    };
  }
}
