import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Comment,
  ContentVersion,
  CreateComment,
  CreateContentVersion,
  CreateTask,
  DecideApproval,
  Me,
  Product,
  RequestTransition,
  Task,
  TaskDetail,
  TaskTransition,
  UpdateTask,
} from "@trigenys/studio-contracts";
import { ApiError, api, idempotencyKey, unwrap } from "./client";

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
