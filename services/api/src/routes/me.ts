import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireSession } from "../auth/middleware.ts";
import { ROLES } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { ProblemSchema } from "../problem.ts";

export const RoleGrantSchema = z
  .object({
    role: z.enum(ROLES),
    productId: z.string().nullable().openapi({ description: "null when the role covers every product" }),
  })
  .openapi("RoleGrant");

export const MeSchema = z
  .object({
    userId: z.string(),
    email: z.email(),
    name: z.string(),
    grants: z.array(RoleGrantSchema),
  })
  .openapi("Me");

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const route = createRoute({
  method: "get",
  path: "/me",
  tags: ["identity"],
  summary: "Current user and role grants",
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  middleware: [requireSession] as const,
  responses: {
    200: { description: "Authenticated principal", content: { "application/json": { schema: MeSchema } } },
    401: problemResponse("No valid session"),
  },
});

export const meRoutes = new OpenAPIHono<AppEnv>().openapi(route, (c) => c.json(c.var.principal!, 200));
