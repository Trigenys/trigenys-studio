import type {
  Cms,
  ListQuery,
  Llm,
  LlmRequest,
  MetricsProvider,
  MetricTarget,
  PublishRequest,
  Publisher,
  Radar,
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
  async listArticles(query: ListQuery) {
    return Array.from({ length: Math.min(query.limit, 3) }, (_, i) => ({
      externalRef: `mock-article-${i + 1}`,
      locale: "fr",
      title: `Article de démonstration ${i + 1}`,
      excerpt: "Contenu fictif pour les tests.",
      status: "published" as const,
      url: `https://example.invalid/insight/article-${i + 1}`,
      publishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }));
  }
}

export class MockRadar implements Radar {
  readonly name = "mock-radar";
  async listProposals(query: ListQuery) {
    return Array.from({ length: Math.min(query.limit, 2) }, (_, i) => ({
      externalRef: `mock-topic-${i + 1}`,
      title: `Sujet radar ${i + 1}`,
      angle: "Angle proposé pour les tests.",
      format: "analysis",
      vertical: "insight",
      score: 70 + i,
      sources: [`https://example.invalid/source-${i + 1}`],
      observedAt: new Date(Date.UTC(2026, 1, i + 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 1, i + 1)).toISOString(),
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
