import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { directoryConfigFromEnv, DirectoryError, fetchDirectory, syncDirectory } from "../auth/directory.ts";
import { authorize } from "../auth/middleware.ts";
import type { AppEnv } from "../env.ts";
import { ProblemError, ProblemSchema } from "../problem.ts";

const DirectoryReportSchema = z
  .object({
    members: z.number().int(),
    created: z.number().int(),
    linked: z.number().int(),
    renamed: z.number().int(),
    rolesChanged: z.number().int(),
    withdrawn: z.number().int(),
    skipped: z.array(z.object({ sub: z.string(), reason: z.string() })),
  })
  .openapi("DirectoryReport");

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ProblemSchema } },
});

const syncRoute = createRoute({
  method: "post",
  path: "/directory/sync",
  tags: ["identity"],
  summary: "Import the Trigenys Auth team now (admin, audited)",
  description:
    "Runs the directory sync the cron runs every few minutes: members of the configured organisations " +
    "become Studio users linked to their Trigenys Auth identity, with the roles granted there.",
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  middleware: [authorize("role.grant", () => ({ type: "role" }))] as const,
  responses: {
    200: { description: "Sync report", content: { "application/json": { schema: DirectoryReportSchema } } },
    401: problemResponse("No valid session"),
    403: problemResponse("Not an admin"),
    502: problemResponse("Trigenys Auth refused or failed the listing"),
    503: problemResponse("Directory sync not configured"),
  },
});

export const directoryRoutes = new OpenAPIHono<AppEnv>().openapi(syncRoute, async (c) => {
  const config = directoryConfigFromEnv(c.env ?? {});
  if (!config) {
    throw new ProblemError(503, "Directory sync not configured", {
      detail: "Set OIDC_ISSUER, OIDC_ORGS and the DIRECTORY_CLIENT_SECRET Worker secret.",
    });
  }
  try {
    const members = await fetchDirectory(config);
    return c.json(await syncDirectory(c.var.db, members, c.var.requestId), 200);
  } catch (e) {
    if (e instanceof DirectoryError) throw new ProblemError(502, "Directory unavailable", { detail: e.message });
    throw e;
  }
});
