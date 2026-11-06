import type { ChannelCampaign, ContractObjective, EditorialReport, Me, MetricSnapshot, ObjectiveProgress, VerifiedMetrics } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link } from "react-router";
import { useCreateObjective, useEditorialReport, useProducts, useRefreshMetrics, useUpdateObjective, useUpdateProduct } from "../api/queries";
import { dateFmt } from "../components/dates";
import { Empty, ErrorState, Loading } from "../components/States";
import { isAdmin } from "./BrandKits";

// Monthly editorial report (ADR 0010). Two regimes that never mix on screen:
// what Studio counted itself (tasks, articles, campaigns, objectives) and what
// a verified provider measured (SEO Monitor). When no provider is connected
// the page says so and shows no number at all: a figure that looks measured
// but is not would be worse than none.

const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const TYPE_LABELS: Record<string, string> = { article: "Articles", post: "Posts", newsletter: "Newsletters" };
const CHANNEL_LABELS: Record<string, string> = { linkedin: "LinkedIn", facebook: "Facebook", x: "X", newsletter: "Newsletter" };
const METRIC_LABELS: Record<ContractObjective["metric"], string> = {
  tasks_completed: "Tâches terminées",
  articles_published: "Articles publiés",
  deliveries_sent: "Publications envoyées",
};
const MEASURE_LABELS: Record<string, string> = { impressions: "Impressions", clicks: "Clics", sessions: "Sessions", ctr: "CTR" };

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthDate = (key: string) => new Date(`${key}-01T00:00:00Z`);
const shiftMonth = (key: string, n: number) => {
  const d = monthDate(key);
  return monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};

export function ReportingPage({ me }: { me: Me }) {
  const products = useProducts();
  const [productId, setProductId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const report = useEditorialReport(month, productId);
  const admin = isAdmin(me);

  return (
    <article aria-labelledby="report-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <div className="page-head">
        <h1 id="report-title" className="page-title">
          Rapport éditorial
        </h1>
        <div className="actions" aria-label="Mois">
          <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mois précédent">
            ←
          </button>
          <strong aria-live="polite" className="month-label">
            {monthFmt.format(monthDate(month))}
          </strong>
          <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mois suivant">
            →
          </button>
        </div>
      </div>
      {products.data ? (
        <nav className="product-filter" aria-label="Produit">
          <button type="button" className="chip-btn" aria-pressed={productId === null} onClick={() => setProductId(null)}>
            Tous
          </button>
          {products.data.map((p) => (
            <button key={p.id} type="button" className="chip-btn" aria-pressed={p.id === productId} onClick={() => setProductId(p.id)}>
              {p.name}
            </button>
          ))}
        </nav>
      ) : null}
      {report.isPending ? <Loading label="Calcul du rapport…" /> : null}
      {report.isError ? <ErrorState error={report.error} retry={() => void report.refetch()} /> : null}
      {report.data ? <Report report={report.data} admin={admin} productId={productId} /> : null}
    </article>
  );
}

function Report({ report, admin, productId }: { report: EditorialReport; admin: boolean; productId: string | null }) {
  const names = new Map(report.products.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  return (
    <div className="stack">
      <section className="card" aria-labelledby="ops-title">
        <h2 id="ops-title">
          Comptages opérationnels <span className="chip">calculé depuis Studio</span>
        </h2>
        <p className="muted">
          Du {dateFmt.format(new Date(report.from))} au {dateFmt.format(new Date(report.to))} (UTC), généré le {dateFmt.format(new Date(report.generatedAt))}.
        </p>
        {report.operational.tasks.length === 0 ? (
          <Empty>Aucune tâche échue ni terminée ce mois-ci.</Empty>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tableau des tâches par produit et type">
          <table className="table" aria-label="Tâches par produit et type">
            <thead>
              <tr>
                <th scope="col">Produit</th>
                <th scope="col">Type</th>
                <th scope="col">Échues</th>
                <th scope="col">Terminées</th>
                <th scope="col">En retard</th>
              </tr>
            </thead>
            <tbody>
              {report.operational.tasks.map((t) => (
                <tr key={`${t.productId}-${t.type}`}>
                  <td>{nameOf(t.productId)}</td>
                  <td>{TYPE_LABELS[t.type] ?? t.type}</td>
                  <td>{t.due}</td>
                  <td>{t.done}</td>
                  <td>{t.late}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="card" aria-labelledby="objectives-title">
        <h2 id="objectives-title">Objectifs du contrat</h2>
        <Objectives rows={report.objectives} nameOf={nameOf} admin={admin} />
        {admin && productId ? <NewObjective productId={productId} /> : null}
        {admin && !productId ? <p className="muted">Choisissez un produit pour ajouter un objectif.</p> : null}
      </section>

      <section className="card" aria-labelledby="campaigns-title">
        <h2 id="campaigns-title">Campagnes par produit et réseau</h2>
        <Campaigns rows={report.operational.campaigns} nameOf={nameOf} />
      </section>

      <section className="card" aria-labelledby="articles-title">
        <h2 id="articles-title">Articles publiés</h2>
        {report.operational.publishedArticles.length === 0 ? (
          <Empty>Aucun article publié ce mois-ci.</Empty>
        ) : (
          <ul className="list" aria-label="Articles publiés">
            {report.operational.publishedArticles.map((a) => (
              <li key={a.taskId}>
                <Link to={`/tasks/${a.taskId}`}>{a.title}</Link>
                <span className="muted">
                  {" "}
                  · {nameOf(a.productId)} · publié le {dateFmt.format(new Date(a.publishedAt))}
                </span>
                {a.url ? (
                  <>
                    {" "}
                    <a href={a.url} target="_blank" rel="noreferrer noopener">
                      Voir
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="verified-title">
        <h2 id="verified-title">Mesures vérifiées</h2>
        {report.verified.map((v) => (
          <Verified key={v.productId} section={v} product={report.products.find((p) => p.id === v.productId)!} admin={admin} />
        ))}
        {admin ? <RefreshButton /> : null}
      </section>
    </div>
  );
}

function Objectives({ rows, nameOf, admin }: { rows: ObjectiveProgress[]; nameOf: (id: string) => string; admin: boolean }) {
  const update = useUpdateObjective();
  if (rows.length === 0) return <Empty>Aucun objectif actif pour ce périmètre.</Empty>;
  return (
    <ul className="list" aria-label="Objectifs">
      {rows.map(({ objective: o, actual, ratio }) => (
        <li key={o.id} className="kit-card">
          <strong>{METRIC_LABELS[o.metric]}</strong>
          {o.taskType ? <span className="chip">{TYPE_LABELS[o.taskType] ?? o.taskType}</span> : null}
          {o.channel ? <span className="chip">{CHANNEL_LABELS[o.channel] ?? o.channel}</span> : null}
          <span className="muted"> · {nameOf(o.productId)}</span>
          <div>
            <span data-testid="objective-progress">
              {actual} / {o.target}
            </span>{" "}
            <meter min={0} max={o.target} value={Math.min(actual, o.target)} aria-label={`${METRIC_LABELS[o.metric]} : ${actual} sur ${o.target}`} />{" "}
            <span className="muted">({Math.round(ratio * 100)} %)</span>
          </div>
          {admin ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn-danger"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: o.id, version: o.version, active: false })}
              >
                Désactiver
              </button>
            </div>
          ) : null}
        </li>
      ))}
      {update.isError ? <ErrorState error={update.error} /> : null}
    </ul>
  );
}

function NewObjective({ productId }: { productId: string }) {
  const create = useCreateObjective(productId);
  const [metric, setMetric] = useState<ContractObjective["metric"]>("tasks_completed");
  const [target, setTarget] = useState("4");
  const [taskType, setTaskType] = useState("");
  const [channel, setChannel] = useState("");
  return (
    <form
      className="form-row"
      aria-label="Nouvel objectif"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          {
            metric,
            target: Number(target),
            ...(metric === "tasks_completed" && taskType ? { taskType } : {}),
            ...(metric === "deliveries_sent" && channel ? { channel: channel as "linkedin" | "facebook" | "x" } : {}),
          },
          { onSuccess: () => setTarget("4") },
        );
      }}
    >
      <label>
        Mesure
        <select value={metric} onChange={(e) => setMetric(e.target.value as ContractObjective["metric"])}>
          {Object.entries(METRIC_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {metric === "tasks_completed" ? (
        <label>
          Type (optionnel)
          <select value={taskType} onChange={(e) => setTaskType(e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {metric === "deliveries_sent" ? (
        <label>
          Réseau (optionnel)
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Tous</option>
            <option value="linkedin">LinkedIn</option>
            <option value="facebook">Facebook</option>
            <option value="x">X</option>
          </select>
        </label>
      ) : null}
      <label>
        Cible mensuelle
        <input type="number" min={1} max={100000} required value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={create.isPending}>
        Ajouter l'objectif
      </button>
      {create.isError ? <ErrorState error={create.error} /> : null}
    </form>
  );
}

function Campaigns({ rows, nameOf }: { rows: ChannelCampaign[]; nameOf: (id: string) => string }) {
  if (rows.length === 0) return <Empty>Aucune publication planifiée ni envoyée ce mois-ci.</Empty>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Tableau des campagnes">
    <table className="table" aria-label="Campagnes">
      <thead>
        <tr>
          <th scope="col">Produit</th>
          <th scope="col">Réseau</th>
          <th scope="col">Planifiées</th>
          <th scope="col">Transmises</th>
          <th scope="col">Envoyées</th>
          <th scope="col">Échouées</th>
          <th scope="col">Annulées</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={`${c.productId}-${c.channel}`}>
            <td>{nameOf(c.productId)}</td>
            <td>{CHANNEL_LABELS[c.channel] ?? c.channel}</td>
            <td>{c.scheduled}</td>
            <td>{c.handedOff}</td>
            <td>{c.sent}</td>
            <td>{c.failed}</td>
            <td>{c.cancelled}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function Verified({ section, product, admin }: { section: VerifiedMetrics; product: EditorialReport["products"][number]; admin: boolean }) {
  return (
    <div className="kit-card" data-testid={`verified-${section.productId}`}>
      <h3>
        {product.name}{" "}
        {section.status === "connected" ? <span className="chip">source {section.provider}</span> : <span className="chip">non connecté</span>}
      </h3>
      {section.status === "not_connected" ? (
        <p className="muted">{section.reason}</p>
      ) : section.snapshots.length === 0 ? (
        <Empty>Aucune mesure pour ce mois : rien n'a encore été relevé sur les contenus publiés.</Empty>
      ) : (
        <>
          <p>
            {Object.entries(section.totals).map(([k, v]) => (
              <span key={k} className="chip">
                {MEASURE_LABELS[k] ?? k} : {v}
              </span>
            ))}
          </p>
          <ul className="list" aria-label={`Mesures ${product.name}`}>
            {section.snapshots.map((s) => (
              <Snapshot key={`${s.targetKind}-${s.targetRef}`} snapshot={s} />
            ))}
          </ul>
        </>
      )}
      <SeoMonitorLink product={product} admin={admin} />
    </div>
  );
}

function Snapshot({ snapshot: s }: { snapshot: MetricSnapshot }) {
  return (
    <li>
      <a href={s.targetRef} target="_blank" rel="noreferrer noopener">
        {s.targetRef}
      </a>
      <span className="muted">
        {" "}
        · source {s.provider}, mesuré le {dateFmt.format(new Date(s.measuredAt))}
      </span>
      <div>
        {Object.entries(s.metrics).map(([k, v]) => (
          <span key={k} className="chip">
            {MEASURE_LABELS[k] ?? k} : {v}
          </span>
        ))}
      </div>
    </li>
  );
}

function SeoMonitorLink({ product, admin }: { product: EditorialReport["products"][number]; admin: boolean }) {
  const update = useUpdateProduct();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(product.seoMonitorUrl ?? "");
  if (editing) {
    return (
      <form
        className="form-row"
        aria-label={`SEO Monitor ${product.name}`}
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ id: product.id, seoMonitorUrl: url.trim() || null }, { onSuccess: () => setEditing(false) });
        }}
      >
        <label>
          Adresse SEO Monitor (https)
          <input type="url" pattern="https://.*" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seo.trigenys.com/products/insight" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>
          Enregistrer
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
          Annuler
        </button>
        {update.isError ? <ErrorState error={update.error} /> : null}
      </form>
    );
  }
  return (
    <p className="actions">
      {product.seoMonitorUrl ? (
        <a className="btn" href={product.seoMonitorUrl} target="_blank" rel="noreferrer noopener">
          Ouvrir SEO Monitor
        </a>
      ) : (
        <span className="muted">Pas d'adresse SEO Monitor pour ce produit.</span>
      )}
      {admin ? (
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
          {product.seoMonitorUrl ? "Modifier l'adresse" : "Définir l'adresse"}
        </button>
      ) : null}
    </p>
  );
}

function RefreshButton() {
  const refresh = useRefreshMetrics();
  return (
    <div className="actions">
      <button type="button" className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
        Rafraîchir les mesures
      </button>
      {refresh.data ? (
        <span role="status" className="muted">
          {refresh.data.considered} cible(s) examinée(s), {refresh.data.written} relevé(s) écrit(s), {refresh.data.unchanged} inchangé(s)
          {refresh.data.errors.length ? `, ${refresh.data.errors.length} erreur(s)` : ""}.
        </span>
      ) : null}
      {refresh.isError ? <ErrorState error={refresh.error} /> : null}
    </div>
  );
}
