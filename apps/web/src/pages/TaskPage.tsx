import type { Me, Task } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useDecide, useTask, useTransition, useTransitionHistory } from "../api/queries";
import { Assistant } from "../components/Assistant";
import { Comments } from "../components/Comments";
import { Dossier } from "../components/Dossier";
import { ErrorState, Loading } from "../components/States";
import { TaskEditForm } from "../components/TaskEditForm";
import { VersionForm, VersionHistory } from "../components/VersionEditor";
import { dateFmt } from "../components/dates";
import { FROZEN_STATES, STATE_LABELS, canReview, canWrite } from "../views";

// Sending a task back deserves a reason; the other moves are self-explanatory.
const REASONED: ReadonlySet<Task["state"]> = new Set(["needs_fix", "failed"]);

export function TaskPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const task = useTask(id);
  const transition = useTransition(id);
  const decide = useDecide(id);
  const [comment, setComment] = useState("");
  const [pendingTo, setPendingTo] = useState<Task["state"] | null>(null);
  const [reason, setReason] = useState("");

  if (task.isPending) return <Loading label="Chargement de la tâche…" />;
  if (task.isError) return <ErrorState error={task.error} retry={() => void task.refetch()} />;
  const t = task.data;
  const busy = transition.isPending || decide.isPending;
  const actionError = transition.error ?? decide.error;
  const writer = canWrite(me, t.productId);
  const reviewable = t.state === "awaiting_approval" && canReview(me, t.productId);
  const isAuthor = t.latestVersion?.authorId === me.userId;
  const frozen = FROZEN_STATES.has(t.state);

  const move = (to: Task["state"]) => {
    if (REASONED.has(to) && pendingTo !== to) {
      setPendingTo(to);
      return;
    }
    transition.mutate(
      { to, reason: reason.trim() || null },
      {
        onSuccess: () => {
          setPendingTo(null);
          setReason("");
        },
      },
    );
  };

  return (
    <article className="task-page" aria-labelledby="task-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <header className="task-header">
        <p className="eyebrow">
          {t.productId} · {t.type}
        </p>
        <h1 id="task-title">{t.title}</h1>
        <p className="task-meta">
          <span className={`chip chip-state state-${t.state}`}>{STATE_LABELS[t.state]}</span>
          {t.dueAt ? <time dateTime={t.dueAt}>Échéance {dateFmt.format(new Date(t.dueAt))}</time> : <span>Sans échéance</span>}
          <span>Priorité {t.priority}</span>
          {t.assigneeId === me.userId ? <span>Assignée à vous</span> : null}
        </p>
        {writer ? (
          <details className="card card-details">
            <summary>Modifier la tâche</summary>
            <TaskEditForm task={t} me={me} reload={() => void task.refetch()} />
          </details>
        ) : null}
      </header>

      {t.brief ? (
        <section aria-labelledby="brief-title" className="card">
          <h2 id="brief-title">Brief</h2>
          <p className="prose">{t.brief}</p>
        </section>
      ) : null}

      <section aria-labelledby="content-title" className="card">
        <h2 id="content-title">Contenu</h2>
        {t.latestVersion ? (
          <>
            <p className="muted">
              Version {t.latestVersion.n} · {t.latestVersion.channel}
              {t.latestVersion.aiAssisted ? " · assistée" : ""} · {dateFmt.format(new Date(t.latestVersion.createdAt))}
            </p>
            <pre className="prose">{t.latestVersion.body}</pre>
          </>
        ) : (
          <p className="muted">Aucune version rédigée.</p>
        )}
        {t.latestApproval ? (
          <p className="muted" data-testid="approval">
            Dernière décision : {t.latestApproval.decision === "approved" ? "approuvée" : "rejetée"}
            {t.latestApproval.comment ? ` (« ${t.latestApproval.comment} »)` : ""} ·{" "}
            {t.approvalValid ? "valable pour cette version" : "ne couvre plus cette version"}
          </p>
        ) : null}
        {writer && frozen ? <p className="muted">Contenu gelé dans cet état : aucune nouvelle version possible.</p> : null}
        {writer && !frozen ? <VersionForm taskId={t.id} lastChannel={t.latestVersion?.channel ?? null} /> : null}
        {t.latestVersion && t.latestVersion.n > 1 ? (
          <Collapsible summary="Versions précédentes">
            <VersionHistory taskId={t.id} />
          </Collapsible>
        ) : null}
      </section>

      <section aria-labelledby="dossier-title" className="card">
        <h2 id="dossier-title">Dossier</h2>
        <Dossier taskId={t.id} writer={writer && !frozen} />
      </section>

      <section aria-labelledby="assistant-title" className="card">
        <h2 id="assistant-title">Assistant</h2>
        <Assistant taskId={t.id} latestVersion={t.latestVersion} writer={writer} frozen={frozen} />
      </section>

      <section aria-labelledby="comments-title" className="card">
        <h2 id="comments-title">Commentaires</h2>
        <Comments taskId={t.id} me={me} />
      </section>

      <section aria-labelledby="actions-title" className="card">
        <h2 id="actions-title">Actions</h2>
        {actionError ? <ErrorState error={actionError} /> : null}
        {reviewable ? (
          <div className="stack">
            {isAuthor ? <p className="muted">Vous avez rédigé cette version : la décision revient à une autre personne.</p> : null}
            <label htmlFor="approval-comment">Commentaire (facultatif)</label>
            <textarea id="approval-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} />
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || isAuthor}
                onClick={() => decide.mutate({ decision: "approved", comment: comment || null })}
              >
                Approuver
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || isAuthor}
                onClick={() => decide.mutate({ decision: "rejected", comment: comment || null })}
              >
                Rejeter
              </button>
            </div>
          </div>
        ) : null}
        {t.allowedTransitions.length > 0 ? (
          <div className="stack">
            <div className="actions" aria-label="Transitions">
              {t.allowedTransitions.map((to) => (
                <button key={to} type="button" className="btn" disabled={busy} aria-pressed={pendingTo === to} onClick={() => move(to)}>
                  → {STATE_LABELS[to]}
                </button>
              ))}
            </div>
            {pendingTo ? (
              <div className="stack">
                <label htmlFor="reason">
                  Motif pour « {STATE_LABELS[pendingTo]} » (facultatif)
                </label>
                <textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} disabled={busy} />
                <div className="actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => move(pendingTo)}>
                    Confirmer
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPendingTo(null)}>
                    Annuler
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          !reviewable && <p className="muted">Aucune action disponible pour votre rôle dans cet état.</p>
        )}
      </section>

      <Collapsible summary="Historique des transitions" className="card card-details">
        <TransitionHistory taskId={t.id} />
      </Collapsible>
    </article>
  );
}

// Histories are fetched only once opened: nothing is loaded for a fold the
// reader never expands.
function Collapsible({ summary, className = "card-details", children }: { summary: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open ? children : null}
    </details>
  );
}

function TransitionHistory({ taskId }: { taskId: string }) {
  const history = useTransitionHistory(taskId);
  if (history.isPending) return <Loading label="Chargement de l'historique…" />;
  if (history.isError) return <ErrorState error={history.error} retry={() => void history.refetch()} />;
  if (history.data.length === 0) return <p className="muted">Aucune transition.</p>;
  return (
    <ol className="timeline" reversed>
      {[...history.data].reverse().map((h) => (
        <li key={h.id}>
          <p>
            {STATE_LABELS[h.fromState]} → <strong>{STATE_LABELS[h.toState]}</strong>
            <span className="muted"> · {dateFmt.format(new Date(h.createdAt))}</span>
          </p>
          {h.reason ? <p className="prose">{h.reason}</p> : null}
        </li>
      ))}
    </ol>
  );
}
