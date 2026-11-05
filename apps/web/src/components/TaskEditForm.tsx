import type { Me, TaskDetail } from "@trigenys/studio-contracts";
import { useState } from "react";
import { useUpdateTask } from "../api/queries";
import { TASK_TYPES } from "../views";
import { ErrorState } from "./States";
import { fromLocalInput, toLocalInput } from "./dates";

// Metadata edits carry the version the form was built from; on a 409 the
// user reloads the task and the form is rebuilt (keyed on the version).
export function TaskEditForm({ task, me, reload }: { task: TaskDetail; me: Me; reload: () => void }) {
  const update = useUpdateTask(task.id);
  const [assignMe, setAssignMe] = useState(task.assigneeId === me.userId);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    update.mutate({
      version: task.version,
      type: String(f.get("type")).trim() || task.type,
      title: String(f.get("title")).trim() || task.title,
      brief: String(f.get("brief")),
      priority: Number(f.get("priority") ?? task.priority),
      dueAt: fromLocalInput(String(f.get("dueAt") ?? "")),
      assigneeId: assignMe ? me.userId : null,
    });
  };

  return (
    <form key={task.version} className="stack" onSubmit={submit} aria-busy={update.isPending}>
      {update.isError ? (
        <ErrorState error={update.error} retry={update.error.status === 409 ? reload : undefined} retryLabel="Recharger" />
      ) : null}
      <div className="form-row">
        <div className="stack">
          <label htmlFor="edit-title">Titre</label>
          <input id="edit-title" name="title" defaultValue={task.title} maxLength={200} required />
        </div>
        <div className="stack">
          <label htmlFor="edit-type">Type</label>
          <input id="edit-type" name="type" list="task-types" defaultValue={task.type} maxLength={40} required />
          <datalist id="task-types">
            {TASK_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>
      <label htmlFor="edit-brief">Brief</label>
      <textarea id="edit-brief" name="brief" rows={4} defaultValue={task.brief} maxLength={20000} />
      <div className="form-row">
        <div className="stack">
          <label htmlFor="edit-dueAt">Échéance</label>
          <input id="edit-dueAt" name="dueAt" type="datetime-local" defaultValue={toLocalInput(task.dueAt)} />
        </div>
        <div className="stack">
          <label htmlFor="edit-priority">Priorité (0 à 3)</label>
          <input id="edit-priority" name="priority" type="number" min={0} max={3} defaultValue={task.priority} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} /> Me l'assigner
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>
          Enregistrer
        </button>
        {update.isSuccess ? (
          <span role="status" className="muted">
            Modifications enregistrées.
          </span>
        ) : null}
      </div>
    </form>
  );
}
