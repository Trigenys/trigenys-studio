import createClient, { type ClientOptions } from "openapi-fetch";
import type { components, paths } from "./schema.d.ts";

export type { components, paths };
export type Health = components["schemas"]["Health"];
export type Problem = components["schemas"]["Problem"];

// Typed HTTP client shared by the web app (cookie session) and tooling.
// Mobile clients are generated from openapi.json with openapi-generator (Kotlin).
export function createStudioClient(baseUrl: string, options: Omit<ClientOptions, "baseUrl"> = {}) {
  return createClient<paths>({ baseUrl, credentials: "include", ...options });
}

export type StudioClient = ReturnType<typeof createStudioClient>;
