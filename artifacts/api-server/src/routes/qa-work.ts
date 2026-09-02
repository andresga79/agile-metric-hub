import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import {
  getOpenIssuesForProject,
  getJiraIssuesForProject,
  getEffectiveIssueType,
  isIssueInProgress,
  isIssueDone,
  getResolutionDate,
  periodToDays,
} from "../lib/jira";
import { KANBAN_EXCLUDED_ISSUE_TYPES } from "../lib/portfolio-metric-settings";

const router: IRouter = Router();

const QA_ISSUE_TYPES: Set<string> = new Set(KANBAN_EXCLUDED_ISSUE_TYPES);

interface QaWorkItem {
  key: string;
  summary: string;
  issueType: string;
  assignee: string | null;
  status: string;
  isInProgress: boolean;
  daysSinceUpdate: number;
}

const STALE_DAYS = 30;

router.get(
  "/projects/:projectId/qa-work/:period",
  requireAuth,
  requireSectionView("qa-work"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
    const period = rawPeriod ?? "1m";

    if (period !== "1m" && period !== "3m") {
      res.status(400).json({ error: "Invalid period. Use 1m or 3m." });
      return;
    }

    // Unbounded by date, like getOpenIssuesForProject's other consumers — a QA item stuck since
    // before this period started still needs to show up here; that's the whole point of this view.
    const openIssues = await getOpenIssuesForProject(projectId as string, { includeChangelog: false });
    const qaOpenIssues = openIssues.filter((i) => QA_ISSUE_TYPES.has(getEffectiveIssueType(i)));

    // Not getResolvedJiraIssuesInRange — that only trusts Jira's `resolutiondate` field, which this
    // project's workflow leaves null on plenty of "Finalizada" Test/Test Execution/Test Plan issues
    // (same quirk documented on getResolutionDate). getResolutionDate falls back to the changelog's
    // done-transition timestamp, so it needs includeChangelog: true here.
    const periodDays = periodToDays(period);
    const periodIssues = await getJiraIssuesForProject(projectId as string, periodDays, { includeChangelog: true });
    const qaResolvedInPeriod = await Promise.all(
      periodIssues
        .filter((i) => QA_ISSUE_TYPES.has(getEffectiveIssueType(i)) && isIssueDone(i))
        .map((i) => getResolutionDate(i))
    );
    const qaResolvedCount = qaResolvedInPeriod.filter((d) => d !== null).length;

    const now = Date.now();
    const items: QaWorkItem[] = qaOpenIssues.map((i) => ({
      key: i.key,
      summary: i.fields.summary,
      issueType: i.fields.issuetype.name,
      assignee: i.fields.assignee?.displayName ?? null,
      status: i.fields.status.name,
      isInProgress: isIssueInProgress(i),
      daysSinceUpdate: Math.round(((now - new Date(i.fields.updated).getTime()) / 86400000) * 10) / 10,
    }));
    items.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

    const inProgressCount = items.filter((i) => i.isInProgress).length;
    const staleCount = items.filter((i) => i.daysSinceUpdate >= STALE_DAYS).length;

    res.json({
      projectId,
      period,
      totalOpen: items.length,
      inProgressCount,
      staleCount,
      staleThresholdDays: STALE_DAYS,
      resolvedInPeriod: qaResolvedCount,
      items,
    });
  }
);

export default router;
