import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getJiraIssuesForProject,
  periodToDays,
  isIssueDone,
} from "../lib/jira";

const router: IRouter = Router();

router.post(
  "/projects/:projectId/predictive-forecast",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId ?? "";
    const { remainingIssues, windowWeeks = 12 } = req.body as { remainingIssues?: number; windowWeeks?: number };

    if (!remainingIssues || remainingIssues < 1) {
      res.status(400).json({ error: "remainingIssues must be a positive number" });
      return;
    }

    const windowDays = windowWeeks * 7;
    const issues = await getJiraIssuesForProject(projectId, windowDays);

    const resolved = issues.filter((i) => isIssueDone(i));
    const weeklyThroughput: number[] = [];
    const now = new Date();

    for (let w = 0; w < windowWeeks; w++) {
      const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
      const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
      const count = resolved.filter((i) => {
        const resolvedDate = i.fields.resolutiondate ? new Date(i.fields.resolutiondate) : null;
        return resolvedDate && resolvedDate >= weekStart && resolvedDate < weekEnd;
      }).length;
      weeklyThroughput.push(count);
    }

    const validWeeks = weeklyThroughput.filter((t) => t > 0);
    const avgThroughput = validWeeks.length > 0
      ? validWeeks.reduce((a, b) => a + b, 0) / validWeeks.length
      : 0;

    const projectedWeeks = avgThroughput > 0 ? remainingIssues / avgThroughput : Infinity;

    const endDate = new Date();
    if (isFinite(projectedWeeks)) {
      endDate.setDate(endDate.getDate() + Math.ceil(projectedWeeks * 7));
    }

    const sorted = [...validWeeks].sort((a, b) => a - b);
    const p25 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.25)] : avgThroughput;
    const p75 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.75)] : avgThroughput;

    const optimisticWeeks = p75 > 0 ? remainingIssues / p75 : Infinity;
    const pessimisticWeeks = p25 > 0 ? remainingIssues / p25 : Infinity;

    const formatDate = (d: Date): string => {
      if (isNaN(d.getTime())) return "—";
      return d.toISOString().split("T")[0];
    };

    const optimisticDate = new Date();
    if (isFinite(optimisticWeeks)) {
      optimisticDate.setDate(optimisticDate.getDate() + Math.ceil(optimisticWeeks * 7));
    }

    const pessimisticDate = new Date();
    if (isFinite(pessimisticWeeks)) {
      pessimisticDate.setDate(pessimisticDate.getDate() + Math.ceil(pessimisticWeeks * 7));
    }

    res.json({
      remainingIssues,
      avgThroughput: Math.round(avgThroughput * 10) / 10,
      projectedDate: formatDate(endDate),
      optimisticDate: formatDate(optimisticDate),
      pessimisticDate: formatDate(pessimisticDate),
      projectedWeeks: Math.round(projectedWeeks * 10) / 10,
      weeklyThroughput,
    });
  }
);

export default router;
