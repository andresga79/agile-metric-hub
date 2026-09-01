import { classify, type EffectiveThreshold, type HealthBand } from "./health-thresholds";

export interface ClosedSprintSummary {
  name: string;
  state: "closed" | "active";
  completionRate: number;
}

export interface CompletionDropInsight {
  type: "completionDrop";
  previousSprintName: string;
  previousCompletionRate: number;
  currentSprintName: string;
  currentCompletionRate: number;
  dropPoints: number;
}

// A drop this large between two consecutive closed sprints is worth surfacing in a
// monthly report even without knowing *why* it happened - it's a concrete number the
// PO/SM can bring to retro, not a diagnosis.
const COMPLETION_DROP_THRESHOLD_POINTS = 15;

export function detectCompletionDrop(sprints: ClosedSprintSummary[]): CompletionDropInsight | null {
  const closed = sprints.filter((s) => s.state === "closed");
  if (closed.length < 2) return null;

  const [previous, current] = closed.slice(-2);
  const dropPoints = previous!.completionRate - current!.completionRate;
  if (dropPoints <= COMPLETION_DROP_THRESHOLD_POINTS) return null;

  return {
    type: "completionDrop",
    previousSprintName: previous!.name,
    previousCompletionRate: previous!.completionRate,
    currentSprintName: current!.name,
    currentCompletionRate: current!.completionRate,
    dropPoints,
  };
}

export interface ThresholdCrossingInsight {
  type: "thresholdCrossing";
  metric: "cycleTime" | "leadTime";
  previousValue: number;
  currentValue: number;
  fromBand: HealthBand;
  toBand: HealthBand;
}

export function detectThresholdCrossing(
  metric: "cycleTime" | "leadTime",
  currentValue: number | null,
  previousValue: number | null,
  threshold: EffectiveThreshold | undefined
): ThresholdCrossingInsight | null {
  if (currentValue === null || previousValue === null || !threshold) return null;

  const fromBand = classify(previousValue, threshold, "lowerBetter");
  const toBand = classify(currentValue, threshold, "lowerBetter");
  if (toBand !== "critical" || fromBand === "critical") return null;

  return {
    type: "thresholdCrossing",
    metric,
    previousValue,
    currentValue,
    fromBand,
    toBand,
  };
}

export interface StructuralBottleneck {
  type: "structuralBottleneck";
  status: string;
  avgDays: number;
  issueCount: number;
  sharePercent: number;
}

// A status only counts as a "structural bottleneck" (worth a sentence in the report) if it
// both dominates the weighted flow time AND has enough issues behind it - a single outlier
// issue stuck for months would otherwise look like a systemic problem.
const BOTTLENECK_MIN_SHARE_PERCENT = 51;
const BOTTLENECK_MIN_ISSUE_COUNT = 3;

export function detectStructuralBottleneck(
  timeInStatus: { status: string; avgDays: number; issueCount: number }[]
): StructuralBottleneck | null {
  if (timeInStatus.length === 0) return null;

  const weighted = timeInStatus.map((s) => ({ ...s, weight: s.avgDays * s.issueCount }));
  const totalWeight = weighted.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight <= 0) return null;

  const top = weighted.reduce((max, s) => (s.weight > max.weight ? s : max));
  const sharePercent = (top.weight / totalWeight) * 100;

  if (sharePercent < BOTTLENECK_MIN_SHARE_PERCENT) return null;
  if (top.issueCount < BOTTLENECK_MIN_ISSUE_COUNT) return null;

  return {
    type: "structuralBottleneck",
    status: top.status,
    avgDays: top.avgDays,
    issueCount: top.issueCount,
    sharePercent,
  };
}
