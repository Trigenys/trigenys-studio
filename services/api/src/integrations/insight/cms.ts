import type { Cms, CmsArticle, ListQuery } from "../types.ts";
import { UpstreamError, upstreamJson } from "../upstream.ts";

// Trigenys Insight CMS, read through its automation endpoint
// (`POST {base}/api/editorial-os`, operation "list-posts", service bearer).
// The endpoint has no "updated after" filter: the sync asks for the most
// recently updated posts and stops at the first one older than `since`.

type PostSummary = {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  status: "DRAFT" | "PUBLISHED";
  updatedAt: string;
  publishedAt?: string | null;
  translationPresent?: boolean;
};

type ListPostsResponse = { ok: boolean; docs: PostSummary[]; hasNextPage?: boolean };

export type InsightCmsOptions = {
  baseUrl: string;
  token: string;
  locale?: string;
  fetch?: typeof fetch;
};

export class InsightCms implements Cms {
  readonly name = "insight-cms";
  private readonly base: string;
  private readonly locale: string;
  private readonly fetchImpl: typeof fetch;

  private readonly token: string;

  constructor(options: InsightCmsOptions) {
    this.token = options.token;
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.locale = options.locale ?? "fr";
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listArticles(query: ListQuery): Promise<CmsArticle[]> {
    const limit = Math.min(Math.max(query.limit, 1), 100);
    const body = await upstreamJson<ListPostsResponse>(this.name, this.fetchImpl, `${this.base}/api/editorial-os`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ operation: "list-posts", locale: this.locale, status: "ANY", sort: "-updatedAt", page: 1, limit }),
    });
    if (!body.ok || !Array.isArray(body.docs)) throw new UpstreamError(this.name, "Unexpected list-posts response");
    const since = query.since ? Date.parse(query.since) : Number.NEGATIVE_INFINITY;
    return body.docs
      .filter((d) => d.translationPresent !== false && Date.parse(d.updatedAt) >= since)
      .map((d) => ({
        externalRef: `${d.id}:${this.locale}`,
        locale: this.locale,
        title: d.title,
        excerpt: d.excerpt ?? "",
        status: d.status === "PUBLISHED" ? ("published" as const) : ("draft" as const),
        url: d.status === "PUBLISHED" ? `${this.base}/${this.locale}/posts/${d.slug}` : null,
        publishedAt: d.publishedAt ?? null,
        updatedAt: d.updatedAt,
      }));
  }
}
