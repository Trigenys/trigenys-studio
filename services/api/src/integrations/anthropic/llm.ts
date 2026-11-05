import Anthropic from "@anthropic-ai/sdk";
import type { Llm, LlmRequest, LlmResult } from "../types.ts";

export const DEFAULT_LLM_MODEL = "claude-opus-5-5";

export type AnthropicLlmOptions = {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  // Injected in tests; the Worker runtime provides the global fetch.
  fetch?: typeof fetch;
};

export class LlmRefusedError extends Error {
  constructor() {
    super("The model declined to produce this content");
    this.name = "LlmRefusedError";
  }
}

export class LlmUnavailableError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LlmUnavailableError";
    this.status = status;
  }
}

// Live adapter behind the generic Llm contract. The key is a Worker secret;
// nothing here reads it from anywhere else or writes it to logs.
export class AnthropicLlm implements Llm {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: AnthropicLlmOptions) {
    this.model = options.model ?? DEFAULT_LLM_MODEL;
    this.maxTokens = options.maxTokens ?? 4096;
    this.client = new Anthropic({ apiKey: options.apiKey, fetch: options.fetch, maxRetries: 2 });
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    try {
      const message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: { effort: "medium" },
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
      });
      if (message.stop_reason === "refusal") throw new LlmRefusedError();
      const output = message.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      return {
        model: message.model,
        output,
        tokens: { input: message.usage.input_tokens, output: message.usage.output_tokens },
      };
    } catch (e) {
      if (e instanceof LlmRefusedError) throw e;
      if (e instanceof Anthropic.APIError) {
        // Upstream failures are reported as such, never as our own 500s, and
        // without echoing request details that could carry the key.
        throw new LlmUnavailableError(e.status === 429 ? 429 : 502, `LLM provider error (${e.status ?? "network"})`);
      }
      throw e;
    }
  }
}
