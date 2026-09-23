import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { isoWeekLabel } from "../lib/iso-week";
import {
  getJiraIssuesForProject,
  getProjectBoardType,
  getEffectiveIssueType,
  isIssueDone,
  getResolutionDate,
  isValidPeriodOrSprintWindow,
  resolvePeriodDays,
} from "../lib/jira";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";

const router: IRouter = Router();

router.get(
  "/projects/:projectId/issues-by-week",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : (req.params.projectId ?? "");
    const week = req.query.week as string;
    const period = (req.query.period as string) ?? "1m";

    if (!week) {
      res.status(400).json({ error: "week query param is required (format: 2026-W03)" });
      return;
    }

    if (!isValidPeriodOrSprintWindow(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m, 3m, or Ns (e.g. 2s, 6s) for Scrum projects." });
      return;
    }

    // Scope issues exactly like the Analytics throughput chart this drill-down opens from
    // (routes/analytics.ts): same period/sprint-window resolution, same allowed issue types,
    // same dedup and resolved-in-window bounds. Without this, clicking a week showing 24 issues
    // listed 127 (Test Executions and other excluded types, plus a 90-day fallback for 2s/6s).
    const boardType = await getProjectBoardType(projectId);
    const resolvedWindow = await resolvePeriodDays(projectId, period, boardType);
    if ("error" in resolvedWindow) {
      res.status(400).json({ error: resolvedWindow.error });
      return;
    }
    const { periodDays, windowStart, windowEnd } = resolvedWindow;
    const startDate = windowStart ?? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const [issues, allowedIssueTypes] = await Promise.all([
      // includeChangelog matches the analytics fetch, so this reuses its cache entry.
      getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true }),
      getPortfolioAllowedIssueTypes(),
    ]);
    const uniqueIssues = Array.from(new Map(issues.map((i) => [i.key, i])).values()).filter((i) =>
      allowedIssueTypes.includes(getEffectiveIssueType(i))
    );

    const resolvedWithDates = await Promise.all(
      uniqueIssues.filter((i) => isIssueDone(i)).map(async (i) => ({
        issue: i,
        resolvedAt: await getResolutionDate(i),
      }))
    );

    const weekIssues = resolvedWithDates
      .filter((r) => {
        if (!r.resolvedAt || r.resolvedAt < startDate || (windowEnd && r.resolvedAt >= windowEnd)) return false;
        const isoWeek = isoWeekLabel(r.resolvedAt);
        return isoWeek === week;
      })
      .map((r) => ({
        key: r.issue.key,
        summary: r.issue.fields.summary,
        issueType: r.issue.fields.issuetype.name,
        priority: r.issue.fields.priority.name,
        status: r.issue.fields.status.name,
        assignee: r.issue.fields.assignee?.displayName ?? null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      }));

    res.json({ week, issues: weekIssues });
  }
);

export default router;
