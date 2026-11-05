export const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

const pad = (n: number) => String(n).padStart(2, "0");

// <input type="datetime-local"> works in local wall-clock time without a
// zone; the API speaks ISO 8601 in UTC.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
