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
