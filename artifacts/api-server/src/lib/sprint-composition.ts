import { percentileRounded } from "./stats";

// Composición del sprint por tipo de trabajo (spec: docs/superpowers/specs/2026-11-13-sprint-composition-design.md).
// Pure: the route gathers the sprint issues and the delivered issues from Jira and passes them in.

export interface CompositionIssue {
  key: string;
  /** getEffectiveIssueType(issue): Story, Bug, Task, Spike, Tech Debt, ... */
  category: string;
  storyPoints: number;
  /** Done when its sprint closed (wasIssueDoneAt) — "% real cerrado". */
  doneAtClose: boolean;
  /** Entered the sprint after planning (isAddedAfterPlanning). */
  addedAfterPlanning: boolean;
}

export interface CompositionSprintInput {
  sprintId: number;
  sprintName: string;
  issues: CompositionIssue[];
}

/** An issue delivered inside one of the window's closed sprints, for cycle time. */
export interface CompositionDelivered {
  key: string;
  category: string;
  cycleTimeDays: number | null;
}

export interface SprintCompositionRow {
  category: string;
  issueShare: number;
  issuesPerSprint: number;
  storyPointsPerSprint: number;
  realClosedRate: number | null;
  cycleP50: number | null;
  cycleP85: number | null;
  addedAfterPlanningRate: number;
  addedAfterPlanningPerSprint: number;
}

export interface SprintCompositionSprint {
  sprintId: number;
  sprintName: string;
  totalIssues: number;
  /** % of this sprint's issues per category. */
  shares: Record<string, number>;
}

export interface SprintComposition {
  sprintCount: number;
  totalIssues: number;
  rows: SprintCompositionRow[];
  sprints: SprintCompositionSprint[];
}

export const CATEGORY_ORDER = ["Story", "Bug", "Task", "Spike", "Tech Debt"] as const;

/** Fewer delivered issues than this → no P50/P85 ("—"). */
const MIN_DELIVERED_FOR_PERCENTILES = 3;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const pct = (part: number, whole: number): number => (whole > 0 ? round1((part / whole) * 100) : 0);

/** % of `total` for each count, to 1 decimal, adding up to exactly 100 (largest remainder): each
 *  share rounded on its own can add up to 100.1 or 99.9, which reads as a bug on a stacked bar. */
function sharesTo100(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const tenths = counts.map((c) => (c / total) * 1000);
  const floored = tenths.map(Math.floor);
  let missing = 1000 - floored.reduce((a, b) => a + b, 0);
  const byRemainder = tenths.map((t, i) => ({ i, r: t - floored[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (missing <= 0) break;
    floored[i] += 1;
    missing -= 1;
  }
  return floored.map((t) => t / 10);
}

function compareCategories(a: string, b: string): number {
  const order = CATEGORY_ORDER as readonly string[];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a.localeCompare(b);
}

export function buildSprintComposition(
  sprints: CompositionSprintInput[],
  delivered: CompositionDelivered[]
): SprintComposition {
  const sprintCount = sprints.length;
  const all = sprints.flatMap((s) => s.issues);
  const totalIssues = all.length;

  // A carried-over issue is in several sprints' scope but delivered once: one cycle time per key.
  const cycleByCategory = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const d of delivered) {
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    if (d.cycleTimeDays === null) continue;
    const list = cycleByCategory.get(d.category) ?? [];
    list.push(d.cycleTimeDays);
    cycleByCategory.set(d.category, list);
  }

  const categories = [...new Set(all.map((i) => i.category))].sort(compareCategories);
  const shares = sharesTo100(
    categories.map((category) => all.filter((i) => i.category === category).length),
    totalIssues
  );
  const rows: SprintCompositionRow[] = categories.map((category, idx) => {
    const issues = all.filter((i) => i.category === category);
    const added = issues.filter((i) => i.addedAfterPlanning).length;
    const cycles = cycleByCategory.get(category) ?? [];
    const enough = cycles.length >= MIN_DELIVERED_FOR_PERCENTILES;
    return {
      category,
      issueShare: shares[idx],
      issuesPerSprint: round1(issues.length / sprintCount),
      storyPointsPerSprint: round1(issues.reduce((sum, i) => sum + i.storyPoints, 0) / sprintCount),
      realClosedRate: issues.length > 0 ? pct(issues.filter((i) => i.doneAtClose).length, issues.length) : null,
      cycleP50: enough ? percentileRounded(cycles, 0.5) : null,
      cycleP85: enough ? percentileRounded(cycles, 0.85) : null,
      addedAfterPlanningRate: pct(added, issues.length),
      addedAfterPlanningPerSprint: round1(added / sprintCount),
    };
  });

  const perSprint: SprintCompositionSprint[] = sprints.map((s) => {
    const present = categories.filter((category) => s.issues.some((i) => i.category === category));
    const values = sharesTo100(
      present.map((category) => s.issues.filter((i) => i.category === category).length),
      s.issues.length
    );
    const sprintShares: Record<string, number> = Object.fromEntries(present.map((c, idx) => [c, values[idx]]));
    return { sprintId: s.sprintId, sprintName: s.sprintName, totalIssues: s.issues.length, shares: sprintShares };
  });

  return { sprintCount, totalIssues, rows, sprints: perSprint };
}
