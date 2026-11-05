import { describe, expect, it } from "vitest";
import { EditorialOsRadar } from "../src/integrations/editorial-os/radar.ts";
import { InsightCms } from "../src/integrations/insight/cms.ts";
import { UpstreamError } from "../src/integrations/upstream.ts";

type Call = { url: string; init: RequestInit };
const fetchStub = (status: number, body: unknown, calls: Call[] = []) =>
  Object.assign(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
    { calls },
  ) as unknown as typeof fetch & { calls: Call[] };

describe("InsightCms", () => {
  const docs = [
    { id: 12, slug: "neon-vs-supabase", title: "Neon vs Supabase", excerpt: "Comparatif", status: "PUBLISHED", updatedAt: "2026-03-02T10:00:00Z", publishedAt: "2026-03-01T08:00:00Z" },
    { id: 13, slug: "brouillon", title: "Brouillon", excerpt: null, status: "DRAFT", updatedAt: "2026-02-20T10:00:00Z", publishedAt: null },
    { id: 14, slug: "sans-traduction", title: "Sans traduction", status: "PUBLISHED", updatedAt: "2026-02-10T10:00:00Z", translationPresent: false },
  ];

  it("asks list-posts with the service token and maps articles", async () => {
    const f = fetchStub(200, { ok: true, docs });
    const cms = new InsightCms({ baseUrl: "https://insight.example/", token: "secret", fetch: f });
    const out = await cms.listArticles({ limit: 20 });
    expect(f.calls[0]!.url).toBe("https://insight.example/api/editorial-os");
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toMatchObject({ operation: "list-posts", locale: "fr", status: "ANY", sort: "-updatedAt", limit: 20 });
    expect(out).toEqual([
      { externalRef: "12:fr", locale: "fr", title: "Neon vs Supabase", excerpt: "Comparatif", status: "published", url: "https://insight.example/fr/posts/neon-vs-supabase", publishedAt: "2026-03-01T08:00:00Z", updatedAt: "2026-03-02T10:00:00Z" },
      { externalRef: "13:fr", locale: "fr", title: "Brouillon", excerpt: "", status: "draft", url: null, publishedAt: null, updatedAt: "2026-02-20T10:00:00Z" },
    ]);
  });

  it("drops articles older than `since` and turns HTTP errors into UpstreamError without the token", async () => {
    const cms = new InsightCms({ baseUrl: "https://insight.example", token: "secret", fetch: fetchStub(200, { ok: true, docs }) });
    expect((await cms.listArticles({ limit: 20, since: "2026-03-01T00:00:00Z" })).map((a) => a.externalRef)).toEqual(["12:fr"]);
    const broken = new InsightCms({ baseUrl: "https://insight.example", token: "secret", fetch: fetchStub(401, { ok: false }) });
    const err = await broken.listArticles({ limit: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).message).toContain("HTTP 401");
    expect((err as UpstreamError).message).not.toContain("secret");
  });
});

describe("EditorialOsRadar", () => {
  const runs = [
    { id: "run-1", vertical_key: "insight", topic_title: "Les LLM en PME", topic_decision: "PROPOSE", topic_proposed_angle: "Coût réel", topic_proposed_format: "analysis", topic_composite_score: 81.5, topic_sources: ["https://a.example", 3], pending_gate: "A", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-01T01:00:00Z" },
    { id: "run-2", topic_title: "Déjà validé", topic_decision: "PROPOSE", pending_gate: "B", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-01T01:00:00Z" },
    { id: "run-3", topic_title: null, topic_decision: "PROPOSE", pending_gate: "A", created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-01T01:00:00Z" },
  ];

  it("queries proposals waiting at the topic gate and maps them", async () => {
    const f = fetchStub(200, runs);
    const radar = new EditorialOsRadar({ baseUrl: "https://os.example", token: "tok", fetch: f });
    const out = await radar.listProposals({ limit: 10, since: "2026-01-31T00:00:00Z" });
    const url = new URL(f.calls[0]!.url);
    expect(url.pathname).toBe("/api/operator/runs");
    expect(url.searchParams.get("topic_decision")).toBe("PROPOSE");
    expect(url.searchParams.get("updated_after")).toBe("2026-01-31T00:00:00Z");
    expect(url.searchParams.get("limit")).toBe("10");
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(out).toEqual([
      { externalRef: "run-1", title: "Les LLM en PME", angle: "Coût réel", format: "analysis", vertical: "insight", score: 81.5, sources: ["https://a.example"], observedAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T01:00:00Z" },
    ]);
  });

  it("rejects an unexpected payload", async () => {
    const radar = new EditorialOsRadar({ baseUrl: "https://os.example", token: "tok", fetch: fetchStub(200, { items: [] }) });
    await expect(radar.listProposals({ limit: 10 })).rejects.toBeInstanceOf(UpstreamError);
  });
});
