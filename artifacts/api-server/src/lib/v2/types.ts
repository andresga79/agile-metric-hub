import type { WipAgingItem } from "../flow-insights";
import type { PredictabilityBand } from "./stats";
import type { PlanningRecommendation } from "./planning";

export type CompletionBasis = "storyPoints" | "issueCount";

/** Per-sprint base every v2 view (team, portfolio) is computed from. */
export interface SprintFacts {
  sprintId: number;
  name: string;
  state: "closed" | "active";
  startDate: string | null;
  endDate: string | null;
  closeDate: string | null;
  basis: CompletionBasis;
  committedSp: number;
  committedIssues: number;
  rovoDoneSp: number;
  rovoDoneIssues: number;
  rovoRate: number; // Done hoy
  realDoneSp: number | null;
  realDoneIssues: number | null;
  realRate: number | null; // null if not closed
  addedSp: number;
  addedIssues: number;
  addedRate: number; // after planning, % of committed (basis)
  carryoverSp: number;
  carryoverRate: number; // % of committed (basis)
  deliveredByType: { historia: number; tecnico: number; bug: number }; // done at close (active: done now)
  cycleTimes: number[];
  leadTimes: number[]; // of delivered issues, non-null only
}

export interface TrendRow {
  key: "realRate" | "closedSp" | "closedIssues" | "cycleMedian" | "leadMedian" | "addedRate" | "carryoverRate";
  before: number | null;
  after: number | null;
  delta: number | null;
  unit: "pp" | "%";
  betterWhen: "up" | "down";
}

export interface TimeInStatusRow {
  status: string;
  avgDays: number;
  waiting: boolean;
}

export interface FlowBlock {
  cycleMedian: number | null;
  cycleP85: number | null;
  cycleMedianDeltaPct: number | null;
  leadMedian: number | null;
  leadP85: number | null;
  flowEfficiencyPct: number | null;
  timeInStatus: TimeInStatusRow[];
  wip: { total: number; aged: WipAgingItem[] };
}

export interface ScrumTeamView {
  boardType: "scrum";
  projectId: string;
  projectKey: string;
  projectName: string;
  windowSprints: 3 | 6 | 12;
  sprints: SprintFacts[];
  active: SprintFacts | null;
  nextSprintName: string | null;
  compliance: {
    avgRealRate: number | null;
    deltaPp: number | null;
    stdDevPp: number | null;
    band: PredictabilityBand | null;
    minRate: number | null;
    maxRate: number | null;
  };
  flow: FlowBlock;
  planning: PlanningRecommendation | null;
  trends: TrendRow[];
  attention: string[];
  generatedAt: string;
}
