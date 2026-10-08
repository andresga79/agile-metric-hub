import { percentile } from "./stats";

/** Team rule: every sprint starts on a Monday and lasts 10 working days. */
export const NEXT_SPRINT_WORKING_DAYS = 10;
/** Closed sprints the team rate is computed from. */
export const HISTORY_SPRINTS = 6;
/** Below this many usable closed sprints there is no recommendation. */
export const MIN_SPRINTS_FOR_RATE = 3;

export type Band = "ok" | "warn" | "over";

export interface Units {
  sp: number;
  issues: number;
}

export interface RateBand {
  p25: number;
  p50: number;
  p75: number;
}

/** Team delivery per available person-day. Always a TEAM rate — there is deliberately no
 *  per-person velocity (story points per person are noisy and turn into a ranking). */
export interface TeamRate {
  sp: RateBand;
  issues: RateBand;
  sprintsUsed: number;
}

export interface SprintSample {
  personDays: number;
  completedSp: number;
  completedIssues: number;
}

const DAY_MS = 86_400_000;

/** Mon–Fri days between two Jira timestamps, both ends inclusive. Uses the calendar date exactly
 *  as Jira wrote it (the first 10 chars), so a sprint started on a Sunday evening counts from
 *  Monday and a Friday 21:00 -03:00 end still counts Friday instead of shifting to UTC Saturday. */
export function workingDays(start: string, end: string): number {
  const from = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  let days = 0;
  for (let t = from; t <= to; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days++;
  }
  return days;
}

function band(values: number[]): RateBand {
  return {
    p25: percentile(values, 0.25) ?? 0,
    p50: percentile(values, 0.5) ?? 0,
    p75: percentile(values, 0.75) ?? 0,
  };
}

export function teamRate(samples: SprintSample[]): TeamRate | null {
  const usable = samples.filter((s) => s.personDays > 0);
  if (usable.length < MIN_SPRINTS_FOR_RATE) return null;
  return {
    sp: band(usable.map((s) => s.completedSp / s.personDays)),
    issues: band(usable.map((s) => s.completedIssues / s.personDays)),
    sprintsUsed: usable.length,
  };
}

export function recommend(
  availablePersonDays: number,
  rate: TeamRate
): { sp: [number, number]; issues: [number, number] } {
  const days = Math.max(0, availablePersonDays);
  return {
    sp: [Math.round(days * rate.sp.p25), Math.round(days * rate.sp.p75)],
    issues: [Math.round(days * rate.issues.p25), Math.round(days * rate.issues.p75)],
  };
}

export function availabilityPct(availablePersonDays: number, members: number): number {
  if (members <= 0) return 0;
  return Math.round((availablePersonDays / (NEXT_SPRINT_WORKING_DAYS * members)) * 100);
}

function loadBand(pct: number): Band {
  return pct <= 85 ? "ok" : pct <= 110 ? "warn" : "over";
}

export function personLoad(
  availableDays: number,
  rate: TeamRate,
  assigned: Units
): { capacity: Units; loadPct: number | null; band: Band } {
  const days = Math.max(0, availableDays);
  const capacity: Units = {
    sp: Math.round(days * rate.sp.p50 * 10) / 10,
    issues: Math.round(days * rate.issues.p50 * 10) / 10,
  };
  const hasWork = assigned.sp > 0 || assigned.issues > 0;
  if (!hasWork) return { capacity, loadPct: 0, band: "ok" };
  if (days === 0) return { capacity, loadPct: null, band: "over" };

  const ratios: number[] = [];
  if (days * rate.sp.p50 > 0) ratios.push(assigned.sp / (days * rate.sp.p50));
  if (days * rate.issues.p50 > 0) ratios.push(assigned.issues / (days * rate.issues.p50));
  if (ratios.length === 0) return { capacity, loadPct: null, band: "over" };
  const loadPct = Math.round(Math.max(...ratios) * 100);
  return { capacity, loadPct, band: loadBand(loadPct) };
}

export function commitmentBand(committed: number, range: [number, number]): Band {
  const max = range[1];
  if (committed <= max) return "ok";
  if (committed <= max * 1.15) return "warn";
  return "over";
}
