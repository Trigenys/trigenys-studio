import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DecideApproval, Me, Product, RequestTransition, Task, TaskDetail } from "@trigenys/studio-contracts";
import { ApiError, api, idempotencyKey, unwrap } from "./client";

export const keys = {
  me: ["me"] as const,
  products: ["products"] as const,
  tasks: (productId: string | null) => ["tasks", productId ?? "all"] as const,
  task: (id: string) => ["task", id] as const,
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

function useInvalidateTask(id: string) {
  const qc = useQueryClient();
  return (detail: TaskDetail) => {
    qc.setQueryData(keys.task(id), detail);
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useTransition(id: string) {
  const done = useInvalidateTask(id);
  return useMutation<TaskDetail, ApiError, RequestTransition>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/transitions", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: done,
  });
}

export function useDecide(id: string) {
  const done = useInvalidateTask(id);
  return useMutation<TaskDetail, ApiError, DecideApproval>({
    mutationFn: async (body) =>
      unwrap(await api.POST("/tasks/{id}/approvals", { params: { path: { id } }, body, headers: idempotencyKey() })),
    onSuccess: done,
  });
}
