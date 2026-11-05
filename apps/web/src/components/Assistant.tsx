import type { AiInteraction, AssistRequest, ContentVersion } from "@trigenys/studio-contracts";
import { useState } from "react";
import { useAcceptInteraction, useAssist, useDismissInteraction, useInteractions } from "../api/queries";
import { diffLines } from "../diff";
import { CHANNELS } from "../views";
import { ErrorState, Loading } from "./States";
import { dateFmt } from "./dates";

type Action = AssistRequest["action"];

const ACTION_LABELS: Record<Action, string> = {
  propose: "Proposer un texte",
  fix: "Corriger la version",
  summarize: "Synthétiser",
  adapt: "Décliner sur un canal",
};
const STATUS_LABELS: Record<AiInteraction["status"], string> = {
  proposed: "à décider",
  accepted: "acceptée",
  dismissed: "écartée",
};
// Everything but "propose" works from the current version.
const NEEDS_VERSION: ReadonlySet<Action> = new Set(["fix", "summarize", "adapt"]);

// The assistant only ever produces proposals. A proposal becomes content
// through "Accepter", which creates a new version with the same rules as a
// hand-written one; the approved text is never edited in place.
export function Assistant({ taskId, latestVersion, writer, frozen }: { taskId: string; latestVersion: ContentVersion | null; writer: boolean; frozen: boolean }) {
  const interactions = useInteractions(taskId);
  const assist = useAssist(taskId);
  const accept = useAcceptInteraction(taskId);
  const dismiss = useDismissInteraction(taskId);
  const [action, setAction] = useState<Action>(latestVersion ? "fix" : "propose");
  const [channel, setChannel] = useState<string>(latestVersion?.channel ?? CHANNELS[0]);
  const [instruction, setInstruction] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const canRun = writer && !frozen;
  const missingVersion = NEEDS_VERSION.has(action) && !latestVersion;
  const busy = assist.isPending || accept.isPending || dismiss.isPending;
  const decisionError = accept.error ?? dismiss.error;

  const run = (e: React.FormEvent) => {
    e.preventDefault();
    assist.mutate(
      { action, channel, instruction: instruction.trim() },
      {
        onSuccess: (i) => {
          setInstruction("");
          setOpen(i.id);
        },
      },
    );
  };

  return (
    <div className="stack">
      {canRun ? (
        <form className="stack" onSubmit={run} aria-busy={assist.isPending} aria-labelledby="assist-form-title">
          <h3 id="assist-form-title">Demander une proposition</h3>
          {assist.isError ? <ErrorState error={assist.error} /> : null}
          <div className="form-row">
            <div className="stack">
              <label htmlFor="assist-action">Intervention</label>
              <select id="assist-action" value={action} onChange={(e) => setAction(e.target.value as Action)}>
                {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </div>
            <div className="stack">
              <label htmlFor="assist-channel">Destination</label>
              <select id="assist-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor="assist-instruction">Précision (facultatif)</label>
          <textarea id="assist-instruction" rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={2000} />
          {missingVersion ? <p className="muted">Cette action part de la version actuelle : rédigez-en une d'abord.</p> : null}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || missingVersion}>
              Lancer
            </button>
          </div>
        </form>
      ) : null}
      {frozen ? <p className="muted">Contenu gelé dans cet état : l'assistant est en lecture seule.</p> : null}

      {interactions.isPending ? <Loading label="Chargement des propositions…" /> : null}
      {interactions.isError ? <ErrorState error={interactions.error} retry={() => void interactions.refetch()} /> : null}
      {interactions.data && interactions.data.length === 0 ? <p className="muted">Aucune proposition.</p> : null}
      {decisionError ? <ErrorState error={decisionError} /> : null}
      {interactions.data && interactions.data.length > 0 ? (
        <ol className="proposals" aria-label="Propositions">
          {interactions.data.map((i) => {
            const expanded = open === i.id;
            return (
              <li key={i.id} data-status={i.status}>
                <p>
                  <strong>{ACTION_LABELS[i.action]}</strong> · {i.channel}
                  <span className="muted">
                    {" "}
                    · {STATUS_LABELS[i.status]} · {i.model} · {dateFmt.format(new Date(i.createdAt))}
                  </span>
                </p>
                {i.instruction ? <p className="muted">« {i.instruction} »</p> : null}
                <button type="button" className="btn btn-ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i.id)}>
                  {expanded ? "Masquer" : "Voir la proposition"}
                </button>
                {expanded ? <Proposal interaction={i} latestVersion={latestVersion} /> : null}
                {expanded && i.status === "proposed" && canRun ? (
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => accept.mutate(i.id)}>
                      Accepter comme nouvelle version
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => dismiss.mutate(i.id)}>
                      Écarter
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

// The diff is against the version the reader currently sees, so the choice
// is made on what would actually change.
function Proposal({ interaction, latestVersion }: { interaction: AiInteraction; latestVersion: ContentVersion | null }) {
  const base = latestVersion?.body ?? "";
  const lines = diffLines(base, interaction.output);
  if (lines.every((l) => l.kind === "same")) return <p className="muted">Identique à la version actuelle.</p>;
  return (
    <pre className="diff" aria-label="Différences avec la version actuelle">
      {lines.map((l, k) => (
        <span key={k} className={`diff-${l.kind}`}>
          {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
          {l.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
