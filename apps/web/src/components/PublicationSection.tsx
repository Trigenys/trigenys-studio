import type { Delivery, PublishReadiness, SocialAccount, TaskDetail } from "@trigenys/studio-contracts";
import { useState } from "react";
import {
  useCancelDelivery,
  useCreateDelivery,
  useDeliveries,
  useDeliveryAttempts,
  usePublishReadiness,
  useRetryDelivery,
  useScheduleDelivery,
  useSetPermalink,
  useSocialAccounts,
} from "../api/queries";
import { ErrorState, Loading } from "./States";
import { dateFmt, fromLocalInput, toLocalInput } from "./dates";

// Publication of an approved task: one delivery per social account, handed
// to the provider by the outbox once due. The server is the authority on
// readiness (state, approval, account, permission, window); the form only
// mirrors its verdict so the operator sees why a slot is refused.

export const DELIVERY_LABELS: Record<Delivery["status"], string> = {
  draft: "brouillon",
  scheduled: "programmée",
  sending: "en cours d'envoi",
  handed_off: "transmise",
  sent: "publiée",
  failed: "en échec",
  cancelled: "annulée",
};

const CHECK_LABELS: Record<keyof PublishReadiness["checks"], string> = {
  state: "État de la tâche",
  approval: "Approbation",
  account: "Compte social",
  permission: "Droits",
  window: "Créneau",
};

const PUBLISHABLE: ReadonlySet<TaskDetail["state"]> = new Set(["approved", "scheduled", "failed"]);
const CANCELLABLE: ReadonlySet<Delivery["status"]> = new Set(["draft", "scheduled", "handed_off", "failed"]);
const RESCHEDULABLE: ReadonlySet<Delivery["status"]> = new Set(["draft", "scheduled"]);

export function PublicationSection({ task, writer }: { task: TaskDetail; writer: boolean }) {
  const deliveries = useDeliveries(task.id);
  const channel = task.latestVersion?.channel ?? null;
  return (
    <div className="stack">
      {deliveries.isPending ? <Loading label="Chargement des publications…" /> : null}
      {deliveries.isError ? <ErrorState error={deliveries.error} retry={() => void deliveries.refetch()} /> : null}
      {deliveries.data && deliveries.data.length === 0 ? <p className="muted">Aucune publication planifiée.</p> : null}
      {deliveries.data && deliveries.data.length > 0 ? (
        <ul className="deliveries" aria-label="Publications">
          {deliveries.data.map((d) => (
            <DeliveryRow key={d.id} taskId={task.id} delivery={d} writer={writer} />
          ))}
        </ul>
      ) : null}
      {writer && PUBLISHABLE.has(task.state) ? (
        <PlanForm task={task} channel={channel} />
      ) : writer ? (
        <p className="muted">La planification s'ouvre une fois la tâche approuvée.</p>
      ) : null}
    </div>
  );
}

function PlanForm({ task, channel }: { task: TaskDetail; channel: string | null }) {
  const social = channel && isSocial(channel) ? channel : null;
  const accounts = useSocialAccounts(task.productId, social);
  const create = useCreateDelivery(task.id);
  const [accountId, setAccountId] = useState("");
  const [when, setWhen] = useState("");
  const active = (accounts.data ?? []).filter((a) => a.active);
  const chosen = accountId || active[0]?.id || "";
  const scheduledAt = fromLocalInput(when);
  const readiness = usePublishReadiness(task.id, chosen, scheduledAt);
  const ready = readiness.data?.ready === true;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || !scheduledAt) return;
    create.mutate({ socialAccountId: chosen, scheduledAt }, { onSuccess: () => setWhen("") });
  };

  if (!social) {
    return <p className="muted">La dernière version vise le canal « {channel ?? "aucun"} », qui ne se publie pas via un compte social.</p>;
  }
  return (
    <form className="stack" onSubmit={submit} aria-busy={create.isPending} aria-labelledby="plan-form-title">
      <h3 id="plan-form-title">Planifier une publication</h3>
      {accounts.isError ? <ErrorState error={accounts.error} /> : null}
      {accounts.data && active.length === 0 ? (
        <p className="muted">Aucun compte {social} actif pour ce produit : un administrateur doit d'abord le relier.</p>
      ) : null}
      {create.isError ? <ErrorState error={create.error} /> : null}
      <div className="form-row">
        <div className="stack">
          <label htmlFor="plan-account">Compte social</label>
          <select id="plan-account" value={chosen} onChange={(e) => setAccountId(e.target.value)} disabled={active.length === 0}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.handle} · {a.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="stack">
          <label htmlFor="plan-when">Date de publication</label>
          <input id="plan-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required disabled={active.length === 0} />
        </div>
      </div>
      {readiness.data ? <ReadinessList readiness={readiness.data} /> : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !chosen || !scheduledAt || !ready}>
          Planifier
        </button>
      </div>
    </form>
  );
}

function ReadinessList({ readiness }: { readiness: PublishReadiness }) {
  const entries = Object.entries(readiness.checks) as [keyof PublishReadiness["checks"], { ok: boolean; reason: string }][];
  return (
    <ul className="readiness" aria-label="Conditions de publication">
      {entries.map(([key, check]) => (
        <li key={key} data-ok={check.ok}>
          <span aria-hidden="true">{check.ok ? "✓" : "✗"}</span> {CHECK_LABELS[key]}
          <span className="visually-hidden">{check.ok ? " : ok" : " : bloquant"}</span>
          {!check.ok ? <span className="muted"> : {check.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DeliveryRow({ taskId, delivery: d, writer }: { taskId: string; delivery: Delivery; writer: boolean }) {
  const cancel = useCancelDelivery(taskId);
  const retry = useRetryDelivery(taskId);
  const schedule = useScheduleDelivery(taskId);
  const permalink = useSetPermalink(taskId);
  const [editing, setEditing] = useState<"date" | "link" | null>(null);
  const [when, setWhen] = useState(toLocalInput(d.scheduledAt));
  const [url, setUrl] = useState(d.permalink ?? "");
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  const busy = cancel.isPending || retry.isPending || schedule.isPending || permalink.isPending;
  const error = cancel.error ?? retry.error ?? schedule.error ?? permalink.error;
  const label = d.account ? `${d.account.handle} (${d.account.channel})` : d.socialAccountId;

  return (
    <li className="delivery" data-status={d.status}>
      <p>
        <strong>{label}</strong> <span className={`chip delivery-${d.status}`}>{DELIVERY_LABELS[d.status]}</span>
        {d.scheduledAt ? (
          <>
            {" · "}
            <time dateTime={d.scheduledAt}>{dateFmt.format(new Date(d.scheduledAt))}</time>
          </>
        ) : (
          " · sans date"
        )}
        {d.sentAt ? <span className="muted"> · publiée le {dateFmt.format(new Date(d.sentAt))}</span> : null}
      </p>
      {d.lastError ? (
        <p className="state-error-text">
          {d.lastError}
          {d.nextRetryAt && d.status === "scheduled" ? ` · nouvel essai ${dateFmt.format(new Date(d.nextRetryAt))}` : ""}
          {` · tentative ${d.attempts}/${d.maxAttempts}`}
        </p>
      ) : null}
      {d.permalink ? (
        <p>
          <a href={d.permalink} target="_blank" rel="noreferrer noopener">
            Voir la publication
          </a>
        </p>
      ) : null}
      {error ? <ErrorState error={error} /> : null}
      {writer ? (
        <div className="actions">
          {RESCHEDULABLE.has(d.status) ? (
            <button type="button" className="btn" disabled={busy} aria-pressed={editing === "date"} onClick={() => setEditing(editing === "date" ? null : "date")}>
              Changer la date
            </button>
          ) : null}
          {d.status === "failed" ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => retry.mutate({ id: d.id, version: d.version })}>
              Réessayer
            </button>
          ) : null}
          {d.status === "sent" || d.status === "handed_off" ? (
            <button type="button" className="btn" disabled={busy} aria-pressed={editing === "link"} onClick={() => setEditing(editing === "link" ? null : "link")}>
              {d.permalink ? "Modifier le lien" : "Renseigner le lien"}
            </button>
          ) : null}
          {CANCELLABLE.has(d.status) ? (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => cancel.mutate({ id: d.id, version: d.version })}>
              Annuler
            </button>
          ) : null}
          {d.attempts > 0 ? (
            <button type="button" className="btn btn-ghost" aria-expanded={attemptsOpen} onClick={() => setAttemptsOpen((o) => !o)}>
              Tentatives ({d.attempts})
            </button>
          ) : null}
        </div>
      ) : null}
      {editing === "date" ? (
        <form
          className="form-row"
          aria-label="Nouvelle date"
          onSubmit={(e) => {
            e.preventDefault();
            const iso = fromLocalInput(when);
            if (iso) schedule.mutate({ id: d.id, scheduledAt: iso, version: d.version }, { onSuccess: () => setEditing(null) });
          }}
        >
          <div className="stack">
            <label htmlFor={`when-${d.id}`}>Nouvelle date de publication</label>
            <input id={`when-${d.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Enregistrer la date
          </button>
        </form>
      ) : null}
      {editing === "link" ? (
        <form
          className="form-row"
          aria-label="Lien de la publication"
          onSubmit={(e) => {
            e.preventDefault();
            permalink.mutate({ id: d.id, url: url.trim(), version: d.version }, { onSuccess: () => setEditing(null) });
          }}
        >
          <div className="stack">
            <label htmlFor={`url-${d.id}`}>Lien public (https)</label>
            <input id={`url-${d.id}`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://www.linkedin.com/posts/…" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Enregistrer le lien
          </button>
        </form>
      ) : null}
      {attemptsOpen ? <Attempts deliveryId={d.id} /> : null}
    </li>
  );
}

function Attempts({ deliveryId }: { deliveryId: string }) {
  const attempts = useDeliveryAttempts(deliveryId);
  if (attempts.isPending) return <Loading label="Chargement des tentatives…" />;
  if (attempts.isError) return <ErrorState error={attempts.error} retry={() => void attempts.refetch()} />;
  if (attempts.data.length === 0) return <p className="muted">Aucune tentative.</p>;
  return (
    <ol className="timeline" aria-label="Tentatives">
      {attempts.data.map((a) => (
        <li key={a.id}>
          <p>
            Tentative {a.n} ({a.trigger}) · <strong>{a.outcome ?? "en cours"}</strong>
            <span className="muted"> · {dateFmt.format(new Date(a.startedAt))}</span>
          </p>
          {a.error ? <p className="state-error-text">{a.error}</p> : null}
        </li>
      ))}
    </ol>
  );
}

const SOCIAL = new Set<string>(["linkedin", "x", "instagram", "facebook", "threads"]);
const isSocial = (c: string): c is SocialAccount["channel"] => SOCIAL.has(c);
