import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraSprints,
  getSprintIssues,
  isIssueDone,
  getStoryPoints,
  getCycleTimeDays,
  getStatusCategoryMap,
  mapIssueType,
  getEffectiveIssueType,
  periodToDays,
  type JiraSprint,
  type JiraIssue,
  isJiraConfigured,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";

const router: IRouter = Router();

interface SprintMetric {
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
  breakdown: {
    Story: number;
    Bug: number;
    Task: number;
    Epic: number;
    Other: number;
  };
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
    totalCompletedStoryPoints: number;
    // How many sprints actually fell inside the period, before capping to maxSprints below —
    // lets the UI say "showing N of M" instead of silently dropping older sprints.
    totalSprintsInPeriod: number;
  };
}

// Counts issues that were marked "done" at some point and later moved back out of done — a real
// quality signal (premature "done", QA bounce-back). The previous version matched status
// transitions against a literal /^done$/i regex, ignoring both Jira's own statusCategory and the
// multi-language "done" names isIssueDone() already knows about (listo, terminado, resuelto,
// cerrado...) — it only ever worked by coincidence on projects whose done column is named "Done".
async function countReopenedIssues(issues: JiraIssue[]): Promise<number> {
  const categoryMap = await getStatusCategoryMap();
  const isDoneStatusName = (name: string | null | undefined): boolean => {
    if (!name) return false;
    const trimmed = name.trim();
    const category = categoryMap.get(trimmed.toLowerCase());
    if (category) return category === "done";
    return /^(done|listo|terminado|finalizada|cerrado|resuelto|closed|resolved)$/i.test(trimmed);
  };

  return issues.filter((issue) => {
    const statusTransitions = (issue.changelog?.histories ?? [])
      .map((h) => ({ at: new Date(h.created).getTime(), items: h.items.filter((it) => it.field === "status") }))
      .filter((h) => h.items.length > 0)
      .sort((a, b) => a.at - b.at);

    let sawDone = false;
    for (const transition of statusTransitions) {
      for (const item of transition.items) {
        if (sawDone && isDoneStatusName(item.fromString) && !isDoneStatusName(item.toString)) {
          return true;
        }
        if (isDoneStatusName(item.toString)) {
          sawDone = true;
        }
      }
    }
    return false;
  }).length;
}

async function computeSprintMetrics(
  sprint: JiraSprint,
  sprintIssues: JiraIssue[],
  allowedIssueTypes: string[]
): Promise<SprintMetric> {
  const filtered = sprintIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
  const doneIssues = filtered.filter((i) => isIssueDone(i));
  const totalSp = filtered.reduce((sum, i) => sum + getStoryPoints(i), 0);
  const doneSp = doneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);

  const breakdown: SprintMetric["breakdown"] = {
    Story: 0, Bug: 0, Task: 0, Epic: 0, Other: 0,
  };
      for (const i of filtered) {
        const mapped = mapIssueType(i.fields.issuetype.name);
        if (mapped in breakdown) {
          breakdown[mapped as keyof typeof breakdown]++;
        } else {
          breakdown.Other++;
        }
      }

  const reopenedCount = await countReopenedIssues(filtered);

  const cycleTimes = await Promise.all(
    doneIssues.map((i) => getCycleTimeDays(i))
  );
  const validCycleTimes = cycleTimes.filter((t): t is number => t !== null && t >= 0);
  const avgCycleTimeDays = validCycleTimes.length > 0
    ? validCycleTimes.reduce((a, b) => a + b, 0) / validCycleTimes.length
    : null;

  const completedIssues = doneIssues.length;
  const totalIssues = filtered.length;
  const completionBasis: SprintMetric["completionBasis"] = totalSp > 0 ? "storyPoints" : "issueCount";
  const completionRate = completionBasis === "storyPoints"
    ? (doneSp / totalSp) * 100
    : totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0;

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
    breakdown,
  };
}

router.get(
  "/projects/:projectId/sprints/:period",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const period = req.params.period ?? "1m";

    const maxSprints = period === "1m" ? 4 : 8;
    const periodDays = periodToDays(period as any);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

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
    // Sprints within the period, newest first, before capping to maxSprints below.
    const sprintsInPeriod = [...sprints]
      .filter((s) => {
        const endDate = s.endDate ? new Date(s.endDate).getTime() : s.completeDate ? new Date(s.completeDate).getTime() : 0;
        return endDate >= startDate.getTime();
      })
      .sort((a, b) => {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : a.completeDate ? new Date(a.completeDate).getTime() : 0;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : b.completeDate ? new Date(b.completeDate).getTime() : 0;
        return bEnd - aEnd;
      });
    const filteredSprints = sprintsInPeriod.slice(0, maxSprints).reverse();

    if (filteredSprints.length === 0) {
      res.json({ sprints: [], summary: {
        totalSprints: 0, avgVelocity: 0, avgCompletionRate: 0, avgCycleTimeDays: null,
        totalCompletedStoryPoints: 0, totalSprintsInPeriod: sprintsInPeriod.length,
      } });
      return;
    }

    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
    const sprintMetrics = await Promise.all(
      filteredSprints.map(async (s) => {
        const issues = await getSprintIssues(s.id);
        return computeSprintMetrics(s, issues, allowedIssueTypes);
      })
    );

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
        totalCompletedStoryPoints: closedMetrics.reduce((sum, s) => sum + s.completedStoryPoints, 0),
        totalSprintsInPeriod: sprintsInPeriod.length,
      },
    };

    res.json(response);
  }
);

export default router;
