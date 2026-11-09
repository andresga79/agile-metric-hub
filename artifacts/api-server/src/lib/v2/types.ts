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

/** Admin → Health values behind the v2 colours and copy (sprintCompletionReal, sprintPredictability). */
export interface V2Thresholds {
  completionGood: number;
  completionWarning: number;
  predictabilityGood: number;
  predictabilityWarning: number;
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
  thresholds: V2Thresholds;
  generatedAt: string;
}

export interface DeliveredIssue {
  key: string;
  resolvedAt: string;
  type: "historia" | "tecnico" | "bug";
  cycleDays: number | null;
  leadDays: number | null;
}

export interface WeekBucket {
  weekStart: string;
  historia: number;
  tecnico: number;
  bug: number;
  cycleAvg: number | null;
  leadAvg: number | null;
}

export interface KanbanTeamView {
  boardType: "kanban";
  projectId: string;
  projectKey: string;
  projectName: string;
  windowDays: 30 | 90 | 180;
  delivered: number;
  deliveredPrevious: number;
  deliveredDeltaPct: number | null;
  byWeek: WeekBucket[];
  flow: FlowBlock;
  trends: TrendRow[];
  attention: string[];
  thresholds: V2Thresholds;
  generatedAt: string;
}

export type TeamView = ScrumTeamView | KanbanTeamView;

export interface PortfolioRow {
  projectId: string;
  projectKey: string;
  projectName: string;
  boardType: "scrum" | "kanban";
  avgRealRate: number | null;
  realDeltaPp: number | null;
  band: PredictabilityBand | null;
  minRate: number | null;
  maxRate: number | null;
  cycleMedian: number | null;
  cycleMedianDeltaPct: number | null;
  delivered: number | null;
  deliveredDeltaPct: number | null;
  addedRate: number | null;
  carryoverRate: number | null;
  attention: string[];
  reading: string;
  /** The project's effective thresholds its band/attention follow; null on an error row. */
  thresholds: V2Thresholds | null;
  error: string | null;
}

export interface PortfolioView {
  windowSprints: 3 | 6 | 12;
  rows: PortfolioRow[];
  summary: {
    scrumAvgRealRate: number | null;
    scrumRates: { projectName: string; rate: number }[];
    improving: number;
    scrumTeams: number;
    attention: { projectName: string; reasons: string[] }[];
  };
  headline: string;
  /** Global thresholds (no project override), for the portfolio's explanatory copy. */
  thresholds: V2Thresholds;
  generatedAt: string;
}
