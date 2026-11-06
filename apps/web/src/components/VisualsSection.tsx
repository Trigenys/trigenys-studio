import type { VisualAsset } from "@trigenys/studio-contracts";
import { useState } from "react";
import { useBlobUrl, useDiscardVisual, useRenderVisual, useTaskVisuals, useVisualFormats } from "../api/queries";
import { ErrorState, Loading } from "./States";

// Visuals rendered server-side from the product's approved brand kit. Each
// render is content-addressed; discarding is logical. The server is the
// authority on frozen states and on the approval binding: a render or a
// discard after approval sends the task back, which the page reloads.

export function VisualsSection({ taskId, taskTitle, writer }: { taskId: string; taskTitle: string; writer: boolean }) {
  const visuals = useTaskVisuals(taskId);
  const formats = useVisualFormats();
  const render = useRenderVisual(taskId);
  const discard = useDiscardVisual(taskId);
  const [formatId, setFormatId] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const chosen = formatId || formats.data?.[0]?.id || "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    render.mutate({ formatId: chosen, subtitle: subtitle.trim(), brief: "" });
  };

  return (
    <div className="stack">
      {visuals.isPending ? <Loading label="Chargement des visuels…" /> : null}
      {visuals.isError ? <ErrorState error={visuals.error} retry={() => void visuals.refetch()} /> : null}
      {visuals.data && visuals.data.length === 0 ? <p className="muted">Aucun visuel rendu.</p> : null}
      {visuals.data && visuals.data.length > 0 ? (
        <ul className="visual-grid" aria-label="Visuels">
          {visuals.data.map((v) => (
            <VisualCard key={v.id} visual={v} writer={writer} discard={() => discard.mutate(v.id)} busy={discard.isPending} />
          ))}
        </ul>
      ) : null}
      {discard.isError ? <ErrorState error={discard.error} /> : null}
      {writer ? (
        <form className="stack" onSubmit={submit} aria-busy={render.isPending} aria-labelledby="render-form-title">
          <h3 id="render-form-title">Rendre un visuel</h3>
          <p className="muted">Titre : {taskTitle}. Le logo et les couleurs viennent du kit de marque approuvé du produit.</p>
          {render.isError ? <ErrorState error={render.error} /> : null}
          {formats.isError ? <ErrorState error={formats.error} /> : null}
          <div className="form-row">
            <div className="stack">
              <label htmlFor="visual-format">Format</label>
              <select id="visual-format" value={chosen} onChange={(e) => setFormatId(e.target.value)} disabled={!formats.data}>
                {(formats.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} · {f.width}×{f.height}
                  </option>
                ))}
              </select>
            </div>
            <div className="stack">
              <label htmlFor="visual-subtitle">Accroche (facultatif)</label>
              <input id="visual-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} />
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn" disabled={render.isPending || !chosen}>
              {render.isPending ? "Rendu…" : "Rendre le visuel"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function VisualCard({ visual, writer, discard, busy }: { visual: VisualAsset; writer: boolean; discard: () => void; busy: boolean }) {
  const blob = useBlobUrl(`/visuals/${visual.id}/file`);
  const name = `${visual.formatId} · variante ${visual.variant}`;
  return (
    <li className="visual-card">
      <figure>
        {blob.data ? (
          <img src={blob.data} alt={`${visual.title}${visual.subtitle ? `, ${visual.subtitle}` : ""}`} width={visual.width} height={visual.height} />
        ) : (
          <div className="visual-placeholder" style={{ aspectRatio: `${visual.width} / ${visual.height}` }} aria-hidden="true" />
        )}
        <figcaption className="muted">
          {name} · {visual.width}×{visual.height}
        </figcaption>
      </figure>
      {writer ? (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={discard} aria-label={`Écarter ${name}`}>
          Écarter
        </button>
      ) : null}
    </li>
  );
}
