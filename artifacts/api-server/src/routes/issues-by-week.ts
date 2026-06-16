import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getJiraIssuesForProject,
  isIssueDone,
  getResolutionDate,
} from "../lib/jira";

const router: IRouter = Router();

router.get(
  "/projects/:projectId/issues-by-week",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId ?? "";
    const week = req.query.week as string;
    const period = (req.query.period as string) ?? "1m";

    if (!week) {
      res.status(400).json({ error: "week query param is required (format: 2026-W03)" });
      return;
    }

    const periodMap: Record<string, number> = { "1m": 30, "3m": 90 };
    const days = periodMap[period] ?? 90;

    const issues = await getJiraIssuesForProject(projectId, days);

    const resolvedWithDates = await Promise.all(
      issues.filter((i) => isIssueDone(i)).map(async (i) => ({
        issue: i,
        resolvedAt: await getResolutionDate(i),
      }))
    );

    const weekIssues = resolvedWithDates
      .filter((r) => {
        if (!r.resolvedAt) return false;
        const isoWeek = getISOWeekSimple(r.resolvedAt);
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

function getISOWeekSimple(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const year = d.getFullYear();
  const week = Math.floor((d.getTime() - new Date(year, 0, 4).getTime()) / 604800000) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export default router;
