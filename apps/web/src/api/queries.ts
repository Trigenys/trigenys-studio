import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiInteraction,
  AssistRequest,
  BrandKit,
  CreateBrandKit,
  RenderVisual,
  VisualAsset,
  VisualFormat,
  CreateTaskSource,
  TaskSource,
  Comment,
  ContentVersion,
  CreateComment,
  CreateContentVersion,
  CreateTask,
  DecideApproval,
  ImportItem,
  LinkImport,
  Me,
  Product,
  RequestTransition,
  SyncImports,
  SyncReport,
  Task,
  TaskDetail,
  TaskTransition,
  UpdateTask,
} from "@trigenys/studio-contracts";
import { useEffect } from "react";
import { API_URL, ApiError, api, idempotencyKey, unwrap } from "./client";

export const keys = {
  me: ["me"] as const,
  products: ["products"] as const,
  tasks: (productId: string | null) => ["tasks", productId ?? "all"] as const,
  task: (id: string) => ["task", id] as const,
  versions: (id: string) => ["task", id, "versions"] as const,
  comments: (id: string) => ["task", id, "comments"] as const,
  transitions: (id: string) => ["task", id, "transitions"] as const,
};

export function useMe() {
  return useQuery<Me, ApiError>({
    queryKey: keys.me,
    queryFn: async () => unwrap(await api.GET("/me")),
    retry: (count, error) => error.status !== 401 && count < 2,
    staleTime: 5 * 60_000,
  });
}

export function useProducts() {
  return useQuery<Product[], ApiError>({
    queryKey: keys.products,
    queryFn: async () => unwrap(await api.GET("/products")),
    staleTime: 5 * 60_000,
  });
}

// One list per product scope; the views are derived client-side (see views.ts)
// so switching view costs nothing and the counts stay consistent.
export function useTasks(productId: string | null) {
  return useQuery<Task[], ApiError>({
    queryKey: keys.tasks(productId),
    queryFn: async () => unwrap(await api.GET("/tasks", { params: { query: productId ? { productId } : {} } })),
    staleTime: 30_000,
  });
}

export function useTask(id: string) {
  return useQuery<TaskDetail, ApiError>({
    queryKey: keys.task(id),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}", { params: { path: { id } } })),
  });
}

export function useVersions(id: string) {
  return useQuery<ContentVersion[], ApiError>({
    queryKey: keys.versions(id),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}/versions", { params: { path: { id } } })),
  });
}

export function useComments(id: string) {
  return useQuery<Comment[], ApiError>({
    queryKey: keys.comments(id),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}/comments", { params: { path: { id } } })),
  });
}

export function useTransitionHistory(id: string) {
  return useQuery<TaskTransition[], ApiError>({
    queryKey: keys.transitions(id),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}/transitions", { params: { path: { id } } })),
  });
}

// The server returns the full detail after every change of a task: store it
// and let the lists and the per-task histories refetch.
function useTaskChanged(id: string) {
  const qc = useQueryClient();
  return (detail: TaskDetail) => {
    qc.setQueryData(keys.task(id), detail);
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: keys.transitions(id) });
  };
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation<TaskDetail, ApiError, CreateTask>({
    mutationFn: async (body) => unwrap(await api.POST("/tasks", { body, headers: idempotencyKey() })),
    onSuccess: (detail) => {
      qc.setQueryData(keys.task(detail.id), detail);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// Optimistic concurrency: the body carries the version the form was built
// from; a 409 means someone else saved in between.
export function useUpdateTask(id: string) {
  const done = useTaskChanged(id);
  return useMutation<TaskDetail, ApiError, UpdateTask>({
    mutationFn: async (body) => unwrap(await api.PATCH("/tasks/{id}", { params: { path: { id } }, body })),
    onSuccess: done,
  });
}

// A new version may move the task back (an approval no longer covers it), so
// the detail is refetched rather than patched locally.
export function useAddVersion(id: string) {
  const qc = useQueryClient();
  return useMutation<ContentVersion, ApiError, CreateContentVersion>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/versions", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.task(id) });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation<Comment, ApiError, CreateComment>({
    mutationFn: async (body) => unwrap(await api.POST("/tasks/{id}/comments", { params: { path: { id } }, body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.comments(id) }),
  });
}

export function useTransition(id: string) {
  const done = useTaskChanged(id);
  return useMutation<TaskDetail, ApiError, RequestTransition>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/transitions", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: done,
  });
}

export function useDecide(id: string) {
  const done = useTaskChanged(id);
  return useMutation<TaskDetail, ApiError, DecideApproval>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/approvals", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: done,
  });
}

// --- Dossier: sources and assistant -----------------------------------------

export const dossierKeys = {
  sources: (id: string) => ["task", id, "sources"] as const,
  interactions: (id: string) => ["task", id, "assistant"] as const,
};

export function useSources(id: string) {
  return useQuery<TaskSource[], ApiError>({
    queryKey: dossierKeys.sources(id),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}/sources", { params: { path: { id } } })),
  });
}

export function useAddSource(id: string) {
  const qc = useQueryClient();
  return useMutation<TaskSource, ApiError, CreateTaskSource>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/sources", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dossierKeys.sources(id) }),
  });
}

export function useRemoveSource(id: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (sourceId) => {
      unwrap(await api.DELETE("/tasks/{id}/sources/{sourceId}", { params: { path: { id, sourceId } } }));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: dossierKeys.sources(id) }),
  });
}

export function useInteractions(id: string) {
  return useQuery<AiInteraction[], ApiError>({
    queryKey: dossierKeys.interactions(id),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}/assistant", { params: { path: { id } } })),
  });
}

// A run only produces a proposal: nothing on the task changes until it is
// accepted, so only the interaction list is refreshed.
export function useAssist(id: string) {
  const qc = useQueryClient();
  return useMutation<AiInteraction, ApiError, AssistRequest>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/assistant", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dossierKeys.interactions(id) }),
  });
}

// Accepting goes through the same rules as a hand-written version: the task
// may move back, so the detail is refetched rather than patched.
export function useAcceptInteraction(id: string) {
  const qc = useQueryClient();
  return useMutation<ContentVersion, ApiError, string>({
    mutationFn: async (interactionId) =>
      unwrap(
        await api.POST("/tasks/{id}/assistant/{interactionId}/accept", {
          params: { path: { id, interactionId } },
          headers: idempotencyKey(),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dossierKeys.interactions(id) });
      void qc.invalidateQueries({ queryKey: keys.task(id) });
      void qc.invalidateQueries({ queryKey: keys.versions(id) });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDismissInteraction(id: string) {
  const qc = useQueryClient();
  return useMutation<AiInteraction, ApiError, string>({
    mutationFn: async (interactionId) =>
      unwrap(await api.POST("/tasks/{id}/assistant/{interactionId}/dismiss", { params: { path: { id, interactionId } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dossierKeys.interactions(id) }),
  });
}

// ---------------------------------------------------------------------------
// Imports (CMS + radar)
// ---------------------------------------------------------------------------

export type ImportFilters = { origin?: ImportItem["origin"]; status?: ImportItem["status"] };
export const importKeys = {
  all: ["imports"] as const,
  list: (f: ImportFilters) => ["imports", f.origin ?? "all", f.status ?? "all"] as const,
};

export function useImports(filters: ImportFilters) {
  return useQuery<ImportItem[], ApiError>({
    queryKey: importKeys.list(filters),
    queryFn: async () => unwrap(await api.GET("/imports", { params: { query: filters } })),
  });
}

export function useSyncImports() {
  const qc = useQueryClient();
  return useMutation<SyncReport, ApiError, SyncImports>({
    mutationFn: async (body) => unwrap(await api.POST("/imports/sync", { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

export function useLinkImport() {
  const qc = useQueryClient();
  return useMutation<ImportItem, ApiError, { id: string; body: LinkImport }>({
    mutationFn: async ({ id, body }) => unwrap(await api.POST("/imports/{id}/task", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: importKeys.all });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useIgnoreImport() {
  const qc = useQueryClient();
  return useMutation<ImportItem, ApiError, string>({
    mutationFn: async (id) => unwrap(await api.POST("/imports/{id}/ignore", { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: importKeys.all }),
  });
}

// Visuals: formats are global, kits belong to a product, renders to a task.
export const visualKeys = {
  formats: ["visual-formats"] as const,
  kits: (productId: string) => ["brand-kits", productId] as const,
  visuals: (taskId: string) => ["task", taskId, "visuals"] as const,
  blob: (path: string) => ["blob", path] as const,
};

export function useVisualFormats() {
  return useQuery<VisualFormat[], ApiError>({
    queryKey: visualKeys.formats,
    queryFn: async () => unwrap(await api.GET("/visual-formats")),
    staleTime: 5 * 60_000,
  });
}

export function useBrandKits(productId: string) {
  return useQuery<BrandKit[], ApiError>({
    queryKey: visualKeys.kits(productId),
    queryFn: async () => unwrap(await api.GET("/products/{productId}/brand-kits", { params: { path: { productId } } })),
  });
}

export function useCreateBrandKit(productId: string) {
  const qc = useQueryClient();
  return useMutation<BrandKit, ApiError, CreateBrandKit>({
    mutationFn: async (body) => unwrap(await api.POST("/products/{productId}/brand-kits", { params: { path: { productId } }, body, headers: idempotencyKey() })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: visualKeys.kits(productId) }),
  });
}

export function useApproveBrandKit(productId: string) {
  const qc = useQueryClient();
  return useMutation<BrandKit, ApiError, string>({
    mutationFn: async (id) => unwrap(await api.POST("/brand-kits/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: visualKeys.kits(productId) }),
  });
}

export function useTaskVisuals(taskId: string) {
  return useQuery<VisualAsset[], ApiError>({
    queryKey: visualKeys.visuals(taskId),
    queryFn: async () => unwrap(await api.GET("/tasks/{id}/visuals", { params: { path: { id: taskId } } })),
  });
}

export function useRenderVisual(taskId: string) {
  const qc = useQueryClient();
  return useMutation<VisualAsset, ApiError, RenderVisual>({
    mutationFn: async (body) => unwrap(await api.POST("/tasks/{id}/visuals", { params: { path: { id: taskId } }, body, headers: idempotencyKey() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: visualKeys.visuals(taskId) });
      void qc.invalidateQueries({ queryKey: keys.task(taskId) }); // a render may send the task back
    },
  });
}

export function useDiscardVisual(taskId: string) {
  const qc = useQueryClient();
  return useMutation<VisualAsset, ApiError, string>({
    mutationFn: async (visualId) => unwrap(await api.DELETE("/tasks/{id}/visuals/{visualId}", { params: { path: { id: taskId, visualId } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: visualKeys.visuals(taskId) });
      void qc.invalidateQueries({ queryKey: keys.task(taskId) });
    },
  });
}

// Images served behind the session cookie: fetched with credentials and
// shown through an object URL, so <img> never needs cross-origin cookies.
// Content-addressed files never change: cache them for the session.
export function useBlobUrl(path: string | null) {
  const query = useQuery<string, ApiError>({
    queryKey: visualKeys.blob(path ?? ""),
    enabled: path !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
      if (!res.ok) throw new ApiError(res.status, null);
      return URL.createObjectURL(await res.blob());
    },
  });
  const url = query.data;
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return query;
}
