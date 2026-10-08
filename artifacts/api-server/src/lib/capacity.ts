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

/** A sprint issue reduced to what capacity needs — keeps this module free of Jira types. */
export interface CapacityIssue {
  key: string;
  accountId: string | null;
  displayName: string | null;
  storyPoints: number;
  /** Done at sprint close (closed sprints) or currently done (active/future). */
  done: boolean;
}

export interface MemberAvailability {
  accountId: string;
  displayName: string;
  absenceDays: number;
  dedicationPct: number;
  included: boolean;
}

export function availableDays(m: MemberAvailability, sprintWorkingDays: number): number {
  if (!m.included) return 0;
  return Math.max(0, (sprintWorkingDays * m.dedicationPct) / 100 - m.absenceDays);
}

/** One closed sprint as a rate sample. Person-days come from the availability saved when the
 *  sprint was planned in Capacity; before Capacity existed, from each distinct assignee counted
 *  full-time. null when it can't be a sample (no dates, or nobody to divide by). */
export function sprintSample(input: {
  startDate?: string;
  endDate?: string;
  issues: CapacityIssue[];
  saved: MemberAvailability[];
}): SprintSample | null {
  if (!input.startDate || !input.endDate) return null;
  const days = workingDays(input.startDate, input.endDate);
  const personDays =
    input.saved.length > 0
      ? input.saved.reduce((sum, m) => sum + availableDays(m, days), 0)
      : days * new Set(input.issues.map((i) => i.accountId).filter((a): a is string => a !== null)).size;
  if (personDays <= 0) return null;
  const done = input.issues.filter((i) => i.done);
  return {
    personDays,
    completedSp: done.reduce((sum, i) => sum + i.storyPoints, 0),
    completedIssues: done.length,
  };
}

export function summarizeAssigned(issues: CapacityIssue[]): {
  byAccount: Map<string, Units>;
  unassigned: Units;
  total: Units;
  unestimated: number;
} {
  const byAccount = new Map<string, Units>();
  const unassigned: Units = { sp: 0, issues: 0 };
  for (const i of issues) {
    const bucket = i.accountId
      ? byAccount.get(i.accountId) ?? byAccount.set(i.accountId, { sp: 0, issues: 0 }).get(i.accountId)!
      : unassigned;
    bucket.sp += i.storyPoints;
    bucket.issues += 1;
  }
  return {
    byAccount,
    unassigned,
    total: { sp: issues.reduce((s, i) => s + i.storyPoints, 0), issues: issues.length },
    unestimated: issues.filter((i) => i.storyPoints <= 0).length,
  };
}

/** Team for the next sprint: what admin saved for it, plus anyone assigned in the recent closed
 *  sprints or in the next sprint itself, with defaults (no absence, 100 %, included). */
export function buildTeam(input: {
  recentIssues: CapacityIssue[];
  nextIssues: CapacityIssue[];
  saved: MemberAvailability[];
}): MemberAvailability[] {
  const team = new Map<string, MemberAvailability>(input.saved.map((m) => [m.accountId, { ...m }]));
  for (const i of [...input.nextIssues, ...input.recentIssues]) {
    if (!i.accountId || team.has(i.accountId)) continue;
    team.set(i.accountId, {
      accountId: i.accountId,
      displayName: i.displayName ?? i.accountId,
      absenceDays: 0,
      dedicationPct: 100,
      included: true,
    });
  }
  return [...team.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}

export interface TeamRow extends MemberAvailability {
  availableDays: number;
  capacity: Units;
  assigned: Units;
  loadPct: number | null;
  band: Band;
}

export function buildTeamRows(
  team: MemberAvailability[],
  byAccount: Map<string, Units>,
  rate: TeamRate | null
): TeamRow[] {
  return team.map((m) => {
    const days = availableDays(m, NEXT_SPRINT_WORKING_DAYS);
    const assigned = byAccount.get(m.accountId) ?? { sp: 0, issues: 0 };
    if (!rate) {
      return { ...m, availableDays: days, capacity: { sp: 0, issues: 0 }, assigned, loadPct: null, band: "ok" as Band };
    }
    return { ...m, availableDays: days, assigned, ...personLoad(days, rate, assigned) };
  });
}

/** Server-side guard for PUT. Returns the first problem as a user-facing (Spanish) message. */
export function validateCapacityRows(rows: MemberAvailability[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.accountId)) return `Persona duplicada: ${r.displayName}`;
    seen.add(r.accountId);
    if (!(r.absenceDays >= 0 && r.absenceDays <= NEXT_SPRINT_WORKING_DAYS)) {
      return `La ausencia de ${r.displayName} debe estar entre 0 y ${NEXT_SPRINT_WORKING_DAYS} días`;
    }
    if (!Number.isInteger(r.dedicationPct) || r.dedicationPct < 0 || r.dedicationPct > 100) {
      return `La dedicación de ${r.displayName} debe ser un entero entre 0 y 100`;
    }
  }
  return null;
}
