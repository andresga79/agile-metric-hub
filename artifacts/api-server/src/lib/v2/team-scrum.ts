import type { EffectiveThreshold } from "../health-thresholds";
import type { TimeInStatusEntry, WipAgingItem } from "../flow-insights";
import { median } from "../stats";
import { buildFlowBlock } from "./flow-block";
import { recommendPlanning } from "./planning";
import { scrumAttention } from "./attention";
import { mean, sampleStdDev, pctChange, ppChange, predictabilityBand } from "./stats";
import type { ScrumTeamView, SprintFacts, TrendRow } from "./types";

export interface ScrumTeamViewInput {
  project: { id: string; key: string; name: string };
  windowSprints: 3 | 6 | 12;
  display: SprintFacts[];
  recent: SprintFacts[];
  previous: SprintFacts[];
  active: SprintFacts | null;
  nextSprintName: string | null;
  timeInStatus: TimeInStatusEntry[];
  wipAging: WipAgingItem[];
  thresholds: Record<string, EffectiveThreshold>;
}

const DEFAULT_PREDICTABILITY = { goodValue: 8, warningValue: 12 };

const realRates = (s: SprintFacts[]): number[] => s.flatMap((x) => (x.realRate === null ? [] : [x.realRate]));
const pooled = (s: SprintFacts[], pick: (x: SprintFacts) => number[]): number[] => s.flatMap(pick);

function closedSpMean(s: SprintFacts[]): number | null {
  return mean(s.filter((x) => x.basis === "storyPoints" && x.realDoneSp !== null).map((x) => x.realDoneSp as number));
}
function closedIssuesMean(s: SprintFacts[]): number | null {
  return mean(s.filter((x) => x.realDoneIssues !== null).map((x) => x.realDoneIssues as number));
}

function buildTrends(recent: SprintFacts[], previous: SprintFacts[]): TrendRow[] {
  const hasPrev = previous.length > 0;
  const row = (
    key: TrendRow["key"],
    unit: TrendRow["unit"],
    betterWhen: TrendRow["betterWhen"],
    calc: (s: SprintFacts[]) => number | null,
  ): TrendRow => {
    const after = calc(recent);
    const before = hasPrev ? calc(previous) : null;
    const delta = unit === "pp" ? ppChange(before, after) : pctChange(before, after);
    return { key, before, after, delta, unit, betterWhen };
  };
  return [
    row("realRate", "pp", "up", (s) => mean(realRates(s))),
    row("closedSp", "%", "up", closedSpMean),
    row("closedIssues", "%", "up", closedIssuesMean),
    row("cycleMedian", "%", "down", (s) => median(pooled(s, (x) => x.cycleTimes))),
    row("leadMedian", "%", "down", (s) => median(pooled(s, (x) => x.leadTimes))),
    row("addedRate", "pp", "down", (s) => mean(s.map((x) => x.addedRate))),
    row("carryoverRate", "pp", "down", (s) => mean(s.map((x) => x.carryoverRate))),
  ];
}

export function buildScrumTeamView(input: ScrumTeamViewInput): ScrumTeamView {
  const { project, windowSprints, display, recent, previous, active, nextSprintName, thresholds } = input;

  const rates = realRates(display);
  const avgRealRate = mean(rates);
  const stdDevPp = sampleStdDev(rates);
  const band = predictabilityBand(stdDevPp, thresholds.sprintPredictability ?? DEFAULT_PREDICTABILITY);
  const deltaPp = previous.length > 0 ? ppChange(mean(realRates(previous)), mean(realRates(recent))) : null;

  const trends = buildTrends(recent, previous);
  const cycleDelta = trends.find((t) => t.key === "cycleMedian")?.delta ?? null;

  const closed = display.filter((s) => s.state === "closed");
  const last3 = closed.slice(-3);

  return {
    boardType: "scrum",
    projectId: project.id,
    projectKey: project.key,
    projectName: project.name,
    windowSprints,
    sprints: display,
    active,
    nextSprintName,
    compliance: {
      avgRealRate,
      deltaPp,
      stdDevPp,
      band,
      minRate: rates.length ? Math.min(...rates) : null,
      maxRate: rates.length ? Math.max(...rates) : null,
    },
    flow: buildFlowBlock(pooled(display, (x) => x.cycleTimes), pooled(display, (x) => x.leadTimes), cycleDelta, input.timeInStatus, input.wipAging),
    planning: last3.length === 3 ? recommendPlanning(last3) : null,
    trends,
    attention: scrumAttention(avgRealRate, band, thresholds),
    generatedAt: new Date().toISOString(),
  };
}
