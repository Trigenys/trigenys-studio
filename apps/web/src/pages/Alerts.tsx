import type { Alert, Me, NotificationPreference } from "@trigenys/studio-contracts";
import { Link, useSearchParams } from "react-router";
import {
  useAcknowledgeAlert,
  useAlerts,
  useNotificationPreferences,
  useProducts,
  useReconcileAlerts,
  useUpdateNotificationPreferences,
  type AlertFilters,
} from "../api/queries";
import { ALERT_KINDS, EMAIL_LABELS, KIND_LABELS, PRIORITY_LABELS, STATE_LABELS, alertPath } from "../alerts";
import { dateFmt } from "../components/dates";
import { Empty, ErrorState, Loading } from "../components/States";
import { isAdmin } from "./BrandKits";

// Inbox of alerts (ADR 0011). Nothing is created here: the server derives
// every alert from the state of the tasks and deliveries, and resolves it
// when the condition is gone. The reader can only acknowledge an alert,
// follow it to the task that fixes it, and tune their own e-mails.

type StateFilter = NonNullable<AlertFilters["state"]>;

const STATES: { value: StateFilter; label: string }[] = [
  { value: "active", label: "En cours" },
  { value: "open", label: "À traiter" },
  { value: "acknowledged", label: "Vues" },
  { value: "resolved", label: "Résolues" },
];

const PRIORITIES: Alert["priority"][] = ["p1", "p2", "p3"];

const stateOf = (v: string | null): StateFilter => (STATES.some((s) => s.value === v) ? (v as StateFilter) : "active");
const priorityOf = (v: string | null): Alert["priority"] | undefined => (PRIORITIES.includes(v as Alert["priority"]) ? (v as Alert["priority"]) : undefined);

export function AlertsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const state = stateOf(params.get("state"));
  const priority = priorityOf(params.get("priority"));
  const productId = params.get("product") ?? undefined;
  const filters: AlertFilters = { state, priority, productId };

  const alerts = useAlerts(filters);
  const products = useProducts();
  const acknowledge = useAcknowledgeAlert();
  const reconcile = useReconcileAlerts();
  const admin = isAdmin(me);

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const productName = (id: string) => products.data?.find((p) => p.id === id)?.name ?? id;

  return (
    <article aria-labelledby="alerts-title">
      <Link to="/today" className="back">
        ← Ma journée
      </Link>
      <div className="page-head">
        <h1 id="alerts-title" className="page-title">
          Alertes
        </h1>
        {admin ? (
          <div className="actions">
            <button type="button" className="btn" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
              Vérifier maintenant
            </button>
          </div>
        ) : null}
      </div>
      <p className="muted">Chaque alerte renvoie à la tâche qui la corrige et disparaît d'elle-même quand la condition n'est plus remplie.</p>
      {reconcile.data ? (
        <p className="muted" role="status">
          Vérification faite : {reconcile.data.reconcile.opened} ouverte(s), {reconcile.data.reconcile.escalated} aggravée(s),{" "}
          {reconcile.data.reconcile.resolved} résolue(s), {reconcile.data.notify.sent} e-mail(s) envoyé(s).
        </p>
      ) : null}
      {reconcile.isError ? <ErrorState error={reconcile.error} /> : null}

      <div className="filters">
      <div className="filter-group" role="group" aria-label="État">
        <span className="filter-label" aria-hidden="true">État</span>
        {STATES.map((s) => (
          <button
            key={s.value}
            type="button"
            className="chip-btn"
            aria-pressed={state === s.value}
            onClick={() => setParam("state", s.value === "active" ? undefined : s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="filter-group" role="group" aria-label="Priorité">
        <span className="filter-label" aria-hidden="true">Priorité</span>
        <button type="button" className="chip-btn" aria-pressed={!priority} onClick={() => setParam("priority", undefined)}>
          Toutes
        </button>
        {PRIORITIES.map((p) => (
          <button key={p} type="button" className="chip-btn" aria-pressed={priority === p} onClick={() => setParam("priority", p)}>
            {PRIORITY_LABELS[p]}
          </button>
        ))}
      </div>
      {products.data && products.data.length > 1 ? (
        <div className="filter-group" role="group" aria-label="Produit">
          <span className="filter-label" aria-hidden="true">Produit</span>
          <button type="button" className="chip-btn" aria-pressed={!productId} onClick={() => setParam("product", undefined)}>
            Tous les produits
          </button>
          {products.data.map((p) => (
            <button key={p.id} type="button" className="chip-btn" aria-pressed={productId === p.id} onClick={() => setParam("product", p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      ) : null}
      </div>

      {alerts.isPending ? <Loading /> : null}
      {alerts.isError ? <ErrorState error={alerts.error} /> : null}
      {alerts.data && alerts.data.length === 0 ? <Empty>Rien à signaler.</Empty> : null}
      {alerts.data && alerts.data.length > 0 ? (
        <ul className="list" aria-label="Alertes">
          {alerts.data.map((a) => (
            <li key={a.id} className="card">
              <div className="actions">
                <span className={`chip chip-state priority-${a.priority}`}>{PRIORITY_LABELS[a.priority]}</span>
                <span className="chip">{KIND_LABELS[a.kind]}</span>
                <span className={`chip chip-state state-${a.state}`}>{STATE_LABELS[a.state]}</span>
                {a.emailStatus === "failed" ? <span className="chip chip-state state-failed">E-mail non remis</span> : null}
              </div>
              <h2>
                <Link to={alertPath(a)}>{a.title}</Link>
              </h2>
              <p>{a.detail}</p>
              <p className="muted">
                {productName(a.productId)} · depuis le {dateFmt.format(new Date(a.firstSeenAt))}
                {a.acknowledgedAt ? ` · vue le ${dateFmt.format(new Date(a.acknowledgedAt))}` : ""}
                {a.resolvedAt ? ` · résolue le ${dateFmt.format(new Date(a.resolvedAt))}` : ""}
              </p>
              {a.state === "open" ? (
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={acknowledge.isPending && acknowledge.variables === a.id}
                    onClick={() => acknowledge.mutate(a.id)}
                  >
                    Acquitter
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {acknowledge.isError ? <ErrorState error={acknowledge.error} /> : null}

      <Preferences />
    </article>
  );
}

function Preferences() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const current = (kind: Alert["kind"]): NotificationPreference["email"] => prefs.data?.find((p) => p.kind === kind)?.email ?? "off";

  return (
    <details className="card card-details">
      <summary>Mes notifications par e-mail</summary>
      <div className="card-body">
        <p className="muted">Les alertes restent visibles ici quoi qu'il arrive ; l'e-mail ne part que pour les types choisis.</p>
        {prefs.isPending ? <Loading /> : null}
        {prefs.isError ? <ErrorState error={prefs.error} /> : null}
        {prefs.data ? (
          <ul className="list" aria-label="Préférences">
            {ALERT_KINDS.map((kind) => (
              <li key={kind} className="actions">
                <label htmlFor={`pref-${kind}`}>{KIND_LABELS[kind]}</label>
                <select
                  id={`pref-${kind}`}
                  value={current(kind)}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ preferences: [{ kind, email: e.target.value as NotificationPreference["email"] }] })}
                >
                  {(["off", "immediate"] as const).map((v) => (
                    <option key={v} value={v}>
                      {EMAIL_LABELS[v]}
                    </option>
                  ))}
                </select>
                <span className="muted">{prefs.data.find((p) => p.kind === kind)?.source === "user" ? "réglé par vous" : "par défaut"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {update.isError ? <ErrorState error={update.error} /> : null}
      </div>
    </details>
  );
}
