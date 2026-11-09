import type { SprintFacts } from "./types";
import { mean } from "./stats";

export interface PlanningRecommendation {
  basedOn: string[];
  totalSp: number | null;
  totalIssues: number;
  plannedSp: number | null;
  plannedIssues: number;
  marginSp: number | null;
  marginIssues: number;
  unplannedPct: number;
}

/** Capacity to plan next sprint, from the last 3 closed sprints (real closed numbers only). */
export function recommendPlanning(lastClosed: SprintFacts[]): PlanningRecommendation | null {
  if (lastClosed.length !== 3) return null;
  if (lastClosed.some((s) => s.realDoneIssues === null)) return null;

  const spValues = lastClosed.filter((s) => s.basis === "storyPoints" && s.realDoneSp !== null).map((s) => s.realDoneSp as number);
  const meanSp = mean(spValues);
  const meanIssues = mean(lastClosed.map((s) => s.realDoneIssues as number)) as number;
  const unplannedPct = mean(lastClosed.map((s) => s.addedRate)) as number;
  const keep = 1 - unplannedPct / 100;

  const totalIssues = Math.round(meanIssues);
  const plannedIssues = Math.round(meanIssues * keep);
  const totalSp = meanSp === null ? null : Math.round(meanSp);
  const plannedSp = meanSp === null ? null : Math.round(meanSp * keep);

  return {
    basedOn: lastClosed.map((s) => s.name),
    totalSp,
    totalIssues,
    plannedSp,
    plannedIssues,
    marginSp: totalSp === null || plannedSp === null ? null : totalSp - plannedSp,
    marginIssues: totalIssues - plannedIssues,
    unplannedPct,
  };
}
