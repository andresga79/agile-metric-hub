import { isoWeekStart } from "./iso-week";

export interface QaWeek {
  weekStart: string;
  totalEnteredQa: number;
  rejectedCount: number;
  /** Null when nothing entered QA that week (its rejections' QA entry fell in an earlier week). */
  rate: number | null;
}

/** QA rejection rate per ISO week, same formula as the per-sprint table and the KPI: distinct
 *  issues rejected ÷ distinct issues that entered QA in that week. Null when nothing entered QA; capped
 *  at 100 (a rejection whose QA entry fell in an earlier week can outnumber that week's entries). */
export function qaRateByWeek(entered: { key: string; at: Date }[], rejected: { key: string; at: Date }[]): QaWeek[] {
  const weeks = new Map<string, { entered: Set<string>; rejected: Set<string> }>();
  const bucket = (at: Date) => {
    const w = isoWeekStart(at);
    let b = weeks.get(w);
    if (!b) weeks.set(w, (b = { entered: new Set(), rejected: new Set() }));
    return b;
  };
  for (const e of entered) bucket(e.at).entered.add(e.key);
  for (const r of rejected) bucket(r.at).rejected.add(r.key);
  return [...weeks.entries()]
    .map(([weekStart, b]) => ({
      weekStart,
      totalEnteredQa: b.entered.size,
      rejectedCount: b.rejected.size,
      rate: b.entered.size > 0 ? Math.min(100, Math.round((b.rejected.size / b.entered.size) * 1000) / 10) : null,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
