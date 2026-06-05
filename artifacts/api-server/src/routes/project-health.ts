import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getJiraIssuesForProject,
  isIssueDone,
  isIssueInProgress,
  periodToDays,
  getResolutionDate,
  getCycleTimeDays,
  getStoryPoints,
  type JiraIssue,
} from "../lib/jira";

const router: IRouter = Router();

interface HealthDimension {
  name: string;
  value: number;
  description: string;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function normalize(value: number, bad: number, good: number, invert = false): number {
  const raw = invert
    ? 100 - ((value - bad) / (good - bad)) * 100
    : ((value - bad) / (good - bad)) * 100;
  return Math.round(clamp(raw, 0, 100));
}

router.get(
  "/projects/:projectId/health/:period",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
    const period = (rawPeriod ?? "1m") as "1m" | "3m" | "6m";
    const periodDays = periodToDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const issues = await getJiraIssuesForProject(projectId, periodDays);

    const resolvedWithDates = await Promise.all(
      issues.filter((i) => isIssueDone(i)).map(async (i) => ({
        issue: i,
        resolvedAt: await getResolutionDate(i),
      }))
    );
    const resolved = resolvedWithDates
      .filter((r) => r.resolvedAt && r.resolvedAt >= startDate)
      .map((r) => r.issue);

    const inProgress = issues.filter((i) => isIssueInProgress(i));
    const total = issues.length;

    const weeks = Math.max(1, Math.ceil(periodDays / 7));
    const throughput = total > 0 ? Math.round((resolved.length / weeks) * 10) / 10 : 0;

    const cycleTimes = (
      await Promise.all(resolved.map((i) => getCycleTimeDays(i)))
    ).filter((v): v is number => v !== null);
    const avgCycleTime =
      cycleTimes.length > 0
        ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
        : 0;

    const bugCount = resolved.filter((i) => /^bug$/i.test(i.fields.issuetype.name.trim())).length;
    const cfr = resolved.length > 0 ? (bugCount / resolved.length) * 100 : 0;

    const wipRatio = total > 0 ? (inProgress.length / total) * 100 : 0;

    const perWeek: number[] = new Array(weeks).fill(0);
    for (const issue of resolved) {
      const d = resolvedWithDates.find((r) => r.issue.id === issue.id)?.resolvedAt;
      if (!d) continue;
      const wi = Math.min(weeks - 1, Math.floor((d.getTime() - startDate.getTime()) / (7 * 86400000)));
      perWeek[wi]++;
    }
    const nonZero = perWeek.filter((v) => v > 0);
    const throughputAvg = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
    const throughputVariance =
      nonZero.length > 1
        ? nonZero.reduce((sum, v) => sum + (v - throughputAvg) ** 2, 0) / nonZero.length
        : 0;
    const throughputStdDev = Math.sqrt(throughputVariance);
    const predictability = throughputAvg > 0
      ? Math.round(clamp(100 - (throughputStdDev / throughputAvg) * 50, 0, 100))
      : 50;

    const doraScore = (() => {
      const freqScore = normalize(throughput, 0, 5);
      const ltScore = normalize(avgCycleTime, 30, 0, true);
      const cfrScore = normalize(cfr, 15, 0, true);
      return Math.round((freqScore + ltScore + cfrScore) / 3);
    })();

    const dimensions: HealthDimension[] = [
      {
        name: "Throughput",
        value: normalize(throughput, 0, 5),
        description: `${throughput.toFixed(1)} issues/week`,
      },
      {
        name: "Cycle Time",
        value: normalize(avgCycleTime, 30, 0, true),
        description: `${avgCycleTime.toFixed(1)}d avg`,
      },
      {
        name: "DORA Score",
        value: doraScore,
        description: `CFR ${cfr.toFixed(1)}%`,
      },
      {
        name: "WIP Balance",
        value: normalize(wipRatio, 50, 15, true),
        description: `${inProgress.length} in progress`,
      },
      {
        name: "Predictability",
        value: predictability,
        description: `${resolved.length} resolved`,
      },
      {
        name: "Quality",
        value: normalize(cfr, 15, 0, true),
        description: `${bugCount} bugs resolved`,
      },
    ];

    res.json({ projectId, period, dimensions });
  }
);

export default router;
