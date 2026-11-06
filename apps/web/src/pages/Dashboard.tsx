import type { Me } from "@trigenys/studio-contracts";
import { useDeferredValue, useMemo } from "react";
import { Link, NavLink, Navigate, useParams, useSearchParams } from "react-router";
import { useProducts, useTasks } from "../api/queries";
import { Empty, ErrorState, Loading } from "../components/States";
import { TaskList } from "../components/TaskList";
import { VIEWS, searchTasks, sortTasks, viewById } from "../views";

export function DashboardPage({ me }: { me: Me }) {
  const { view: viewId } = useParams();
  const view = viewById(viewId);
  const [params, setParams] = useSearchParams();
  const productId = params.get("product");
  const query = params.get("q") ?? "";
  const deferredQuery = useDeferredValue(query);

  const products = useProducts();
  const tasks = useTasks(productId);
  const now = useMemo(() => new Date(), [tasks.dataUpdatedAt]);

  const productNames = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p.name])), [products.data]);
  const ctx = useMemo(() => ({ now, userId: me.userId }), [now, me.userId]);
  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.id, (tasks.data ?? []).filter((t) => v.matches(t, ctx)).length])),
    [tasks.data, ctx],
  );
  const visible = useMemo(() => {
    if (!view || !tasks.data) return [];
    return sortTasks(searchTasks(tasks.data.filter((t) => view.matches(t, ctx)), deferredQuery), now);
  }, [view, tasks.data, ctx, deferredQuery, now]);

  if (!view) return <Navigate to="/today" replace />;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key === "q" });
  };
  const keepParams = params.toString() ? `?${params.toString()}` : "";
  const writer = me.grants.some((g) => g.role === "admin" || g.role === "operator");

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Ma journée</h1>
        <div className="actions">
          <Link to="/imports" className="btn">
            Entrées
          </Link>
          <Link to="/calendar" className="btn">
            Calendrier
          </Link>
          <Link to="/reports" className="btn">
            Rapports
          </Link>
          {me.grants.some((g) => g.role === "admin") ? (
            <>
              <Link to="/brand-kits" className="btn">
                Kits de marque
              </Link>
              <Link to="/social-accounts" className="btn">
                Comptes sociaux
              </Link>
            </>
          ) : null}
          {writer ? (
            <Link to={`/tasks/new${productId ? `?product=${productId}` : ""}`} className="btn btn-primary">
              Nouvelle tâche
            </Link>
          ) : null}
        </div>
      </div>

      <nav className="product-filter" aria-label="Produit">
        <button type="button" className="chip-btn" aria-pressed={productId === null} onClick={() => setParam("product", null)}>
          Tous les produits
        </button>
        {(products.data ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip-btn"
            aria-pressed={productId === p.id}
            onClick={() => setParam("product", p.id)}
          >
            {p.name}
          </button>
        ))}
      </nav>

      <nav className="views" aria-label="Vues">
        {VIEWS.map((v) => (
          <NavLink key={v.id} to={`/${v.id}${keepParams}`} className="view-link">
            {v.label}
            <span className="count" aria-label={`${counts[v.id] ?? 0} tâches`}>
              {tasks.data ? counts[v.id] : "–"}
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="search">
        <label htmlFor="q">Rechercher une tâche</label>
        <input
          id="q"
          type="search"
          placeholder="Titre, brief, type…"
          value={query}
          onChange={(e) => setParam("q", e.target.value || null)}
        />
      </div>

      <section aria-labelledby="view-title" aria-busy={tasks.isPending}>
        <h2 id="view-title" className="visually-hidden">
          {view.label}
        </h2>
        {tasks.isPending ? <Loading label="Chargement des tâches…" /> : null}
        {tasks.isError ? <ErrorState error={tasks.error} retry={() => void tasks.refetch()} /> : null}
        {tasks.data && visible.length === 0 ? (
          <Empty>{deferredQuery ? `Aucune tâche ne correspond à « ${deferredQuery} ».` : view.empty}</Empty>
        ) : null}
        {tasks.data && visible.length > 0 ? <TaskList tasks={visible} now={now} productNames={productNames} /> : null}
      </section>
    </>
  );
}
