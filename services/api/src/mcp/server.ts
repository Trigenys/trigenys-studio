import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../version.ts";
import type { Dispatcher } from "./dispatch.ts";
import { TOOLS } from "./tools.ts";

export const MCP_SERVER_NAME = "trigenys-studio";

// Tool results above this size are cut: an agent context is not a data export.
const MAX_RESULT_CHARS = 100_000;

function render(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated ${text.length - MAX_RESULT_CHARS} chars]`;
}

function structured(body: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(body)) return { items: body };
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return undefined;
}

// One server per request (stateless transport). Tools are closures over the
// caller's dispatcher, so credentials never leak between requests.
export function buildMcpServer(dispatch: Dispatcher): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: VERSION });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      async (args) => {
        const result = await dispatch(tool.toRequest(args));
        const text = render(result.body);
        if (result.status >= 400) return { isError: true, content: [{ type: "text", text }] };
        const content = structured(result.body);
        return { content: [{ type: "text", text }], ...(content ? { structuredContent: content } : {}) };
      },
    );
  }
  return server;
}
