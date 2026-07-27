import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import {
  getJiraIssuesForProject,
  periodToDays,
  isIssueDone,
  getResolutionDate,
  getLeadTimeDays,
} from "../lib/jira";
import { getEffectiveThresholds, type EffectiveThreshold } from "../lib/health-thresholds";

const router: IRouter = Router();

// Admin -> Health metric key per priority. slaHighest is stored in HOURS (its target is usually
// sub-day), the rest in days — see DEFAULT_HEALTH_THRESHOLDS in routes/admin/constants.ts.
const SLA_METRIC_BY_PRIORITY: Record<string, string> = {
  Highest: "slaHighest",
  High: "slaHigh",
  Medium: "slaMedium",
  Low: "slaLow",
  Lowest: "slaLowest",
};

function slaTargetDays(priority: string, thresholds: Record<string, EffectiveThreshold>): number {
  const metric = SLA_METRIC_BY_PRIORITY[priority] ?? SLA_METRIC_BY_PRIORITY.Lowest;
  const configured = thresholds[metric]?.goodValue;
  const value = configured ?? (metric === "slaHighest" ? 4 : { slaHigh: 1, slaMedium: 3, slaLow: 5, slaLowest: 10 }[metric] ?? 10);
  return metric === "slaHighest" ? value / 24 : value;
}

router.get(
  "/projects/:projectId/sla/:period",
  requireAuth,
  requireSectionView("analytics"),
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
    const projectId = rawId ?? "";
    const period = rawPeriod ?? "1m";

    if (!["1m", "3m"].includes(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m or 3m." });
      return;
    }

    const periodDays = periodToDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const [issues, thresholds] = await Promise.all([
      getJiraIssuesForProject(projectId, periodDays),
      getEffectiveThresholds(projectId),
    ]);

    const resolvedWithDates = await Promise.all(
      issues.filter((i) => isIssueDone(i)).map(async (i) => ({
        issue: i,
        resolvedAt: await getResolutionDate(i),
      }))
    );
    const resolved = resolvedWithDates
      .filter((r) => r.resolvedAt && r.resolvedAt >= startDate)
      .map((r) => r.issue);

    const byPriority = new Map<string, { total: number; withinSla: number }>();

    for (const issue of resolved) {
      const priority = issue.fields.priority.name;
      if (!byPriority.has(priority)) {
        byPriority.set(priority, { total: 0, withinSla: 0 });
      }
      const entry = byPriority.get(priority)!;
      entry.total++;

      const leadTime = await getLeadTimeDays(issue);
      const threshold = slaTargetDays(priority, thresholds);
      if (leadTime !== null && leadTime <= threshold) {
        entry.withinSla++;
      }
    }

    const priorityOrder = ["Highest", "High", "Medium", "Low", "Lowest"];
    const slaData = Array.from(byPriority.entries())
      .map(([priority, { total, withinSla }]) => ({
        priority,
        total,
        withinSla,
        percentage: total > 0 ? Math.round((withinSla / total) * 100) : 0,
      }))
      .sort((a, b) => {
        const ai = priorityOrder.indexOf(a.priority);
        const bi = priorityOrder.indexOf(b.priority);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

    res.json({ projectId, period, sla: slaData });
  }
);

export default router;
