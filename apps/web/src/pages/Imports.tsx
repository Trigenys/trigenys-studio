import type { ImportItem, Me } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link } from "react-router";
import { useIgnoreImport, useImports, useLinkImport, useProducts, useSyncImports, type ImportFilters } from "../api/queries";
import { ErrorState, Loading } from "../components/States";
import { dateFmt } from "../components/dates";
import { TASK_TYPES, canWrite } from "../views";

// What the CMS and the radar sent: each item is previewed as received
// (title, summary, date, sources) and only becomes a task when an operator
// says so. Nothing here writes back to the CMS.

const ORIGIN_LABELS: Record<ImportItem["origin"], string> = { cms: "CMS Insight", radar: "Radar Editorial OS" };
const STATUS_LABELS: Record<ImportItem["status"], string> = { new: "à traiter", linked: "liée à une tâche", ignored: "ignorée" };

export function ImportsPage({ me }: { me: Me }) {
  const [filters, setFilters] = useState<ImportFilters>({ status: "new" });
  const items = useImports(filters);
  const sync = useSyncImports();
  const writer = me.grants.some((g) => g.role === "admin" || g.role === "operator");

  const chip = (label: string, next: ImportFilters, active: boolean) => (
    <button type="button" className="chip-btn" aria-pressed={active} onClick={() => setFilters(next)}>
      {label}
    </button>
  );

  return (
    <article aria-labelledby="imports-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <div className="page-head">
        <h1 id="imports-title" className="page-title">
          Entrées
        </h1>
        {writer ? (
          <button type="button" className="btn btn-primary" disabled={sync.isPending} onClick={() => sync.mutate({ origin: "all", limit: 50 })}>
            {sync.isPending ? "Synchronisation…" : "Synchroniser"}
          </button>
        ) : null}
      </div>
      {sync.isError ? <ErrorState error={sync.error} /> : null}
      {sync.data ? (
        <p className="muted" role="status">
          {sync.data.origins.map((o) => `${ORIGIN_LABELS[o.origin]} : ${o.fetched} reçu(s), ${o.created} nouveau(x)`).join(" · ")}
        </p>
      ) : null}

      <nav className="product-filter" aria-label="Origine">
        {chip("Toutes les origines", { ...filters, origin: undefined }, !filters.origin)}
        {chip("CMS Insight", { ...filters, origin: "cms" }, filters.origin === "cms")}
        {chip("Radar", { ...filters, origin: "radar" }, filters.origin === "radar")}
      </nav>
      <nav className="product-filter" aria-label="Statut">
        {chip("À traiter", { ...filters, status: "new" }, filters.status === "new")}
        {chip("Liées", { ...filters, status: "linked" }, filters.status === "linked")}
        {chip("Ignorées", { ...filters, status: "ignored" }, filters.status === "ignored")}
      </nav>

      {items.isPending ? <Loading label="Chargement des entrées…" /> : null}
      {items.isError ? <ErrorState error={items.error} retry={() => void items.refetch()} /> : null}
      {items.data && items.data.length === 0 ? (
        <p className="state state-empty" role="status">
          Aucune entrée. {writer ? "Lancez une synchronisation pour recevoir les sujets récents." : ""}
        </p>
      ) : null}
      {items.data && items.data.length > 0 ? (
        <ul className="task-list" aria-label="Entrées">
          {items.data.map((item) => (
            <ImportCard key={item.id} item={item} me={me} writer={writer} />
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function ImportCard({ item, me, writer }: { item: ImportItem; me: Me; writer: boolean }) {
  const products = useProducts();
  const link = useLinkImport();
  const ignore = useIgnoreImport();
  const writable = (products.data ?? []).filter((p) => canWrite(me, p.id));
  const [productId, setProductId] = useState("");
  const selected = writable.some((p) => p.id === productId) ? productId : (writable[0]?.id ?? "");
  const payload = item.payload as { angle?: string | null; format?: string | null; vertical?: string | null; score?: number | null; locale?: string; status?: string };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    link.mutate({ id: item.id, body: { productId: String(f.get("productId")), type: String(f.get("type")).trim() || "post", assigneeId: me.userId } });
  };

  return (
    <li className="card stack">
      <p className="muted">
        {ORIGIN_LABELS[item.origin]} · {item.origin === "cms" ? "publié" : "observé"} le {dateFmt.format(new Date(item.observedAt))} · {STATUS_LABELS[item.status]}
        {payload.vertical ? ` · ${payload.vertical}` : ""}
        {typeof payload.score === "number" ? ` · score ${Math.round(payload.score)}` : ""}
      </p>
      <h2>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h2>
      {item.summary ? <p className="prose">{item.summary}</p> : null}
      {item.sources.length > 0 ? (
        <ul className="sources" aria-label={`Sources de ${item.title}`}>
          {item.sources.map((s) => (
            <li key={s}>
              <a href={s} target="_blank" rel="noreferrer">
                {s}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {item.status === "linked" && item.taskId ? (
        <p>
          <Link to={`/tasks/${item.taskId}`}>Ouvrir la tâche</Link>
        </p>
      ) : null}
      {writer && item.status === "new" && writable.length > 0 ? (
        <form className="stack" onSubmit={submit} aria-busy={link.isPending} aria-label={`Créer une tâche depuis ${item.title}`}>
          {link.isError ? <ErrorState error={link.error} /> : null}
          {ignore.isError ? <ErrorState error={ignore.error} /> : null}
          <div className="form-row">
            <div className="stack">
              <label htmlFor={`product-${item.id}`}>Produit</label>
              <select id={`product-${item.id}`} name="productId" value={selected} onChange={(e) => setProductId(e.target.value)} required>
                {writable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="stack">
              <label htmlFor={`type-${item.id}`}>Type</label>
              <input id={`type-${item.id}`} name="type" list={`types-${item.id}`} defaultValue="post" maxLength={40} required />
              <datalist id={`types-${item.id}`}>
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={link.isPending}>
              Créer une tâche
            </button>
            <button type="button" className="btn btn-ghost" disabled={ignore.isPending} onClick={() => ignore.mutate(item.id)}>
              Ignorer
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
