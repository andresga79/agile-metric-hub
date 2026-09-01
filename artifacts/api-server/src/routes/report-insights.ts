import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import {
  getJiraSprints,
  getSprintIssues,
  getProjectBoardType,
  getResolvedJiraIssuesInRange,
  getEffectiveIssueType,
  getStoryPoints,
  type JiraIssue,
} from "../lib/jira";
import { computeSprintMetrics } from "./sprint-metrics";
import { computePeriodMetrics } from "./analytics";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { getEffectiveThresholds } from "../lib/health-thresholds";
import {
  detectCompletionDrop,
  detectThresholdCrossing,
  buildNextSteps,
  type CompletionDropInsight,
  type ThresholdCrossingInsight,
} from "../lib/report-insights";
import { getProjectReleaseReadiness } from "./release-readiness";

const router: IRouter = Router();

router.get(
  "/projects/:projectId/sprint-goal",
  requireAuth,
  requireSectionView("sprints", "report"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;

    const boardType = await getProjectBoardType(projectId);
    if (boardType !== "scrum") {
      res.json(null);
      return;
    }

    const sprints = await getJiraSprints(projectId, 50);
    const active = sprints.find((s) => s.state === "active");
    if (!active || !active.goal || active.goal.trim() === "") {
      res.json(null);
      return;
    }

    res.json({ sprintName: active.name, goal: active.goal.trim() });
  }
);

router.get(
  "/projects/:projectId/report-insights",
  requireAuth,
  requireSectionView("report"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const insights: (CompletionDropInsight | ThresholdCrossingInsight)[] = [];
    let activeSprintForNextSteps: { sprintName: string; completionRate: number; endDate: string | null } | null = null;

    // --- Completion drop between the last two closed sprints ---
    const boardType = await getProjectBoardType(projectId);
    if (boardType === "scrum") {
      const sprints = await getJiraSprints(projectId, 50);
      const relevant = [...sprints]
        .filter((s) => s.state === "closed" || s.state === "active")
        .sort((a, b) => {
          const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
          const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
          return aEnd - bEnd;
        })
        .slice(-3);

      if (relevant.length >= 2) {
        const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
        const summaries = await Promise.all(
          relevant.map(async (s) => {
            const issues = await getSprintIssues(s.id);
            const metric = await computeSprintMetrics(s, issues, allowedIssueTypes, sprints);
            return { name: s.name, state: s.state as "closed" | "active", completionRate: metric.completionRate };
          })
        );
        const drop = detectCompletionDrop(summaries);
        if (drop) insights.push(drop);

        const active = summaries.find((s) => s.state === "active");
        if (active) {
          const activeRaw = sprints.find((s) => s.name === active.name);
          activeSprintForNextSteps = {
            sprintName: active.name,
            completionRate: active.completionRate,
            endDate: activeRaw?.endDate ?? null,
          };
        }
      }
    }

    // --- Cycle/lead time threshold crossing (current 1m vs previous 1m) ---
    const periodDays = 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);
    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();

    const currentIssues = await getResolvedJiraIssuesInRange(projectId, periodDays, 0, { includeChangelog: true }).catch(
      () => [] as JiraIssue[]
    );
    const prevStart = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const prevIssues = await getResolvedJiraIssuesInRange(projectId, periodDays * 2, periodDays, {
      includeChangelog: true,
    }).catch(() => [] as JiraIssue[]);

    const currentFiltered = currentIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
    const prevFiltered = prevIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));

    if (currentFiltered.length > 0 && prevFiltered.length > 0) {
      const current = await computePeriodMetrics(currentFiltered, startDate);
      const previous = await computePeriodMetrics(prevFiltered, prevStart, startDate);
      const thresholds = await getEffectiveThresholds(projectId);

      const cycleCrossing = detectThresholdCrossing(
        "cycleTime", current.avgCycleTime, previous.avgCycleTime, thresholds["cycleTime"]
      );
      if (cycleCrossing) insights.push(cycleCrossing);

      const leadCrossing = detectThresholdCrossing(
        "leadTime", current.avgLeadTime, previous.avgLeadTime, thresholds["leadTime"]
      );
      if (leadCrossing) insights.push(leadCrossing);
    }

    // --- Featured functionality: top resolved issues by story points this period ---
    const featuredIssues = currentFiltered
      .map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        assignee: i.fields.assignee?.displayName ?? null,
        storyPoints: getStoryPoints(i),
      }))
      .filter((i) => i.storyPoints > 0)
      .sort((a, b) => b.storyPoints - a.storyPoints)
      .slice(0, 4);

    // --- Next steps: insights + active sprint progress + release readiness ---
    const releaseReadiness = await getProjectReleaseReadiness(projectId);
    const releaseEpicsPendingCount = releaseReadiness.configured
      ? releaseReadiness.epics.filter((e) => e.statusCategory !== "done").length
      : 0;

    const nextSteps = buildNextSteps({
      activeSprint: activeSprintForNextSteps,
      insights,
      releaseReadinessConfigured: releaseReadiness.configured,
      releaseEpicsPendingCount,
    });

    res.json({ insights, nextSteps, featuredIssues });
  }
);

export default router;
