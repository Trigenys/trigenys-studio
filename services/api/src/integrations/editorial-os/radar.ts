import type { ListQuery, Radar, RadarTopic } from "../types.ts";
import { UpstreamError, upstreamJson } from "../upstream.ts";

// Editorial OS radar, read through the operator API
// (`GET {base}/api/operator/runs`, bearer token). A proposal is a workflow
// run whose topic decision is PROPOSE and which waits at the topic gate.

type OperatorRunSummary = {
  id: string;
  vertical_key?: string | null;
  topic_title?: string | null;
  topic_decision?: string | null;
  topic_proposed_angle?: string | null;
  topic_proposed_format?: string | null;
  topic_composite_score?: number | null;
  topic_sources?: string[] | null;
  pending_gate?: string | null;
  created_at: string;
  updated_at: string;
};

export type EditorialOsRadarOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
};

export class EditorialOsRadar implements Radar {
  readonly name = "editorial-os-radar";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  private readonly token: string;

  constructor(options: EditorialOsRadarOptions) {
    this.token = options.token;
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listProposals(query: ListQuery): Promise<RadarTopic[]> {
    const params = new URLSearchParams({ topic_decision: "PROPOSE", limit: String(Math.min(Math.max(query.limit, 1), 100)) });
    if (query.since) params.set("updated_after", query.since);
    const runs = await upstreamJson<OperatorRunSummary[]>(this.name, this.fetchImpl, `${this.base}/api/operator/runs?${params}`, {
      headers: { accept: "application/json", authorization: `Bearer ${this.token}` },
    });
    if (!Array.isArray(runs)) throw new UpstreamError(this.name, "Unexpected runs response");
    return runs
      .filter((r) => r.topic_title && r.pending_gate === "A")
      .map((r) => ({
        externalRef: r.id,
        title: r.topic_title!,
        angle: r.topic_proposed_angle ?? null,
        format: r.topic_proposed_format ?? null,
        vertical: r.vertical_key ?? null,
        score: typeof r.topic_composite_score === "number" ? r.topic_composite_score : null,
        sources: (r.topic_sources ?? []).filter((s): s is string => typeof s === "string"),
        observedAt: r.created_at,
        updatedAt: r.updated_at,
      }));
  }
}
