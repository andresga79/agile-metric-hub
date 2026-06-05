import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraIssuesForProject,
  isIssueDone,
  getStoryPoints,
  getCycleTimeDays,
  getResolutionDate,
  periodToDays,
  mapIssueType,
  type JiraIssue,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

interface WeekMetric {
  weekStart: string;
  weekLabel: string;
  totalIssues: number;
  totalStoryPoints: number;
  avgCycleTimeDays: number | null;
  reopenedCount: number;
  breakdown: {
    Story: number;
    Bug: number;
    Task: number;
    Epic: number;
    Other: number;
  };
}

interface KanbanMetricsResponse {
  weeks: WeekMetric[];
  summary: {
    totalWeeks: number;
    avgThroughput: number;
    avgCycleTimeDays: number | null;
    totalCompletedIssues: number;
    totalCompletedStoryPoints: number;
  };
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0]!;
}

function formatWeekLabel(weekStartStr: string): string {
  const start = new Date(weekStartStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${months[start.getMonth()]} ${start.getDate()} - ${months[end.getMonth()]} ${end.getDate()}`;
}

router.get(
  "/projects/:projectId/kanban/:period",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const period = req.params.period ?? "3m";

    const jiraProject = await getJiraProject(projectId);
    if (!jiraProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const boardType = await getProjectBoardType(projectId);
    if (boardType === "scrum") {
      res.status(400).json({ error: "Kanban metrics only available for non-Scrum projects" });
      return;
    }

    const periodDays = periodToDays(period);
    const maxWeeks = period === "1m" ? 4 : period === "3m" ? 13 : 26;

    const issues = await getJiraIssuesForProject(projectId, periodDays);
    const doneIssues = issues.filter((i) => isIssueDone(i));

    // Generate week buckets for the entire period, even if no issues were done
    const emptyWeeks: WeekMetric[] = [];
    const now = new Date();
    for (let i = 0; i < maxWeeks; i++) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1 - i * 7);
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split("T")[0]!;
      emptyWeeks.push({
        weekStart: weekStartStr,
        weekLabel: formatWeekLabel(weekStartStr),
        totalIssues: 0,
        totalStoryPoints: 0,
        avgCycleTimeDays: null,
        reopenedCount: 0,
        breakdown: { Story: 0, Bug: 0, Task: 0, Epic: 0, Other: 0 },
      });
    }
    emptyWeeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    if (doneIssues.length === 0) {
      const response: KanbanMetricsResponse = {
        weeks: emptyWeeks,
        summary: {
          totalWeeks: emptyWeeks.length,
          avgThroughput: 0,
          avgCycleTimeDays: null,
          totalCompletedIssues: 0,
          totalCompletedStoryPoints: 0,
        },
      };
      res.json(response);
      return;
    }

    // Get resolution dates for all done issues
    const resolvedDates = await Promise.all(
      doneIssues.map(async (issue) => ({
        issue,
        resolvedAt: await getResolutionDate(issue),
      }))
    );

    const withResolved = resolvedDates.filter(
      (r): r is { issue: JiraIssue; resolvedAt: Date } => r.resolvedAt !== null
    );

    // Group by ISO week
    const weekMap = new Map<string, JiraIssue[]>();
    for (const { issue, resolvedAt } of withResolved) {
      const weekStart = getWeekStart(resolvedAt);
      const existing = weekMap.get(weekStart) ?? [];
      existing.push(issue);
      weekMap.set(weekStart, existing);
    }

    // Compute metrics per week and merge into emptyWeeks
    for (const [weekStart, weekIssues] of weekMap) {
      const totalSp = weekIssues.reduce((sum, i) => sum + getStoryPoints(i), 0);

      const breakdown: WeekMetric["breakdown"] = {
        Story: 0, Bug: 0, Task: 0, Epic: 0, Other: 0,
      };
      for (const i of weekIssues) {
        const mapped = mapIssueType(i.fields.issuetype.name);
        if (mapped in breakdown) {
          breakdown[mapped as keyof typeof breakdown]++;
        } else {
          breakdown.Other++;
        }
      }

      const cycleTimes = await Promise.all(
        weekIssues.map((i) => getCycleTimeDays(i))
      );
      const validCycleTimes = cycleTimes.filter((t): t is number => t !== null && t >= 0);
      const avgCycleTimeDays = validCycleTimes.length > 0
        ? validCycleTimes.reduce((a, b) => a + b, 0) / validCycleTimes.length
        : null;

      const reopenedCount = weekIssues.filter((i) => {
        const histories = i.changelog?.histories ?? [];
        const idx = histories.findIndex((h) =>
          h.items.some((it) => it.field === "status" && it.toString && /^done$/i.test(it.toString))
        );
        if (idx < 0) return false;
        const postDone = histories.slice(idx + 1);
        return postDone.some((h) =>
          h.items.some((it) => it.field === "status" && it.fromString && /^done$/i.test(it.fromString))
        );
      }).length;

      const idx = emptyWeeks.findIndex((w) => w.weekStart === weekStart);
      if (idx >= 0) {
        emptyWeeks[idx] = {
          weekStart,
          weekLabel: formatWeekLabel(weekStart),
          totalIssues: weekIssues.length,
          totalStoryPoints: totalSp,
          avgCycleTimeDays,
          reopenedCount,
          breakdown,
        };
      } else {
        emptyWeeks.push({
          weekStart,
          weekLabel: formatWeekLabel(weekStart),
          totalIssues: weekIssues.length,
          totalStoryPoints: totalSp,
          avgCycleTimeDays,
          reopenedCount,
          breakdown,
        });
      }
    }

    const recent = emptyWeeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-maxWeeks);

    const throughputs = recent.map((w) => w.totalIssues);
    const cycleTimes = recent.map((w) => w.avgCycleTimeDays).filter((t): t is number => t !== null);
    const avgCycleTimeDays = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : null;

    const response: KanbanMetricsResponse = {
      weeks: recent,
      summary: {
        totalWeeks: recent.length,
        avgThroughput: throughputs.length > 0
          ? throughputs.reduce((a, b) => a + b, 0) / throughputs.length
          : 0,
        avgCycleTimeDays,
        totalCompletedIssues: recent.reduce((sum, w) => sum + w.totalIssues, 0),
        totalCompletedStoryPoints: recent.reduce((sum, w) => sum + w.totalStoryPoints, 0),
      },
    };

    res.json(response);
  }
);

export default router;
