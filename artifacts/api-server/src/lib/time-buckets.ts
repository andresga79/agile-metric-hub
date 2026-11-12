import { isoWeekLabel } from "./iso-week";

/** Day buckets for lead/cycle time distributions, half-open [min, max). 30d+ is kept on purpose:
 *  it is where old backlog work shows up. */
export const DAY_BUCKETS: { range: string; min: number; max: number }[] = [
  { range: "0-1d", min: 0, max: 1 },
  { range: "1-3d", min: 1, max: 3 },
  { range: "3-7d", min: 3, max: 7 },
  { range: "7-14d", min: 7, max: 14 },
  { range: "14-30d", min: 14, max: 30 },
  { range: "30d+", min: 30, max: Infinity },
];

export function bucketDays(days: number[]): { range: string; count: number }[] {
  return DAY_BUCKETS.map(({ range, min, max }) => ({ range, count: days.filter((d) => d >= min && d < max).length }));
}

/** Issues delivered per ISO week (label as issues-by-week and the drill-down modal expect). */
export function deliveredByWeek(dates: Date[]): { week: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const w = isoWeekLabel(d);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week));
}
