import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraSprints,
  getSprintIssues,
  isIssueDone,
  getStoryPoints,
  getCycleTimeDays,
  mapIssueType,
  periodToDays,
  type JiraSprint,
  type JiraIssue,
  isJiraConfigured,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";

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
    totalSprints: number;
    avgVelocity: number;
    avgCompletionRate: number;
    avgCycleTimeDays: number | null;
    totalCompletedStoryPoints: number;
  };
}

async function computeSprintMetrics(
  sprint: JiraSprint,
  sprintIssues: JiraIssue[]
): Promise<SprintMetric> {
  const doneIssues = sprintIssues.filter((i) => isIssueDone(i));
  const totalSp = sprintIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);
  const doneSp = doneIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);

  const breakdown: SprintMetric["breakdown"] = {
    Story: 0, Bug: 0, Task: 0, Epic: 0, Other: 0,
  };
      for (const i of sprintIssues) {
        const mapped = mapIssueType(i.fields.issuetype.name);
        if (mapped in breakdown) {
          breakdown[mapped as keyof typeof breakdown]++;
        } else {
          breakdown.Other++;
        }
      }

  const reopenedCount = sprintIssues.filter((i) => {
    const histories = i.changelog?.histories ?? [];
    const doneItems = histories
      .flatMap((h) => h.items)
      .filter((it) => it.field === "status" && it.toString && /^done$/i.test(it.toString));
    if (doneItems.length === 0) return false;
    // check if any transition after the first done moves out of done
    const idx = histories.findIndex((h) =>
      h.items.some((it) => it.field === "status" && it.toString && /^done$/i.test(it.toString))
    );
    if (idx < 0) return false;
    const postDone = histories.slice(idx + 1);
    return postDone.some((h) =>
      h.items.some((it) => it.field === "status" && it.fromString && /^done$/i.test(it.fromString))
    );
  }).length;

  const cycleTimes = await Promise.all(
    doneIssues.map((i) => getCycleTimeDays(i))
  );
  const validCycleTimes = cycleTimes.filter((t): t is number => t !== null && t >= 0);
  const avgCycleTimeDays = validCycleTimes.length > 0
    ? validCycleTimes.reduce((a, b) => a + b, 0) / validCycleTimes.length
    : null;

  const completedIssues = doneIssues.length;
  const totalIssues = sprintIssues.length;
  const completionRate = totalSp > 0 ? (doneSp / totalSp) * 100 : totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0;

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
    const period = req.params.period ?? "3m";

    const maxSprints = period === "1m" ? 4 : period === "3m" ? 8 : 16;
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
    // Filter by endDate within the period, sort descending, limit to maxSprints
    const filteredSprints = [...sprints]
      .filter((s) => {
        const endDate = s.endDate ? new Date(s.endDate).getTime() : s.completeDate ? new Date(s.completeDate).getTime() : 0;
        return endDate >= startDate.getTime();
      })
      .sort((a, b) => {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : a.completeDate ? new Date(a.completeDate).getTime() : 0;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : b.completeDate ? new Date(b.completeDate).getTime() : 0;
        return bEnd - aEnd;
      })
      .slice(0, maxSprints)
      .reverse();

    if (filteredSprints.length === 0) {
      res.json({ sprints: [], summary: {
        totalSprints: 0, avgVelocity: 0, avgCompletionRate: 0, avgCycleTimeDays: null, totalCompletedStoryPoints: 0,
      } });
      return;
    }

    const sprintMetrics = await Promise.all(
      filteredSprints.map(async (s) => {
        const issues = await getSprintIssues(s.id);
        return computeSprintMetrics(s, issues);
      })
    );

    const doneIssues = sprintMetrics.flatMap((s) => s.completedIssues);
    const totalCompleted = doneIssues.reduce((a, b) => a + b, 0);
    const velocities = sprintMetrics.map((s) => s.velocity);
    const completionRates = sprintMetrics.map((s) => s.completionRate);
    const cycleTimes = sprintMetrics.map((s) => s.avgCycleTimeDays).filter((t): t is number => t !== null);
    const avgCycleTimeDays = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : null;

    const response: SprintMetricsResponse = {
      sprints: sprintMetrics,
      summary: {
        totalSprints: sprintMetrics.length,
        avgVelocity: velocities.length > 0
          ? velocities.reduce((a, b) => a + b, 0) / velocities.length
          : 0,
        avgCompletionRate: completionRates.length > 0
          ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
          : 0,
        avgCycleTimeDays,
        totalCompletedStoryPoints: sprintMetrics.reduce((sum, s) => sum + s.completedStoryPoints, 0),
      },
    };

    res.json(response);
  }
);

export default router;
