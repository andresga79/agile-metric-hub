import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraSprints,
  getSprintIssues,
  isIssueDone,
  isNonDeliveryClosure,
  getStoryPoints,
  getCycleTimeDays,
  countReopenedIssues,
  isCarryoverIssue,
  isAddedAfterPlanning,
  sprintCloseTime,
  wasIssueDoneAt,
  getStatusCategoryMap,
  getEffectiveIssueType,
  type JiraSprint,
  type JiraIssue,
  isJiraConfigured,
} from "../lib/jira";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { sprintDeliveryTimes } from "../lib/sprint-delivery-times";

const router: IRouter = Router();

export interface SprintMetric {
  sprintId: number;
  sprintName: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  totalIssues: number;
  totalStoryPoints: number;
  completedIssues: number;
  completedStoryPoints: number;
  completionRate: number;
  // Which base completionRate was computed on. Falls back to issue-count when the sprint has no
  // story points logged — a rate computed one way isn't comparable to one computed the other way,
  // so the UI needs to be able to say which is which instead of showing two bare percentages.
  completionBasis: "storyPoints" | "issueCount";
  velocity: number;
  reopenedCount: number;
  avgCycleTimeDays: number | null;
  /** Median cycle time of the issues DELIVERED in this sprint's window (sprintDeliveryTimes):
   *  same number as the Métricas tab. avgCycleTimeDays (mean over the sprint's own
   *  issues) stays for compatibility. Null until the route fills it in. */
  medianCycleTimeDays: number | null;
  /** How many delivered issues medianCycleTimeDays is over. 0 until the route fills it in. */
  cycleSampleSize: number;
  // Issues already tagged with an earlier, already-closed sprint (per Jira's Sprint field
  // history) that slipped into this one — work that didn't finish on time, not new scope.
  carryoverCount: number;
  carryoverStoryPoints: number;
  carryoverRate: number;
  // Issues that entered the sprint after its planning (end of day 1) - unplanned scope.
  addedAfterPlanningCount: number;
  addedAfterPlanningStoryPoints: number;
  addedAfterPlanningKeys: string[];
  // The plan: the scope minus what entered after planning (what was in the sprint at the end of
  // day 1). "Comprometido" used to be the final scope, which counted mid-sprint additions as if
  // the team had committed to them.
  plannedIssues: number;
  plannedStoryPoints: number;
  /** Done now (like completionRate) over the planned issues only. Null with nothing planned. */
  plannedCompletionRate: number | null;
  // "% real cerrado": what was already done at the moment the sprint closed (wasIssueDoneAt), as
  // opposed to completed* above, which is the current status (cumulative, like Rovo). Null for a
  // sprint that hasn't closed yet. Same scope (filtered issues) and same SP/issue-count basis.
  closedAtSprintEndIssues: number | null;
  closedAtSprintEndStoryPoints: number | null;
  closedAtSprintEndRate: number | null;
  /** "% real cerrado sobre planificado": planned issues done at close over the plan, same basis.
   *  Null while the sprint is not closed, or with nothing planned. */
  closedAtSprintEndPlannedIssues: number | null;
  closedAtSprintEndPlannedStoryPoints: number | null;
  closedAtSprintEndPlannedRate: number | null;
  goal: string | null;
}

interface SprintMetricsResponse {
  sprints: SprintMetric[];
  summary: {
    // Count of CLOSED sprints the averages below are computed from — an active sprint is, by
    // definition, not finished yet, so folding its partial completion/velocity into these averages
    // makes a normal in-progress sprint look like a decline. sprints.length (all sprints returned,
    // including any active one) may be one higher than this.
    totalSprints: number;
    avgVelocity: number;
    avgCompletionRate: number;
    avgCycleTimeDays: number | null;
    /** Median cycle time over every issue delivered inside the closed sprints of the window. */
    medianCycleTimeDays: number | null;
    totalCompletedStoryPoints: number;
    // Rows returned (last N closed + the one in progress). Kept for compatibility: the window is
    // now a sprint count, so nothing is cut off anymore.
    totalSprintsInPeriod: number;
  };
}

/** The issues that make up a sprint's scope: the issue types allowed in Admin, minus
 *  cancellations / backlog cleanups that are already closed (isNonDeliveryClosure). OLI's board
 *  doesn't treat "Cancelado" as done, so Jira carries each one into every following sprint and it
 *  was "completed" in all of them (OLI-3629: sprints 46-49). Shared by the Sprints table and the
 *  report insights so both count the same issues. */
export async function sprintScopeIssues(
  sprintIssues: JiraIssue[],
  allowedIssueTypes: string[]
): Promise<JiraIssue[]> {
  const typed = sprintIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
  const nonDelivery = await Promise.all(typed.map((i) => isNonDeliveryClosure(i)));
  return typed.filter((i, idx) => !(nonDelivery[idx] && isIssueDone(i)));
}

export async function computeSprintMetrics(
  sprint: JiraSprint,
  sprintIssues: JiraIssue[],
  allowedIssueTypes: string[],
  allSprints: JiraSprint[]
): Promise<SprintMetric> {
  // Completed = done in Jira NOW, the same rule as Jira's Rovo sprint summaries (decided
  // 2026-11-06 so the Sprints tab matches what the team reads in Rovo). Trade-off accepted on
  // purpose: an issue carried over and finished in a later sprint counts as completed in every
  // sprint it passed through. wasIssueDoneAt keeps the "done at sprint close" alternative.
  const doneAtClose = (i: JiraIssue): boolean => isIssueDone(i);

  const filtered = await sprintScopeIssues(sprintIssues, allowedIssueTypes);
  const doneIssues = filtered.filter(doneAtClose);
  const totalSp = filtered.reduce((sum, i) => sum + getStoryPoints(i), 0);
  const doneSp = doneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);

  const reopenedCount = await countReopenedIssues(filtered);

  const carryoverIssues = filtered.filter((i) => isCarryoverIssue(i, allSprints, sprint));
  const carryoverCount = carryoverIssues.length;
  const carryoverStoryPoints = carryoverIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);

  const addedAfterPlanning = filtered.filter((i) => isAddedAfterPlanning(i, sprint));
  const addedKeys = new Set(addedAfterPlanning.map((i) => i.key));
  const planned = filtered.filter((i) => !addedKeys.has(i.key));
  const plannedSp = planned.reduce((sum, i) => sum + getStoryPoints(i), 0);

  const cycleTimes = await Promise.all(
    doneIssues.map((i) => getCycleTimeDays(i))
  );
  const validCycleTimes = cycleTimes.filter((t): t is number => t !== null && t >= 0);
  const avgCycleTimeDays = validCycleTimes.length > 0
    ? validCycleTimes.reduce((a, b) => a + b, 0) / validCycleTimes.length
    : null;

  const closeTime = sprintCloseTime(sprint);
  let closedAtSprintEndIssues: number | null = null;
  let closedAtSprintEndStoryPoints: number | null = null;
  let closedAtSprintEndPlannedIssues: number | null = null;
  let closedAtSprintEndPlannedStoryPoints: number | null = null;
  if (closeTime) {
    const categoryMap = await getStatusCategoryMap();
    const doneAtEnd = filtered.filter((i) => wasIssueDoneAt(i, closeTime, categoryMap));
    closedAtSprintEndIssues = doneAtEnd.length;
    closedAtSprintEndStoryPoints = doneAtEnd.reduce((sum, i) => sum + getStoryPoints(i), 0);
    const plannedDoneAtEnd = doneAtEnd.filter((i) => !addedKeys.has(i.key));
    closedAtSprintEndPlannedIssues = plannedDoneAtEnd.length;
    closedAtSprintEndPlannedStoryPoints = plannedDoneAtEnd.reduce((sum, i) => sum + getStoryPoints(i), 0);
  }

  const completedIssues = doneIssues.length;
  const totalIssues = filtered.length;
  const completionBasis: SprintMetric["completionBasis"] = totalSp > 0 ? "storyPoints" : "issueCount";
  const completionRate = completionBasis === "storyPoints"
    ? (doneSp / totalSp) * 100
    : totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0;

  // Over the plan, on the sprint's basis. Null with nothing planned on that basis (a sprint whose
  // whole scope entered after planning has no plan to measure).
  const plannedRate = (issues: number, sp: number): number | null =>
    completionBasis === "storyPoints"
      ? plannedSp > 0 ? (sp / plannedSp) * 100 : null
      : planned.length > 0 ? (issues / planned.length) * 100 : null;
  const plannedDoneNow = planned.filter(doneAtClose);

  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    state: sprint.state,
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    totalIssues,
    totalStoryPoints: totalSp,
    completedIssues,
    completedStoryPoints: doneSp,
    completionRate,
    completionBasis,
    velocity: doneSp,
    reopenedCount,
    avgCycleTimeDays,
    medianCycleTimeDays: null,
    cycleSampleSize: 0,
    carryoverCount,
    carryoverStoryPoints,
    carryoverRate: totalSp > 0 ? (carryoverStoryPoints / totalSp) * 100 : 0,
    addedAfterPlanningCount: addedAfterPlanning.length,
    addedAfterPlanningStoryPoints: addedAfterPlanning.reduce((sum, i) => sum + getStoryPoints(i), 0),
    addedAfterPlanningKeys: addedAfterPlanning.map((i) => i.key),
    plannedIssues: planned.length,
    plannedStoryPoints: plannedSp,
    plannedCompletionRate: plannedRate(
      plannedDoneNow.length,
      plannedDoneNow.reduce((sum, i) => sum + getStoryPoints(i), 0)
    ),
    closedAtSprintEndIssues,
    closedAtSprintEndStoryPoints,
    closedAtSprintEndRate:
      closedAtSprintEndIssues === null || closedAtSprintEndStoryPoints === null
        ? null
        : completionBasis === "storyPoints"
          ? (closedAtSprintEndStoryPoints / totalSp) * 100
          : totalIssues > 0 ? (closedAtSprintEndIssues / totalIssues) * 100 : 0,
    closedAtSprintEndPlannedIssues,
    closedAtSprintEndPlannedStoryPoints,
    closedAtSprintEndPlannedRate:
      closedAtSprintEndPlannedIssues === null || closedAtSprintEndPlannedStoryPoints === null
        ? null
        : plannedRate(closedAtSprintEndPlannedIssues, closedAtSprintEndPlannedStoryPoints),
    goal: sprint.goal?.trim() || null,
  };
}

const WINDOW_CLOSED_SPRINTS: Record<string, number> = { "2s": 2, "6s": 6 };

const sprintEnd = (s: JiraSprint): number => {
  const raw = s.endDate ?? s.completeDate ?? null;
  return raw ? new Date(raw).getTime() : 0;
};

/** The Sprints page's cadence, the same as Composición del sprint (resolveSprintWindowDays): the
 *  last `closedCount` CLOSED sprints by end date, oldest first, then the sprint(s) in progress as
 *  their own rows. Future sprints never. */
export function selectSprintWindow(sprints: JiraSprint[], closedCount: number): JiraSprint[] {
  const closed = sprints
    .filter((s) => s.state === "closed")
    .sort((a, b) => sprintEnd(b) - sprintEnd(a))
    .slice(0, closedCount)
    .reverse();
  const active = sprints
    .filter((s) => s.state === "active")
    .sort((a, b) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime());
  return [...closed, ...active];
}

router.get(
  "/projects/:projectId/sprints/:period",
  requireAuth,
  requireSectionView("sprints", "report"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const closedCount = WINDOW_CLOSED_SPRINTS[String(req.params.period)];
    if (!closedCount) {
      res.status(400).json({ error: "period debe ser '2s' o '6s'" });
      return;
    }

    const jiraProject = await getJiraProject(projectId);
    if (!jiraProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const boardType = await getProjectBoardType(projectId);
    if (boardType !== "scrum") {
      res.status(400).json({ error: "Sprint metrics only available for Scrum projects" });
      return;
    }

    const sprints = await getJiraSprints(projectId, 50);
    const filteredSprints = selectSprintWindow(sprints, closedCount);

    if (filteredSprints.length === 0) {
      res.json({ sprints: [], summary: {
        totalSprints: 0, avgVelocity: 0, avgCompletionRate: 0, avgCycleTimeDays: null, medianCycleTimeDays: null,
        totalCompletedStoryPoints: 0, totalSprintsInPeriod: 0,
      } });
      return;
    }

    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
    const [scopeMetrics, deliveryTimes] = await Promise.all([
      Promise.all(
        filteredSprints.map(async (s) => {
          const issues = await getSprintIssues(s.id);
          return computeSprintMetrics(s, issues, allowedIssueTypes, sprints);
        })
      ),
      sprintDeliveryTimes(projectId, filteredSprints),
    ]);
    const sprintMetrics = scopeMetrics.map((m) => ({
      ...m,
      medianCycleTimeDays: deliveryTimes.perSprint.get(m.sprintId)?.cycle ?? null,
      cycleSampleSize: deliveryTimes.perSprint.get(m.sprintId)?.cycleCount ?? 0,
    }));

    // Averages only reflect CLOSED sprints — an active sprint is partway through its timebox by
    // definition, so its still-climbing completion/velocity numbers would otherwise drag the
    // average down and read as a decline that isn't real.
    const closedMetrics = sprintMetrics.filter((s) => s.state === "closed");
    const velocities = closedMetrics.map((s) => s.velocity);
    const completionRates = closedMetrics.map((s) => s.completionRate);
    const cycleTimes = closedMetrics.map((s) => s.avgCycleTimeDays).filter((t): t is number => t !== null);
    const avgCycleTimeDays = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : null;

    const response: SprintMetricsResponse = {
      sprints: sprintMetrics,
      summary: {
        totalSprints: closedMetrics.length,
        avgVelocity: velocities.length > 0
          ? velocities.reduce((a, b) => a + b, 0) / velocities.length
          : 0,
        avgCompletionRate: completionRates.length > 0
          ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
          : 0,
        avgCycleTimeDays,
        medianCycleTimeDays: deliveryTimes.closedPooled.cycle,
        totalCompletedStoryPoints: closedMetrics.reduce((sum, s) => sum + s.completedStoryPoints, 0),
        totalSprintsInPeriod: sprintMetrics.length,
      },
    };

    res.json(response);
  }
);

export default router;
