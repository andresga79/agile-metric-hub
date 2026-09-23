// Single ISO 8601 week implementation for the whole API. There used to be five copies of this
// logic across routes/lib; three of them computed the week number as
// floor((thursday - Jan 4) / 7) + 1, which is off by one whenever Jan 4 falls on Fri/Sat/Sun
// (all of 2025 and 2026: 2026-09-21 came out as W38 instead of W39, and 2026-01-01 as "W00").
// Everything here works in UTC so the result doesn't depend on the container's TZ.

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** 0 = Monday .. 6 = Sunday. */
function isoWeekday(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/** ISO week-numbering year and week (1-53) containing `date`. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = utcMidnight(date);
  // The Thursday of this week decides which ISO year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 3 - isoWeekday(d));
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Thursday = new Date(jan4);
  week1Thursday.setUTCDate(jan4.getUTCDate() + 3 - isoWeekday(jan4));
  const week = 1 + Math.round((d.getTime() - week1Thursday.getTime()) / (7 * DAY_MS));
  return { year, week };
}

/** "2026-W39"-style label; sorts lexicographically in chronological order. */
export function isoWeekLabel(date: Date): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday of the ISO week containing `date`, as YYYY-MM-DD. */
export function isoWeekStart(date: Date): string {
  const d = utcMidnight(date);
  d.setUTCDate(d.getUTCDate() - isoWeekday(d));
  return d.toISOString().split("T")[0]!;
}
