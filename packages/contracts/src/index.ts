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
export type ImportItem = components["schemas"]["ImportItem"];
export type SyncImports = components["schemas"]["SyncImports"];
export type SyncReport = components["schemas"]["SyncReport"];
export type LinkImport = components["schemas"]["LinkImport"];
export type AssistRequest = components["schemas"]["AssistRequest"];
export type VisualFormat = components["schemas"]["VisualFormat"];
export type UpsertVisualFormat = components["schemas"]["UpsertVisualFormat"];
export type BrandKit = components["schemas"]["BrandKit"];
export type BrandPalette = components["schemas"]["BrandPalette"];
export type CreateBrandKit = components["schemas"]["CreateBrandKit"];
export type VisualAsset = components["schemas"]["VisualAsset"];
export type RenderVisual = components["schemas"]["RenderVisual"];
export type SocialAccount = components["schemas"]["SocialAccount"];
export type CreateSocialAccount = components["schemas"]["CreateSocialAccount"];
export type UpdateSocialAccount = components["schemas"]["UpdateSocialAccount"];
export type ProviderAccount = components["schemas"]["ProviderAccount"];
export type Delivery = components["schemas"]["Delivery"];
export type DeliveryAttempt = components["schemas"]["DeliveryAttempt"];
export type PublishReadiness = components["schemas"]["PublishReadiness"];
export type CreateDelivery = components["schemas"]["CreateDelivery"];
export type ScheduleDelivery = components["schemas"]["ScheduleDelivery"];
export type DispatchReport = components["schemas"]["DispatchReport"];
export type CalendarEntry = components["schemas"]["CalendarEntry"];
export type CalendarDueTask = components["schemas"]["CalendarDueTask"];
export type Calendar = components["schemas"]["Calendar"];
export type EditorialReport = components["schemas"]["EditorialReport"];
export type ContractObjective = components["schemas"]["ContractObjective"];
export type CreateContractObjective = components["schemas"]["CreateContractObjective"];
export type UpdateContractObjective = components["schemas"]["UpdateContractObjective"];
export type ObjectiveProgress = components["schemas"]["ObjectiveProgress"];
export type TaskCounts = components["schemas"]["TaskCounts"];
export type ChannelCampaign = components["schemas"]["ChannelCampaign"];
export type PublishedArticle = components["schemas"]["PublishedArticle"];
export type ReportProduct = components["schemas"]["ReportProduct"];
export type MetricSnapshot = components["schemas"]["MetricSnapshot"];
export type VerifiedMetrics = components["schemas"]["VerifiedMetrics"];
export type MetricsRefreshReport = components["schemas"]["MetricsRefreshReport"];
export type MetricsRefreshRequest = components["schemas"]["MetricsRefreshRequest"];
export type UpdateProduct = components["schemas"]["UpdateProduct"];

// Typed HTTP client shared by the web app (cookie session) and tooling.
// Mobile clients are generated from openapi.json with openapi-generator (Kotlin).
export function createStudioClient(baseUrl: string, options: Omit<ClientOptions, "baseUrl"> = {}) {
  return createClient<paths>({ baseUrl, credentials: "include", ...options });
}

export type StudioClient = ReturnType<typeof createStudioClient>;
