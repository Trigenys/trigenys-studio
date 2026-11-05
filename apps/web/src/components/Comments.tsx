import type { Me } from "@trigenys/studio-contracts";
import { useState } from "react";
import { useAddComment, useComments } from "../api/queries";
import { ErrorState, Loading } from "./States";
import { dateFmt } from "./dates";

export function Comments({ taskId, me }: { taskId: string; me: Me }) {
  const comments = useComments(taskId);
  const add = useAddComment(taskId);
  const [body, setBody] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate({ body: body.trim() }, { onSuccess: () => setBody("") });
  };

  return (
    <div className="stack">
      {comments.isPending ? <Loading label="Chargement des commentaires…" /> : null}
      {comments.isError ? <ErrorState error={comments.error} retry={() => void comments.refetch()} /> : null}
      {comments.data && comments.data.length === 0 ? <p className="muted">Aucun commentaire.</p> : null}
      {comments.data && comments.data.length > 0 ? (
        <ul className="comments" aria-label="Commentaires">
          {comments.data.map((c) => (
            <li key={c.id}>
              <p className="muted">
                <strong>{c.authorId === me.userId ? "Vous" : (c.authorId ?? "Système")}</strong> · {dateFmt.format(new Date(c.createdAt))}
              </p>
              <p className="prose">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="stack" onSubmit={submit} aria-busy={add.isPending}>
        {add.isError ? <ErrorState error={add.error} /> : null}
        <label htmlFor="new-comment">Votre commentaire</label>
        <textarea id="new-comment" rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} required />
        <div className="actions">
          <button type="submit" className="btn" disabled={add.isPending || body.trim() === ""}>
            Commenter
          </button>
        </div>
      </form>
    </div>
  );
}
