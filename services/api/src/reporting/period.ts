// Reports are monthly, in UTC: `YYYY-MM` → [from, to). A free range is out
// of scope (ADR 0010): objectives are monthly and would not prorate cleanly.

export type MonthRange = { month: string; from: Date; to: Date };

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function monthRange(month: string): MonthRange {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const year = Number(m[1]);
  const index = Number(m[2]) - 1;
  return { month, from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 1)) };
}

export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
