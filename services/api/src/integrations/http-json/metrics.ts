import { z } from "@hono/zod-openapi";
import type { MetricSnapshot, MetricTarget, MetricsProvider } from "../types.ts";
import { UpstreamError, upstreamJson } from "../upstream.ts";

// Generic HTTP JSON metrics source (ADR 0010, contract v1): the SEO Monitor,
// Insight or a thin proxy exposes `GET {base}/v1/metrics?kind=&ref=` with a
// bearer token and answers `{ measuredAt, metrics: { name: number } }`, or
// 404 when the target has not been measured yet. Studio never guesses the
// upstream's own API: whoever owns it implements this contract.

const Payload = z.object({
  measuredAt: z.iso.datetime(),
  metrics: z.record(z.string().min(1), z.number().finite()),
});

export type HttpJsonMetricsOptions = { baseUrl: string; token: string; fetch?: typeof fetch };

export class HttpJsonMetrics implements MetricsProvider {
  readonly name = "http-json-metrics";
  readonly verified = true;
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpJsonMetricsOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetch(target: MetricTarget): Promise<MetricSnapshot | null> {
    const url = `${this.base}/v1/metrics?${new URLSearchParams({ kind: target.kind, ref: target.ref })}`;
    let raw: unknown;
    try {
      raw = await upstreamJson<unknown>(this.name, this.fetchImpl, url, { headers: { accept: "application/json", authorization: `Bearer ${this.token}` } });
    } catch (e) {
      if (e instanceof UpstreamError && e.upstreamStatus === 404) return null;
      throw e;
    }
    const parsed = Payload.safeParse(raw);
    if (!parsed.success) throw new UpstreamError(this.name, "Unexpected metrics payload (expected { measuredAt, metrics })");
    return { target, measuredAt: parsed.data.measuredAt, metrics: parsed.data.metrics };
  }
}
