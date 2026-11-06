import type { CalendarDueTask, CalendarEntry, Me } from "@trigenys/studio-contracts";
import { useState } from "react";
import { Link } from "react-router";
import { useCalendar, useProducts } from "../api/queries";
import { DELIVERY_LABELS } from "../components/PublicationSection";
import { ErrorState, Loading } from "../components/States";
import { STATE_LABELS } from "../views";

// Editorial calendar: one month at a time, listed day by day. Each day shows
// the deliveries planned on the social accounts (with their outcome) and the
// tasks due that day. A list reads on a phone and to a screen reader where a
// seven-column grid does not; the month is the unit the team plans with.

const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Day = { key: string; date: Date; deliveries: CalendarEntry[]; dueTasks: CalendarDueTask[] };

function groupByDay(deliveries: CalendarEntry[], dueTasks: CalendarDueTask[]): Day[] {
  const days = new Map<string, Day>();
  const dayOf = (iso: string) => {
    const key = dayKey(iso);
    let day = days.get(key);
    if (!day) {
      const d = new Date(iso);
      day = { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), deliveries: [], dueTasks: [] };
      days.set(key, day);
    }
    return day;
  };
  for (const e of deliveries) dayOf(e.scheduledAt).deliveries.push(e);
  for (const t of dueTasks) dayOf(t.dueAt).dueTasks.push(t);
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function CalendarPage({ me: _me }: { me: Me }) {
  const products = useProducts();
  const [productId, setProductId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const from = month.toISOString();
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString();
  const calendar = useCalendar(from, to, productId);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const title = monthFmt.format(month);

  return (
    <article aria-labelledby="calendar-title">
      <p>
        <Link to="/today" className="back">
          ← Ma journée
        </Link>
      </p>
      <div className="page-head">
        <h1 id="calendar-title" className="page-title">
          Calendrier
        </h1>
        <div className="actions" aria-label="Mois">
          <button type="button" className="btn" onClick={() => shift(-1)} aria-label="Mois précédent">
            ←
          </button>
          <strong aria-live="polite" className="month-label">
            {title}
          </strong>
          <button type="button" className="btn" onClick={() => shift(1)} aria-label="Mois suivant">
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
      {calendar.isPending ? <Loading label="Chargement du calendrier…" /> : null}
      {calendar.isError ? <ErrorState error={calendar.error} retry={() => void calendar.refetch()} /> : null}
      {calendar.data ? <Month days={groupByDay(calendar.data.deliveries, calendar.data.dueTasks)} /> : null}
    </article>
  );
}

function Month({ days }: { days: Day[] }) {
  if (days.length === 0) {
    return (
      <p className="state state-empty" role="status">
        Rien de planifié ce mois-ci : aucune publication, aucune échéance.
      </p>
    );
  }
  return (
    <ol className="calendar" aria-label="Jours">
      {days.map((day) => (
        <li key={day.key} className="calendar-day">
          <h2>{dayFmt.format(day.date)}</h2>
          {day.deliveries.length > 0 ? (
            <ul className="calendar-entries" aria-label={`Publications du ${dayFmt.format(day.date)}`}>
              {day.deliveries.map((e) => (
                <li key={e.id} className="calendar-entry" data-status={e.status}>
                  <time dateTime={e.scheduledAt}>{timeFmt.format(new Date(e.scheduledAt))}</time>{" "}
                  <Link to={`/tasks/${e.taskId}`}>{e.taskTitle}</Link>
                  <span className="muted">
                    {" "}
                    · {e.productId} · {e.accountHandle} ({e.channel})
                  </span>{" "}
                  <span className={`chip delivery-${e.status}`}>{DELIVERY_LABELS[e.status]}</span>
                  {e.lastError ? <span className="state-error-text"> : {e.lastError}</span> : null}
                  {e.permalink ? (
                    <>
                      {" "}
                      <a href={e.permalink} target="_blank" rel="noreferrer noopener">
                        Voir
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {day.dueTasks.length > 0 ? (
            <ul className="calendar-entries" aria-label={`Échéances du ${dayFmt.format(day.date)}`}>
              {day.dueTasks.map((t) => (
                <li key={t.id} className="calendar-entry calendar-due">
                  <span className="muted">Échéance</span> <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  <span className="muted"> · {t.productId}</span> <span className={`chip chip-state state-${t.state}`}>{STATE_LABELS[t.state]}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
