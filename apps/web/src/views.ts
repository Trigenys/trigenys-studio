import type { Me, Task } from "@trigenys/studio-contracts";

export type ViewId = "today" | "review" | "scheduled" | "late";

export type View = {
  id: ViewId;
  label: string;
  empty: string;
  matches: (task: Task, ctx: ViewContext) => boolean;
};

export type ViewContext = { now: Date; userId: string };

// States where nothing is left to do on the task.
const DONE = new Set<Task["state"]>(["published", "measured"]);
const active = (t: Task) => !DONE.has(t.state);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

export const isLate = (t: Task, now: Date) => active(t) && t.dueAt !== null && new Date(t.dueAt) < startOfDay(now);

export const VIEWS: View[] = [
  {
    id: "today",
    label: "Aujourd'hui",
    empty: "Rien à faire aujourd'hui : aucune tâche due ou assignée.",
    // Due today or overdue (anyone), plus my tasks without a due date.
    matches: (t, { now, userId }) =>
      active(t) &&
      ((t.dueAt !== null && new Date(t.dueAt) < endOfDay(now)) || (t.dueAt === null && t.assigneeId === userId)),
  },
  {
    id: "review",
    label: "À valider",
    empty: "Aucun contenu n'attend une validation.",
    matches: (t) => t.state === "awaiting_approval",
  },
  {
    id: "scheduled",
    label: "Programmées",
    empty: "Aucune publication programmée.",
    matches: (t) => t.state === "scheduled",
  },
  {
    id: "late",
    label: "En retard",
    empty: "Aucune tâche en retard.",
    matches: (t, { now }) => isLate(t, now),
  },
];

export const viewById = (id: string | undefined): View | undefined => VIEWS.find((v) => v.id === id);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = fold(query.trim());
  if (!q) return tasks;
  return tasks.filter((t) => fold(`${t.title} ${t.brief} ${t.type} ${t.state}`).includes(q));
}

// Overdue first, then nearest due date, then priority, then title.
export function sortTasks(tasks: Task[], now: Date): Task[] {
  return [...tasks].sort((a, b) => {
    const la = isLate(a, now) ? 0 : 1;
    const lb = isLate(b, now) ? 0 : 1;
    if (la !== lb) return la - lb;
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title, "fr");
  });
}

export const STATE_LABELS: Record<Task["state"], string> = {
  qualifying: "À qualifier",
  preparing: "En préparation",
  reviewing: "En relecture",
  visuals: "Visuels",
  awaiting_approval: "À valider",
  approved: "Approuvée",
  scheduled: "Programmée",
  published: "Publiée",
  measured: "Mesurée",
  needs_fix: "À corriger",
  rejected: "Rejetée",
  failed: "Échec de publication",
};

// Who may write on a product. The server is the authority (403 otherwise);
// this only decides whether to show the editing forms.
export const canWrite = (me: Me, productId: string) =>
  me.grants.some((g) => (g.role === "admin" || g.role === "operator") && (g.productId === null || g.productId === productId));

export const canReview = (me: Me, productId: string) =>
  me.grants.some((g) => (g.role === "admin" || g.role === "reviewer") && (g.productId === null || g.productId === productId));

// Mirrors the pipeline's frozen states (the server answers 409 anyway): the
// version form is hidden rather than offered and refused.
export const FROZEN_STATES: ReadonlySet<Task["state"]> = new Set(["scheduled", "published", "measured"]);

export const CHANNELS = ["linkedin", "x", "instagram", "newsletter", "blog", "youtube"] as const;
export const TASK_TYPES = ["post", "article", "newsletter", "thread", "video", "story"] as const;
