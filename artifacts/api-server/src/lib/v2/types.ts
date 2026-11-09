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
