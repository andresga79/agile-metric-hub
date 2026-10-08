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

export function availabilityPct(
  availablePersonDays: number,
  members: number,
  sprintWorkingDays: number = NEXT_SPRINT_WORKING_DAYS
): number {
  if (members <= 0 || sprintWorkingDays <= 0) return 0;
  return Math.round((availablePersonDays / (sprintWorkingDays * members)) * 100);
}

/** Where an active sprint stands today. Today counts as remaining (the day isn't over), a weekend
 *  as the days from the next Monday on. Without dates, the team's standard 10 days, none elapsed. */
export function sprintClock(
  startDate: string | undefined,
  endDate: string | undefined,
  now: Date
): { workingDays: number; elapsedDays: number; remainingDays: number } {
  if (!startDate || !endDate) {
    return { workingDays: NEXT_SPRINT_WORKING_DAYS, elapsedDays: 0, remainingDays: NEXT_SPRINT_WORKING_DAYS };
  }
  const total = workingDays(startDate, endDate);
  const today = now.toISOString().slice(0, 10);
  const remainingDays = today < startDate.slice(0, 10) ? total : Math.min(total, workingDays(today, endDate));
  return { workingDays: total, elapsedDays: total - remainingDays, remainingDays };
}

/** The recommended range prorated to the share of the sprint already elapsed. */
export function expectedByToday(
  range: { sp: [number, number]; issues: [number, number] },
  elapsedDays: number,
  sprintWorkingDays: number
): { sp: [number, number]; issues: [number, number] } {
  const f = sprintWorkingDays > 0 ? elapsedDays / sprintWorkingDays : 0;
  const scale = ([lo, hi]: [number, number]): [number, number] => [Math.round(lo * f), Math.round(hi * f)];
  return { sp: scale(range.sp), issues: scale(range.issues) };
}

/** Pace of an active sprint: done so far against the low end of what was expected by today. */
export function paceBand(done: number, expected: [number, number]): Band {
  const lo = expected[0];
  if (lo <= 0 || done >= lo) return "ok";
  return done >= lo * 0.85 ? "warn" : "over";
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
  /** Counts for capacity (per project, persistent): only devs do. */
  counts: boolean;
  /** Added by hand in Capacity — no Jira issues yet, synthetic `manual:` accountId. */
  manual: boolean;
}

/** One row of the per-project list of who counts for capacity. */
export interface RosterEntry {
  accountId: string;
  displayName: string;
  counts: boolean;
  manual: boolean;
}

export function availableDays(m: MemberAvailability, sprintWorkingDays: number): number {
  if (!m.counts) return 0;
  return Math.max(0, (sprintWorkingDays * m.dedicationPct) / 100 - m.absenceDays);
}

/** One closed sprint as a rate sample. Person-days = availability saved when the sprint was
 *  planned in Capacity, plus every other assignee of the sprint full-time (someone assigned
 *  mid-sprint delivers, so their days must count too) — minus people who don't count (QA, PO,
 *  leads), who add no days. Completed work is everything done in the sprint, by anyone.
 *  null when it can't be a sample (no dates, or nobody to divide by). */
export function sprintSample(input: {
  startDate?: string;
  endDate?: string;
  issues: CapacityIssue[];
  saved: MemberAvailability[];
  notCounting: Set<string>;
}): SprintSample | null {
  if (!input.startDate || !input.endDate) return null;
  const days = workingDays(input.startDate, input.endDate);
  const savedIds = new Set(input.saved.map((m) => m.accountId));
  const savedDays = input.saved
    .filter((m) => !input.notCounting.has(m.accountId))
    .reduce((sum, m) => sum + availableDays(m, days), 0);
  const unsavedAssignees = new Set(
    input.issues
      .map((i) => i.accountId)
      .filter((a): a is string => a !== null && !savedIds.has(a) && !input.notCounting.has(a))
  );
  const personDays = savedDays + unsavedAssignees.size * days;
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
  doneByAccount: Map<string, Units>;
  unassigned: Units;
  total: Units;
  done: Units;
  unestimated: number;
} {
  const byAccount = new Map<string, Units>();
  const doneByAccount = new Map<string, Units>();
  const unassigned: Units = { sp: 0, issues: 0 };
  const add = (map: Map<string, Units>, id: string, i: CapacityIssue) => {
    const bucket = map.get(id) ?? map.set(id, { sp: 0, issues: 0 }).get(id)!;
    bucket.sp += i.storyPoints;
    bucket.issues += 1;
  };
  for (const i of issues) {
    if (i.accountId) {
      add(byAccount, i.accountId, i);
      if (i.done) add(doneByAccount, i.accountId, i);
    } else {
      unassigned.sp += i.storyPoints;
      unassigned.issues += 1;
    }
  }
  const done = issues.filter((i) => i.done);
  return {
    byAccount,
    doneByAccount,
    unassigned,
    total: { sp: issues.reduce((s, i) => s + i.storyPoints, 0), issues: issues.length },
    done: { sp: done.reduce((s, i) => s + i.storyPoints, 0), issues: done.length },
    unestimated: issues.filter((i) => i.storyPoints <= 0).length,
  };
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

/** A person in the Capacity list. `recent` = part of the next sprint's team (assigned in the last
 *  closed, active or next sprint, or added by hand). People only seen in older sprints are listed
 *  too — they add days to the historical rate, so an admin must be able to say they don't count —
 *  but they add no availability to the next sprint. */
export type TeamMember = MemberAvailability & { recent: boolean };

/** Team for the Capacity list: everyone on the project's roster plus every assignee of the recent
 *  sprints and of the history window. A manual entry whose name matches a Jira assignee is
 *  replaced by that assignee (keeping its counts flag), so one person is never counted twice.
 *  Availability for this sprint comes from `saved`. Next-sprint devs first, then the rest. */
export function buildTeam(input: {
  roster: RosterEntry[];
  recentIssues: CapacityIssue[];
  historyIssues?: CapacityIssue[];
  saved: MemberAvailability[];
}): TeamMember[] {
  const names = new Map<string, string>();
  for (const i of [...input.recentIssues, ...(input.historyIssues ?? [])]) {
    if (i.accountId && !names.has(i.accountId)) names.set(i.accountId, i.displayName ?? i.accountId);
  }
  const recentIds = new Set(input.recentIssues.map((i) => i.accountId).filter((a): a is string => a !== null));
  const idByName = new Map([...names].map(([id, name]) => [normalizeName(name), id]));

  const people = new Map<string, RosterEntry>();
  for (const r of input.roster) {
    const jiraId = r.manual ? idByName.get(normalizeName(r.displayName)) : undefined;
    if (jiraId) {
      if (!input.roster.some((o) => o.accountId === jiraId)) {
        people.set(jiraId, { accountId: jiraId, displayName: names.get(jiraId)!, counts: r.counts, manual: false });
      }
      continue;
    }
    people.set(r.accountId, { ...r });
  }
  for (const [id, name] of names) {
    if (!people.has(id)) people.set(id, { accountId: id, displayName: name, counts: true, manual: false });
  }

  const saved = new Map(input.saved.map((m) => [m.accountId, m]));
  const rank = (m: TeamMember) => (m.recent && m.counts ? 0 : 1);
  return [...people.values()]
    .map((p) => ({
      ...p,
      recent: p.manual || recentIds.has(p.accountId),
      absenceDays: saved.get(p.accountId)?.absenceDays ?? 0,
      dedicationPct: saved.get(p.accountId)?.dedicationPct ?? 100,
    }))
    .sort((a, b) => rank(a) - rank(b) || Number(b.counts) - Number(a.counts) || a.displayName.localeCompare(b.displayName, "es"));
}

export interface TeamRow extends MemberAvailability {
  availableDays: number;
  capacity: Units;
  assigned: Units;
  done: Units;
  loadPct: number | null;
  band: Band;
}

/** The sprint the rows are for. Next sprint: the team's 10 days, nothing done. Active sprint:
 *  its real working days, how many are left, and what each person already finished — load is then
 *  what is still open against the remaining share of their availability (absences are spread
 *  evenly: we don't know which days they fall on). */
export interface RowsSprint {
  workingDays: number;
  remainingDays?: number;
  done?: Map<string, Units>;
}

export function buildTeamRows(
  team: Array<MemberAvailability & { recent?: boolean }>,
  byAccount: Map<string, Units>,
  rate: TeamRate | null,
  sprint: RowsSprint = { workingDays: NEXT_SPRINT_WORKING_DAYS }
): Array<TeamRow & { recent: boolean }> {
  const share = sprint.remainingDays === undefined || sprint.workingDays <= 0 ? 1 : sprint.remainingDays / sprint.workingDays;
  return team.map((m) => {
    const recent = m.recent ?? true;
    const days = recent ? availableDays(m, sprint.workingDays) : 0;
    const assigned = byAccount.get(m.accountId) ?? { sp: 0, issues: 0 };
    const done = sprint.done?.get(m.accountId) ?? { sp: 0, issues: 0 };
    // No capacity to measure load against: not counting, not in the sprint's team, or no rate yet.
    if (!rate || !m.counts || !recent) {
      return { ...m, recent, availableDays: days, capacity: { sp: 0, issues: 0 }, assigned, done, loadPct: null, band: "ok" as Band };
    }
    const open = { sp: assigned.sp - done.sp, issues: assigned.issues - done.issues };
    return { ...m, recent, availableDays: days, assigned, done, ...personLoad(days * share, rate, open) };
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
