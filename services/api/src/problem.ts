import { z } from "@hono/zod-openapi";

// RFC 9457 problem details: the single error shape every client relies on.
export const ProblemSchema = z
  .object({
    type: z.string().default("about:blank"),
    title: z.string(),
    status: z.int().min(100).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi("Problem");

export type Problem = z.infer<typeof ProblemSchema>;

export function problem(status: number, title: string, extra: Partial<Problem> = {}): Response {
  const body: Problem = { type: "about:blank", title, status, ...extra };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

// Thrown from typed route handlers (whose return type is fixed by the route
// contract); the app-level error handler turns it into a problem document.
export class ProblemError extends Error {
  readonly status: number;
  readonly title: string;
  readonly extra: Partial<Problem>;

  // No parameter properties: scripts run through Node's type stripping.
  constructor(status: number, title: string, extra: Partial<Problem> = {}) {
    super(title);
    this.name = "ProblemError";
    this.status = status;
    this.title = title;
    this.extra = extra;
  }

  toResponse(instance: string): Response {
    return problem(this.status, this.title, { instance, ...this.extra });
  }
}
