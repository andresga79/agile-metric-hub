import type { TimeInStatusEntry, WipAgingItem } from "../flow-insights";
import { flowStatusRows, wipBlock } from "./flow-block";
import type { CurrentSprintView, SprintFacts } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day of `instant` in `timeZone`, as UTC midnight ms (comparable, steppable by DAY_MS). */
function localDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

const isWeekday = (dayMs: number): boolean => {
  const d = new Date(dayMs).getUTCDay();
  return d !== 0 && d !== 6;
};

/** Weekdays in [fromDay, toDay], both local days as UTC-midnight ms. */
function weekdaysBetween(fromDay: number, toDay: number): number {
  let n = 0;
  for (let d = fromDay; d <= toDay; d += DAY_MS) if (isWeekday(d)) n++;
  return n;
}

/**
 * Business days (Mon-Fri, local calendar days in `timeZone`, holidays not excluded) of a sprint as
 * of `now`: `total` from start day to end day; `elapsed` = the ones fully behind (before today,
 * capped at total); `current` = today's day number (weekend -> the last weekday's). Null without
 * both dates or with an end before the start.
 */
export function sprintBusinessDays(
  startDate: string | null,
  endDate: string | null,
  now: Date,
  timeZone: string,
): { total: number; elapsed: number; current: number } | null {
  if (!startDate || !endDate) return null;
  const start = localDay(new Date(startDate), timeZone);
  const end = localDay(new Date(endDate), timeZone);
  const today = localDay(now, timeZone);
  if (end < start) return null;
  const total = weekdaysBetween(start, end);
  if (total === 0) return null;
  const elapsed = today <= start ? 0 : weekdaysBetween(start, Math.min(today - DAY_MS, end));
  const current = today < start ? 0 : Math.min(total, weekdaysBetween(start, Math.min(today, end)));
  return { total, elapsed, current };
}

export interface CurrentSprintInput {
  project: { id: string; key: string; name: string };
  sprint: SprintFacts | null;
  timeInStatus: TimeInStatusEntry[];
  wipAging: WipAgingItem[];
}

/** The cacheable part of the view: everything but the today-dependent fields. */
export function buildCurrentSprintView(input: CurrentSprintInput): CurrentSprintView {
  return {
    projectId: input.project.id,
    projectKey: input.project.key,
    projectName: input.project.name,
    sprint: input.sprint,
    businessDays: null,
    expectedRate: null,
    timeInStatus: flowStatusRows(input.timeInStatus),
    wip: wipBlock(input.wipAging),
    generatedAt: new Date().toISOString(),
  };
}

/** Re-derives the today-dependent fields (run after every cache read, like applyThresholds). */
export function withBusinessDays(view: CurrentSprintView, now: Date, timeZone: string): CurrentSprintView {
  const s = view.sprint;
  const days = s ? sprintBusinessDays(s.startDate, s.endDate, now, timeZone) : null;
  return {
    ...view,
    businessDays: days,
    expectedRate: days ? (days.elapsed / days.total) * 100 : null,
  };
}
