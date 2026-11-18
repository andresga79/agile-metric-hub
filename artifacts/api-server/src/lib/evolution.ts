import { percentileRounded } from "./stats";
import type { JiraSprint } from "./jira";
import type { SprintMetric } from "../routes/sprint-metrics";

/** Bump when a rule behind any persisted number changes, so old rows can be told apart. */
export const FORMULA_VERSION = 1;

const TZ = "America/Santiago";
const P50_MIN_N = 3;
const P85_MIN_N = 5;

export interface EvolutionDelivery {
  issueKey: string;
  issueType: string;
  deliveredAt: Date;
  leadDays: number | null;
  cycleDays: number | null;
  storyPoints: number;
  assigneeId: string | null;
  sprintId: number | null;
}

export interface SprintWindow {
  sprintId: number;
  start: Date;
  close: Date;
}

export interface TimeSummary {
  n: number;
  p50: number | null;
  p85: number | null;
  avg: number | null;
}

export interface EvolutionSprintRow {
  projectId: string;
  sprintId: number;
  sprintName: string;
  startAt: Date;
  closedAt: Date;
  scopeIssues: number;
  scopeSp: number;
  plannedIssues: number;
  addedIssues: number;
  carryoverIssues: number;
  closedAtEndIssues: number;
  closedAtEndSp: number;
  realClosedPct: number | null;
  rovoPct: number;
  delivered: number;
  deliveredSp: number;
  people: number;
  ct: TimeSummary;
  lt: TimeSummary;
  formulaVersion: number;
}

export interface PeriodRow {
  period: string;
  sprints: number;
  realClosedPct: number | null;
  delivered: number;
  deliveredSp: number;
  people: number;
  ct: TimeSummary;
  lt: TimeSummary;
}

export interface ComparisonSide {
  sprints: number;
  realClosedMean: number | null;
  realClosedStdevPp: number | null;
  ctP85: number | null;
  ctN: number;
  ltP50: number | null;
  ltN: number;
  deliveredPerPersonPerSprint: number | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** P50 needs n >= 3 and P85 n >= 5 to mean anything; the average only needs one value. */
export function summarizeTimes(values: number[]): TimeSummary {
  const n = values.length;
  return {
    n,
    p50: n >= P50_MIN_N ? percentileRounded(values, 0.5) : null,
    p85: n >= P85_MIN_N ? percentileRounded(values, 0.85) : null,
    avg: n > 0 ? round1(values.reduce((a, b) => a + b, 0) / n) : null,
  };
}

/** Sprint whose window [start, close) contains the delivery; null in the gaps between sprints. */
export function assignDeliverySprint(deliveredAt: Date, windows: SprintWindow[]): number | null {
  const t = deliveredAt.getTime();
  const w = windows.find((x) => t >= x.start.getTime() && t < x.close.getTime());
  return w ? w.sprintId : null;
}

/** Drops sprints that belong to another board (shared sprints); keeps those with no origin. */
export function ownSprints<T extends { originBoardId?: number }>(sprints: T[], boardId: number | null): T[] {
  if (boardId === null) return sprints;
  return sprints.filter((s) => s.originBoardId === undefined || s.originBoardId === boardId);
}

const nums = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const distinctPeople = (ds: EvolutionDelivery[]) =>
  new Set(ds.map((d) => d.assigneeId).filter((a): a is string => a !== null)).size;

export function buildSprintRow(
  projectId: string,
  sprint: JiraSprint,
  metric: SprintMetric,
  deliveries: EvolutionDelivery[],
): EvolutionSprintRow {
  const closedAtEndIssues = metric.closedAtSprintEndIssues ?? 0;
  const closeRaw = sprint.completeDate ?? sprint.endDate;
  return {
    projectId,
    sprintId: sprint.id,
    sprintName: sprint.name,
    startAt: new Date(sprint.startDate as string),
    closedAt: new Date(closeRaw as string),
    scopeIssues: metric.totalIssues,
    scopeSp: metric.totalStoryPoints,
    plannedIssues: metric.plannedIssues,
    addedIssues: metric.addedAfterPlanningCount,
    carryoverIssues: metric.carryoverCount,
    closedAtEndIssues,
    closedAtEndSp: metric.closedAtSprintEndStoryPoints ?? 0,
    realClosedPct: metric.totalIssues > 0 ? round1((closedAtEndIssues / metric.totalIssues) * 100) : null,
    rovoPct: round1(metric.completionRate),
    delivered: deliveries.length,
    deliveredSp: deliveries.reduce((a, d) => a + d.storyPoints, 0),
    people: distinctPeople(deliveries),
    ct: summarizeTimes(nums(deliveries.map((d) => d.cycleDays))),
    lt: summarizeTimes(nums(deliveries.map((d) => d.leadDays))),
    formulaVersion: FORMULA_VERSION,
  };
}

const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" });

function periodOf(d: Date, by: "month" | "quarter"): string {
  const parts = monthFmt.formatToParts(d);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return by === "month" ? `${year}-${String(month).padStart(2, "0")}` : `${year}-Q${Math.ceil(month / 3)}`;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function meanPct(rows: EvolutionSprintRow[]): number | null {
  const m = mean(nums(rows.map((r) => r.realClosedPct)));
  return m === null ? null : round1(m);
}

/** Months/quarters in Santiago. Sprints count in the period they closed; deliveries in the one they happened. */
export function aggregateByPeriod(
  rows: EvolutionSprintRow[],
  deliveries: EvolutionDelivery[],
  by: "month" | "quarter",
): PeriodRow[] {
  const sprintsBy = new Map<string, EvolutionSprintRow[]>();
  const deliveriesBy = new Map<string, EvolutionDelivery[]>();
  for (const r of rows) {
    const k = periodOf(r.closedAt, by);
    sprintsBy.set(k, [...(sprintsBy.get(k) ?? []), r]);
  }
  for (const d of deliveries) {
    const k = periodOf(d.deliveredAt, by);
    deliveriesBy.set(k, [...(deliveriesBy.get(k) ?? []), d]);
  }
  const periods = [...new Set([...sprintsBy.keys(), ...deliveriesBy.keys()])].sort();
  return periods.map((period) => {
    const rs = sprintsBy.get(period) ?? [];
    const ds = deliveriesBy.get(period) ?? [];
    return {
      period,
      sprints: rs.length,
      realClosedPct: meanPct(rs),
      delivered: ds.length,
      deliveredSp: ds.reduce((a, d) => a + d.storyPoints, 0),
      people: distinctPeople(ds),
      ct: summarizeTimes(nums(ds.map((d) => d.cycleDays))),
      lt: summarizeTimes(nums(ds.map((d) => d.leadDays))),
    };
  });
}

function sampleStdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1);
  return round1(Math.sqrt(variance));
}

function side(rows: EvolutionSprintRow[], deliveries: EvolutionDelivery[]): ComparisonSide {
  const ids = new Set(rows.map((r) => r.sprintId));
  const ds = deliveries.filter((d) => d.sprintId !== null && ids.has(d.sprintId));
  const ct = summarizeTimes(nums(ds.map((d) => d.cycleDays)));
  const lt = summarizeTimes(nums(ds.map((d) => d.leadDays)));
  const perPerson = mean(rows.filter((r) => r.people > 0).map((r) => r.delivered / r.people));
  const pcts = nums(rows.map((r) => r.realClosedPct));
  return {
    sprints: rows.length,
    realClosedMean: meanPct(rows),
    realClosedStdevPp: sampleStdev(pcts),
    ctP85: ct.p85,
    ctN: ct.n,
    ltP50: lt.p50,
    ltN: lt.n,
    deliveredPerPersonPerSprint: perPerson === null ? null : round1(perPerson),
  };
}

/** "Before" = sprints that started before the milestone sprint; times are pooled, not averaged percentiles. */
export function compareAroundMilestone(
  rows: EvolutionSprintRow[],
  deliveries: EvolutionDelivery[],
  milestoneSprintStart: Date,
): { before: ComparisonSide; after: ComparisonSide } {
  const cut = milestoneSprintStart.getTime();
  return {
    before: side(rows.filter((r) => r.startAt.getTime() < cut), deliveries),
    after: side(rows.filter((r) => r.startAt.getTime() >= cut), deliveries),
  };
}
