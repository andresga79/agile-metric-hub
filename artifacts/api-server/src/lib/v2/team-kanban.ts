import type { EffectiveThreshold } from "../health-thresholds";
import type { TimeInStatusEntry, WipAgingItem } from "../flow-insights";
import { isoWeekStart } from "../iso-week";
import { median } from "../stats";
import { kanbanAttention } from "./attention";
import { buildFlowBlock } from "./flow-block";
import { mean, pctChange } from "./stats";
import type { DeliveredIssue, KanbanTeamView, TrendRow, WeekBucket } from "./types";

export interface KanbanTeamViewInput {
  project: { id: string; key: string; name: string };
  windowDays: 30 | 90 | 180;
  current: DeliveredIssue[];
  previous: DeliveredIssue[];
  timeInStatus: TimeInStatusEntry[];
  wipAging: WipAgingItem[];
  thresholds: Record<string, EffectiveThreshold>;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const nonNull = (v: (number | null)[]): number[] => v.filter((x): x is number => x !== null);

function buildWeeks(current: DeliveredIssue[], windowDays: number, now: Date): WeekBucket[] {
  const buckets = new Map<string, DeliveredIssue[]>();
  const first = new Date(`${isoWeekStart(new Date(now.getTime() - windowDays * DAY_MS))}T00:00:00Z`);
  const last = isoWeekStart(now);
  for (let d = first; isoWeekStart(d) <= last; d = new Date(d.getTime() + 7 * DAY_MS)) {
    buckets.set(isoWeekStart(d), []);
  }
  for (const i of current) buckets.get(isoWeekStart(new Date(i.resolvedAt)))?.push(i);
  return [...buckets.entries()].map(([weekStart, items]) => ({
    weekStart,
    historia: items.filter((i) => i.type === "historia").length,
    tecnico: items.filter((i) => i.type === "tecnico").length,
    bug: items.filter((i) => i.type === "bug").length,
    cycleAvg: mean(nonNull(items.map((i) => i.cycleDays))),
    leadAvg: mean(nonNull(items.map((i) => i.leadDays))),
  }));
}

export function buildKanbanTeamView(input: KanbanTeamViewInput): KanbanTeamView {
  const { project, windowDays, current, previous, thresholds, now } = input;
  const deliveredDeltaPct = pctChange(previous.length, current.length);
  const medianOf = (s: DeliveredIssue[], k: "cycleDays" | "leadDays") => median(nonNull(s.map((i) => i[k])));

  const row = (key: TrendRow["key"], betterWhen: TrendRow["betterWhen"], before: number | null, after: number | null): TrendRow => ({
    key, before, after, delta: pctChange(before, after), unit: "%", betterWhen,
  });
  const trends: TrendRow[] = [
    row("closedIssues", "up", previous.length, current.length),
    row("cycleMedian", "down", medianOf(previous, "cycleDays"), medianOf(current, "cycleDays")),
    row("leadMedian", "down", medianOf(previous, "leadDays"), medianOf(current, "leadDays")),
  ];
  const cycleDelta = trends[1]!.delta;

  return {
    boardType: "kanban",
    projectId: project.id,
    projectKey: project.key,
    projectName: project.name,
    windowDays,
    delivered: current.length,
    deliveredPrevious: previous.length,
    deliveredDeltaPct,
    byWeek: buildWeeks(current, windowDays, now),
    flow: buildFlowBlock(
      nonNull(current.map((i) => i.cycleDays)),
      nonNull(current.map((i) => i.leadDays)),
      cycleDelta,
      input.timeInStatus,
      input.wipAging,
    ),
    trends,
    attention: kanbanAttention(deliveredDeltaPct, cycleDelta, thresholds),
    generatedAt: now.toISOString(),
  };
}
