import { useState } from "react";
import { useAddSource, useRemoveSource, useSources } from "../api/queries";
import { ErrorState, Loading } from "./States";

// The sources a text is written from: what the assistant is allowed to use
// and what a reviewer can check. Writers add and remove, everyone reads.
export function Dossier({ taskId, writer }: { taskId: string; writer: boolean }) {
  const sources = useSources(taskId);
  const add = useAddSource(taskId);
  const remove = useRemoveSource(taskId);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate(
      { origin: "manual", title: title.trim(), url: url.trim() || null, note: note.trim() },
      {
        onSuccess: () => {
          setTitle("");
          setUrl("");
          setNote("");
        },
      },
    );
  };

  return (
    <div className="stack">
      {sources.isPending ? <Loading label="Chargement des sources…" /> : null}
      {sources.isError ? <ErrorState error={sources.error} retry={() => void sources.refetch()} /> : null}
      {sources.data && sources.data.length === 0 ? <p className="muted">Aucune source.</p> : null}
      {sources.data && sources.data.length > 0 ? (
        <ul className="sources" aria-label="Sources">
          {sources.data.map((s) => (
            <li key={s.id}>
              <p>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                ) : (
                  <strong>{s.title}</strong>
                )}
                <span className="muted"> · {s.origin}</span>
              </p>
              {s.note ? <p className="prose">{s.note}</p> : null}
              {writer ? (
                <button type="button" className="btn btn-ghost" disabled={remove.isPending} onClick={() => remove.mutate(s.id)} aria-label={`Retirer ${s.title}`}>
                  Retirer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {remove.isError ? <ErrorState error={remove.error} /> : null}
      {writer ? (
        <form className="stack" onSubmit={submit} aria-busy={add.isPending} aria-labelledby="source-form-title">
          <h3 id="source-form-title">Ajouter une source</h3>
          {add.isError ? <ErrorState error={add.error} /> : null}
          <div className="form-row">
            <div className="stack">
              <label htmlFor="source-title">Nom de la source</label>
              <input id="source-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
            </div>
            <div className="stack">
              <label htmlFor="source-url">Lien (facultatif)</label>
              <input id="source-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </div>
          </div>
          <label htmlFor="source-note">Note (facultatif)</label>
          <textarea id="source-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
          <div className="actions">
            <button type="submit" className="btn" disabled={add.isPending || title.trim() === ""}>
              Ajouter la source
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
