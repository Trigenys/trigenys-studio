import type { ContentVersion } from "@trigenys/studio-contracts";
import { useState } from "react";
import { useAddVersion, useVersions } from "../api/queries";
import { CHANNELS } from "../views";
import { ErrorState, Loading } from "./States";
import { dateFmt } from "./dates";

// A new version never edits the previous one: content is append-only and
// each version is what an approval binds to.
export function VersionForm({ taskId, lastChannel }: { taskId: string; lastChannel: string | null }) {
  const add = useAddVersion(taskId);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState<ContentVersion | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    add.mutate(
      { channel: String(f.get("channel")), body, aiAssisted: f.get("aiAssisted") === "on" },
      {
        onSuccess: (v) => {
          setSaved(v);
          setBody("");
        },
      },
    );
  };

  return (
    <form className="stack" onSubmit={submit} aria-busy={add.isPending} aria-labelledby="version-form-title">
      <h3 id="version-form-title">Nouvelle version</h3>
      {add.isError ? <ErrorState error={add.error} /> : null}
      <div className="form-row">
        <div className="stack">
          <label htmlFor="channel">Canal</label>
          <select id="channel" name="channel" defaultValue={lastChannel ?? CHANNELS[0]}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" name="aiAssisted" /> Rédigée avec assistance
        </label>
      </div>
      <label htmlFor="body">Texte</label>
      <textarea id="body" name="body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={100000} required />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={add.isPending || body.trim() === ""}>
          Enregistrer la version
        </button>
        <span role="status" aria-live="polite" className="muted">
          {saved ? `Version ${saved.n} enregistrée.` : ""}
        </span>
      </div>
    </form>
  );
}

export function VersionHistory({ taskId }: { taskId: string }) {
  const versions = useVersions(taskId);
  if (versions.isPending) return <Loading label="Chargement des versions…" />;
  if (versions.isError) return <ErrorState error={versions.error} retry={() => void versions.refetch()} />;
  if (versions.data.length === 0) return <p className="muted">Aucune version.</p>;
  return (
    <ol className="timeline" reversed>
      {[...versions.data].reverse().map((v) => (
        <li key={v.id}>
          <p className="muted">
            Version {v.n} · {v.channel}
            {v.aiAssisted ? " · assistée" : ""} · {dateFmt.format(new Date(v.createdAt))}
          </p>
          <pre className="prose">{v.body}</pre>
        </li>
      ))}
    </ol>
  );
}
