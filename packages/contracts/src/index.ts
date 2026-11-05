import createClient, { type ClientOptions } from "openapi-fetch";
import type { components, paths } from "./schema.d.ts";

export type { components, paths };
export type Health = components["schemas"]["Health"];
export type Problem = components["schemas"]["Problem"];
export type Me = components["schemas"]["Me"];
export type RoleGrant = components["schemas"]["RoleGrant"];
export type RoleAssignment = components["schemas"]["RoleAssignment"];
export type GrantRole = components["schemas"]["GrantRole"];
export type Product = components["schemas"]["Product"];
export type CreateProduct = components["schemas"]["CreateProduct"];
export type Task = components["schemas"]["Task"];
export type TaskDetail = components["schemas"]["TaskDetail"];
export type ContentVersion = components["schemas"]["ContentVersion"];
export type Approval = components["schemas"]["Approval"];
export type CreateTask = components["schemas"]["CreateTask"];
export type UpdateTask = components["schemas"]["UpdateTask"];
export type CreateContentVersion = components["schemas"]["CreateContentVersion"];
export type Comment = components["schemas"]["Comment"];
export type CreateComment = components["schemas"]["CreateComment"];
export type TaskTransition = components["schemas"]["TaskTransition"];
export type RequestTransition = components["schemas"]["RequestTransition"];
export type DecideApproval = components["schemas"]["DecideApproval"];
export type TaskSource = components["schemas"]["TaskSource"];
export type CreateTaskSource = components["schemas"]["CreateTaskSource"];
export type AiInteraction = components["schemas"]["AiInteraction"];
export type AssistRequest = components["schemas"]["AssistRequest"];

// Typed HTTP client shared by the web app (cookie session) and tooling.
// Mobile clients are generated from openapi.json with openapi-generator (Kotlin).
export function createStudioClient(baseUrl: string, options: Omit<ClientOptions, "baseUrl"> = {}) {
  return createClient<paths>({ baseUrl, credentials: "include", ...options });
}

export type StudioClient = ReturnType<typeof createStudioClient>;
