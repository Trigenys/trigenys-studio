import type { Me } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCreateTask, useProducts } from "../api/queries";
import { ErrorState, Loading } from "../components/States";
import { fromLocalInput } from "../components/dates";
import { TASK_TYPES, canWrite } from "../views";

// Creating a task: product, type and title are enough; the rest can be
// filled later from the task page. The task starts in the pipeline's
// initial state, chosen by the server.
export function NewTaskPage({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const products = useProducts();
  const create = useCreateTask();
  const writable = (products.data ?? []).filter((p) => canWrite(me, p.id));
  const [productId, setProductId] = useState(params.get("product") ?? "");
  const [assignMe, setAssignMe] = useState(true);

  if (products.isPending) return <Loading label="Chargement des produits…" />;
  if (products.isError) return <ErrorState error={products.error} retry={() => void products.refetch()} />;
  const selected = writable.some((p) => p.id === productId) ? productId : (writable[0]?.id ?? "");

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate(
      {
        productId: String(f.get("productId")),
        type: String(f.get("type")).trim() || "post",
        title: String(f.get("title")).trim(),
        brief: String(f.get("brief")).trim(),
        priority: Number(f.get("priority") ?? 0),
        dueAt: fromLocalInput(String(f.get("dueAt") ?? "")),
        assigneeId: assignMe ? me.userId : null,
      },
      { onSuccess: (t) => navigate(`/tasks/${t.id}`) },
    );
  };

  return (
    <article className="task-page" aria-labelledby="new-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <h1 id="new-title" className="page-title">
        Nouvelle tâche
      </h1>
      {writable.length === 0 ? (
        <p className="state state-empty" role="status">
          Votre rôle ne permet pas de créer des tâches.
        </p>
      ) : (
        <form className="card stack" onSubmit={submit} aria-busy={create.isPending}>
          {create.isError ? <ErrorState error={create.error} /> : null}
          <div className="form-row">
            <div className="stack">
              <label htmlFor="productId">Produit</label>
              <select id="productId" name="productId" value={selected} onChange={(e) => setProductId(e.target.value)} required>
                {writable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="stack">
              <label htmlFor="type">Type</label>
              <input id="type" name="type" list="task-types" defaultValue="post" maxLength={40} required />
              <datalist id="task-types">
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>
          <label htmlFor="title">Titre</label>
          <input id="title" name="title" maxLength={200} required autoFocus />
          <label htmlFor="brief">Brief</label>
          <textarea id="brief" name="brief" rows={4} maxLength={20000} placeholder="Objectif, angle, sources…" />
          <div className="form-row">
            <div className="stack">
              <label htmlFor="dueAt">Échéance</label>
              <input id="dueAt" name="dueAt" type="datetime-local" />
            </div>
            <div className="stack">
              <label htmlFor="priority">Priorité (0 à 3)</label>
              <input id="priority" name="priority" type="number" min={0} max={3} defaultValue={0} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} /> Me l'assigner
          </label>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? "Création…" : "Créer la tâche"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
