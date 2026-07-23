import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getJiraIssuesForProject,
  isIssueDone,
  isIssueInProgress,
  periodToDays,
  getResolutionDate,
  getCycleTimeDays,
  getLeadTimeDays,
  getStoryPoints,
  mapIssueType,
  type JiraIssue,
} from "../lib/jira";
import { getEffectiveThresholds } from "../lib/health-thresholds";

const router: IRouter = Router();

interface HealthDimension {
  name: string;
  value: number;
  description: string;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// worst/best are reference points, not numerically ordered — worst maps to score 0, best to
// score 100, regardless of whether worst > best (lower-is-better metric) or worst < best
// (higher-is-better metric). The value is clamped into [worst, best] BEFORE computing the ratio,
// so a value past the worst anchor can't wrap the fraction's sign and read back out as 100 — the
// previous (bad, good, invert) version did exactly that for every lower-is-better metric whenever
// the actual value was worse than the "warning" anchor.
function normalize(value: number, worst: number, best: number): number {
  if (worst === best) return 100;
  const clampedValue = clamp(value, Math.min(worst, best), Math.max(worst, best));
  const raw = ((clampedValue - worst) / (best - worst)) * 100;
  return Math.round(clamp(raw, 0, 100));
}

router.get(
  "/projects/:projectId/health/:period",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
    const period = (rawPeriod ?? "1m") as "1m" | "3m";
    const periodDays = periodToDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const [issues, thresholds] = await Promise.all([
      // includeChangelog: required for getCycleTimeDays() below to find the real first-in-progress
      // transition — without it, avgCycleTime silently degrades to lead time for every issue
      // (confirmed: this endpoint was returning avgCycleTime === avgLeadTime exactly).
      getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true }),
      getEffectiveThresholds(projectId),
    ]);

    // normalize()'s bad/good anchors come from Admin -> Health instead of fixed constants, so this
    // DORA-style score moves in lockstep with the rest of the app's health thresholds (same table
    // used by dashboard.tsx, analytics.ts and use-health-suggestions.ts) — including per-project
    // overrides. warningValue is the "0-score" anchor and goodValue the "100-score" anchor.
    const throughputThreshold = thresholds.throughput ?? { goodValue: 10, warningValue: 5 };
    const cycleTimeThreshold = thresholds.cycleTime ?? { goodValue: 15, warningValue: 25 };
    const cfrThreshold = thresholds.cfr ?? { goodValue: 10, warningValue: 25 };
    const wipRatioThreshold = thresholds.wipRatio ?? { goodValue: 30, warningValue: 50 };
    const leadTimeThreshold = thresholds.leadTime ?? { goodValue: 25, warningValue: 35 };

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

    const leadTimes = (
      await Promise.all(resolved.map((i) => getLeadTimeDays(i)))
    ).filter((v): v is number => v !== null);
    const avgLeadTime =
      leadTimes.length > 0
        ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
        : 0;

    const bugCount = resolved.filter((i) => mapIssueType(i.fields.issuetype.name) === "Bug").length;
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
      const freqScore = normalize(throughput, throughputThreshold.warningValue, throughputThreshold.goodValue);
      const ltScore = normalize(avgCycleTime, cycleTimeThreshold.warningValue, cycleTimeThreshold.goodValue);
      const cfrScore = normalize(cfr, cfrThreshold.warningValue, cfrThreshold.goodValue);
      return Math.round((freqScore + ltScore + cfrScore) / 3);
    })();

    const dimensions: HealthDimension[] = [
      {
        name: "Throughput",
        value: normalize(throughput, throughputThreshold.warningValue, throughputThreshold.goodValue),
        description: `${throughput.toFixed(1)} issues/week`,
      },
      {
        name: "Cycle Time",
        value: normalize(avgCycleTime, cycleTimeThreshold.warningValue, cycleTimeThreshold.goodValue),
        description: `${avgCycleTime.toFixed(1)}d avg`,
      },
      {
        name: "DORA Score",
        value: doraScore,
        description: `CFR ${cfr.toFixed(1)}%`,
      },
      {
        name: "WIP Balance",
        value: normalize(wipRatio, wipRatioThreshold.warningValue, wipRatioThreshold.goodValue),
        description: `${inProgress.length} in progress`,
      },
      {
        name: "Predictability",
        value: predictability,
        description: `${resolved.length} resolved`,
      },
      {
        name: "Quality",
        value: normalize(cfr, cfrThreshold.warningValue, cfrThreshold.goodValue),
        description: `${bugCount} bugs resolved`,
      },
      {
        name: "Lead Time",
        value: normalize(avgLeadTime, leadTimeThreshold.warningValue, leadTimeThreshold.goodValue),
        description: `${avgLeadTime.toFixed(1)}d avg`,
      },
    ];

    res.json({
      projectId,
      period,
      dimensions,
      raw: {
        throughput,
        avgCycleTime,
        avgLeadTime,
        cfr: Math.round(cfr * 10) / 10,
        wipRatio: Math.round(wipRatio * 10) / 10,
        predictability,
        bugCount,
        resolvedCount: resolved.length,
        inProgressCount: inProgress.length,
        totalIssues: total,
      },
    });
  }
);

export default router;
