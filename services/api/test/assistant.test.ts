import { describe, expect, it } from "vitest";
import { buildPrompt, NEEDS_VERSION } from "../src/assistant/prompt.ts";
import { AnthropicLlm, LlmRefusedError, LlmUnavailableError } from "../src/integrations/anthropic/llm.ts";
import { createIntegrations, IntegrationNotAvailableError } from "../src/integrations/registry.ts";

const task = { id: "t1", title: "Lancement", type: "post", productId: "insight", brief: "Annoncer Insight." };

describe("prompt builder", () => {
  it("includes the brief, the sources and the latest version, and records their refs", () => {
    const p = buildPrompt({
      action: "fix",
      channel: "linkedin",
      instruction: "Garder le ton.",
      task,
      latestVersion: { id: "v9", n: 2, channel: "linkedin", body: "Bonjour" },
      sources: [{ id: "s1", title: "Doc", url: "https://example.com", note: "p. 2" }],
    });
    expect(p.contextRefs).toEqual(["task:t1", "source:s1", "version:v9"]);
    expect(p.prompt).toContain("# Brief\nAnnoncer Insight.");
    expect(p.prompt).toContain("- Doc (https://example.com) — p. 2");
    expect(p.prompt).toContain("# Version actuelle (v2, linkedin)\nBonjour");
    expect(p.prompt).toContain("Corrige la version actuelle pour le canal « linkedin »");
    expect(p.prompt).toContain("# Précision de l'opérateur\nGarder le ton.");
    expect(p.system).toContain("n'inventes ni chiffre ni citation");
  });

  it("leaves out empty sections and only flags the editing actions as needing a version", () => {
    const p = buildPrompt({ action: "propose", channel: "x", instruction: "  ", task: { ...task, brief: "" }, latestVersion: null, sources: [] });
    expect(p.contextRefs).toEqual(["task:t1"]);
    expect(p.prompt).not.toContain("# Brief");
    expect(p.prompt).not.toContain("# Sources");
    expect(p.prompt).not.toContain("# Précision");
    expect([...NEEDS_VERSION].sort()).toEqual(["adapt", "fix", "summarize"]);
  });
});

describe("live llm selection", () => {
  it("needs the ANTHROPIC_API_KEY secret in live mode and stays mock otherwise", () => {
    expect(() => createIntegrations({ INTEGRATION_LLM_MODE: "live" })).toThrow(IntegrationNotAvailableError);
    expect(() => createIntegrations({ INTEGRATION_LLM_MODE: "live" })).toThrow(/ANTHROPIC_API_KEY/);
    const live = createIntegrations({ INTEGRATION_LLM_MODE: "live", ANTHROPIC_API_KEY: "sk-test", LLM_MODEL: "claude-sonnet-5-5" });
    expect(live.llm.name).toBe("anthropic");
    expect((live.llm as AnthropicLlm).model).toBe("claude-sonnet-5-5");
    expect(createIntegrations({ ANTHROPIC_API_KEY: "sk-test" }).llm.name).toBe("mock-llm");
  });
});

// The adapter is exercised against a fake transport: what it sends and how it
// maps the provider's answers, without any network.
const message = (over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5-20260401",
  content: [{ type: "text", text: "Texte proposé." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 8 },
  ...over,
});

const transport = (status: number, body: unknown) => {
  const calls: { url: string; headers: Headers; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
};

describe("anthropic adapter", () => {
  it("sends the system prompt, the model and the fallback beta; returns text and token usage", async () => {
    const t = transport(200, message());
    const llm = new AnthropicLlm({ apiKey: "sk-test", fetch: t.fetchImpl });
    const r = await llm.complete({ step: "propose", system: "Sys", prompt: "Écris.", contextRefs: [] });
    expect(r).toEqual({ model: "claude-opus-5-5-20260401", output: "Texte proposé.", tokens: { input: 120, output: 8 } });
    const [call] = t.calls;
    expect(call!.url).toMatch(/\/v1\/messages/);
    expect(call!.headers.get("x-api-key") ?? call!.headers.get("authorization")).toContain("sk-test");
    expect(call!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call!.body).toMatchObject({
      model: "claude-opus-5-5",
      system: "Sys",
      messages: [{ role: "user", content: "Écris." }],
      fallbacks: "default",
      output_config: { effort: "medium" },
    });
  });

  it("surfaces a refusal and provider failures as typed errors, never as text", async () => {
    const refused = new AnthropicLlm({ apiKey: "sk-test", fetch: transport(200, message({ stop_reason: "refusal", content: [] })).fetchImpl });
    await expect(refused.complete({ step: "propose", prompt: "x", contextRefs: [] })).rejects.toBeInstanceOf(LlmRefusedError);

    const down = new AnthropicLlm({
      apiKey: "sk-test",
      fetch: transport(500, { type: "error", error: { type: "api_error", message: "boom" } }).fetchImpl,
    });
    const e = await down.complete({ step: "propose", prompt: "x", contextRefs: [] }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LlmUnavailableError);
    expect((e as LlmUnavailableError).status).toBe(502);
    expect((e as Error).message).not.toContain("sk-test");
  });
});
