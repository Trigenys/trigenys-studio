import { passkeyClient } from "@better-auth/passkey/client";
import { createStudioClient, type Problem } from "@trigenys/studio-contracts";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Empty means "same origin" (dev proxy, or web and API behind one host).
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export const api = createStudioClient(API_URL);

export const authClient = createAuthClient({
  baseURL: API_URL || window.location.origin,
  basePath: "/api/auth",
  plugins: [magicLinkClient(), passkeyClient()],
});

// RFC 9457 problem carried as an Error so React Query can surface it.
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | null;
  constructor(status: number, problem: Problem | null) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

// openapi-fetch returns { data, error, response }; fold it into throw-on-error.
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(result.response.status, (result.error as Problem | undefined) ?? null);
  }
  return result.data as T;
}

export const idempotencyKey = () => ({ "idempotency-key": crypto.randomUUID() });
