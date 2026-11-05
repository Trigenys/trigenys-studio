import type { Me } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useDecide, useTask, useTransition } from "../api/queries";
import { ErrorState, Loading } from "../components/States";
import { STATE_LABELS } from "../views";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

const canReview = (me: Me, productId: string) =>
  me.grants.some((g) => (g.role === "admin" || g.role === "reviewer") && (g.productId === null || g.productId === productId));

export function TaskPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const task = useTask(id);
  const transition = useTransition(id);
  const decide = useDecide(id);
  const [comment, setComment] = useState("");

  if (task.isPending) return <Loading label="Chargement de la tâche…" />;
  if (task.isError) return <ErrorState error={task.error} retry={() => void task.refetch()} />;
  const t = task.data;
  const busy = transition.isPending || decide.isPending;
  const actionError = transition.error ?? decide.error;
  const reviewable = t.state === "awaiting_approval" && canReview(me, t.productId);
  const isAuthor = t.latestVersion?.authorId === me.userId;

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
        </p>
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
      </section>

      <section aria-labelledby="actions-title" className="card">
        <h2 id="actions-title">Actions</h2>
        {actionError ? <ErrorState error={actionError} /> : null}
        {reviewable ? (
          <div className="stack">
            {isAuthor ? <p className="muted">Vous avez rédigé cette version : la décision revient à une autre personne.</p> : null}
            <label htmlFor="comment">Commentaire (facultatif)</label>
            <textarea id="comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} />
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
          <div className="actions" aria-label="Transitions">
            {t.allowedTransitions.map((to) => (
              <button key={to} type="button" className="btn" disabled={busy} onClick={() => transition.mutate({ to, reason: null })}>
                → {STATE_LABELS[to]}
              </button>
            ))}
          </div>
        ) : (
          !reviewable && <p className="muted">Aucune action disponible pour votre rôle dans cet état.</p>
        )}
      </section>
    </article>
  );
}
