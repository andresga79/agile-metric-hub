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
  getEffectiveIssueType,
  type JiraIssue,
} from "../lib/jira";
import {
  getPortfolioAllowedIssueTypes,
  KANBAN_EXCLUDED_ISSUE_TYPES,
} from "../lib/portfolio-metric-settings";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();
const KANBAN_EXCLUDED_ISSUE_TYPES_SET: Set<string> = new Set(KANBAN_EXCLUDED_ISSUE_TYPES);

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
  debug?: {
    doneIssuesCount: number;
    resolvedCount: number;
    allDates: string[];
    weekBreakdown: Array<{ week: string; count: number }>;
  };
}

function getISOWeek(date: Date): { year: number; week: number; weekStart: string } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Use same ISO calculation as analytics.ts for consistency
  const temp = new Date(d.valueOf());
  temp.setDate(temp.getDate() + 3 - ((temp.getDay() + 6) % 7));
  const year = temp.getFullYear();
  const week = Math.floor((temp.getTime() - new Date(year, 0, 4).getTime()) / 604800000) + 1;
  
  // Calculate Monday of this ISO week: subtract days since Monday
  // dayNum: 0=Monday, 1=Tuesday, ..., 6=Sunday
  const dayNum = (d.getDay() + 6) % 7;
  const monday = new Date(d.valueOf());
  monday.setDate(monday.getDate() - dayNum);
  const weekStartStr = monday.toISOString().split("T")[0]!;
  
  return { year, week, weekStart: weekStartStr };
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
    const period = Array.isArray(req.params.period)
      ? req.params.period[0]
      : (req.params.period ?? "1m");

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
    const maxWeeks = period === "1m" ? 5 : 13;

    const issues = await getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true });
    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
    const uniqueIssues = Array.from(new Map(issues.map((i) => [i.key, i])).values());
    const filteredIssues = uniqueIssues.filter((i) => {
      const issueType = getEffectiveIssueType(i);
      return allowedIssueTypes.includes(issueType) && !KANBAN_EXCLUDED_ISSUE_TYPES_SET.has(issueType);
    });
    const doneIssues = filteredIssues.filter((i) => isIssueDone(i));

    // Generate week buckets using ISO weeks for consistency with analytics
    const emptyWeeks: WeekMetric[] = [];
    const now = new Date();
    const startISO = getISOWeek(new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000));
    const endISO = getISOWeek(now);
    
    let currentDate = new Date(startISO.weekStart);
    while (currentDate <= new Date(endISO.weekStart)) {
      const weekStartStr = currentDate.toISOString().split("T")[0]!;
      emptyWeeks.push({
        weekStart: weekStartStr,
        weekLabel: formatWeekLabel(weekStartStr),
        totalIssues: 0,
        totalStoryPoints: 0,
        avgCycleTimeDays: null,
        reopenedCount: 0,
        breakdown: { Story: 0, Bug: 0, Task: 0, Epic: 0, Other: 0 },
      });
      currentDate.setDate(currentDate.getDate() + 7);
    }

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

    // DEBUG: Log all resolution dates
    const allResolutionDates = withResolved.map(r => r.resolvedAt.toISOString().split("T")[0]);
    console.log(`DEBUG kanban: ${withResolved.length} issues with resolution dates:`, allResolutionDates.slice(0, 20));

    // Group by ISO week
    const weekMap = new Map<string, JiraIssue[]>();
    for (const { issue, resolvedAt } of withResolved) {
      const isoInfo = getISOWeek(resolvedAt);
      const weekStart = isoInfo.weekStart;
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
      debug: {
        doneIssuesCount: doneIssues.length,
        resolvedCount: withResolved.length,
        allDates: allResolutionDates,
        weekBreakdown: Array.from(weekMap.entries()).map(([week, issues]) => ({ week, count: issues.length })),
      },
    };

    res.json(response);
  }
);

export default router;
