import type { Task } from "@trigenys/studio-contracts";
import { Link } from "react-router";
import { STATE_LABELS, isLate } from "../views";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function TaskList({ tasks, now, productNames }: { tasks: Task[]; now: Date; productNames: Map<string, string> }) {
  return (
    <ul className="task-list">
      {tasks.map((t) => {
        const late = isLate(t, now);
        return (
          <li key={t.id} className={late ? "task late" : "task"}>
            <Link to={`/tasks/${t.id}`} className="task-link">
              <span className="task-title">{t.title}</span>
              <span className="task-meta">
                <span className="chip chip-product">{productNames.get(t.productId) ?? t.productId}</span>
                <span className={`chip chip-state state-${t.state}`}>{STATE_LABELS[t.state]}</span>
                <span className="chip">{t.type}</span>
                {t.dueAt ? (
                  <time dateTime={t.dueAt} className={late ? "due late" : "due"}>
                    {late ? "En retard · " : ""}
                    {dateFmt.format(new Date(t.dueAt))}
                  </time>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
