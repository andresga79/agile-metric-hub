import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { getJiraIssuesForProject, isIssueDone, getResolutionDate, periodToDays, getStoryPoints, getLeadTimeDays } from "../lib/jira";

const router: IRouter = Router();

interface ForecastRequest {
  target: number;
  unit?: "issues" | "story_points";
  simulations?: number;
  windowDays?: number;
}

interface ForecastResponse {
  target: number;
  unit: "issues" | "story_points";
  simulations: number;
  probability: number;
  medianWeeks: number;
  p75Weeks: number;
  p85Weeks: number;
  p95Weeks: number;
  histogram: { week: number; count: number }[];
}

function monteCarlo(
  throughputSamples: number[],
  target: number,
  unit: "issues" | "story_points",
  simulations: number
): { weeks: number[]; histogram: { week: number; count: number }[] } {
  const weeks: number[] = [];

  for (let sim = 0; sim < simulations; sim++) {
    let accumulated = 0;
    let week = 0;
    while (accumulated < target) {
      const sample = throughputSamples[Math.floor(Math.random() * throughputSamples.length)];
      accumulated += sample;
      week++;
      if (week > 104) break;
    }
    weeks.push(week);
  }

  weeks.sort((a, b) => a - b);

  const maxWeek = Math.max(...weeks);
  const bucketCount = Math.min(maxWeek, 52);
  const bucketSize = Math.max(1, Math.ceil(maxWeek / bucketCount));
  const buckets: Record<number, number> = {};
  for (const w of weeks) {
    const b = Math.ceil(w / bucketSize) * bucketSize;
    buckets[b] = (buckets[b] ?? 0) + 1;
  }

  const histogram = Object.entries(buckets)
    .map(([week, count]) => ({ week: Number(week), count: Math.round((count / simulations) * 100) }))
    .sort((a, b) => a.week - b.week);

  return { weeks, histogram };
}

router.post(
  "/projects/:projectId/forecast",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const body = req.body as ForecastRequest;
    const target = body.target;
    const unit = body.unit ?? "issues";
    const simulations = Math.min(body.simulations ?? 10000, 50000);

    if (!target || target <= 0) {
      res.status(400).json({ error: "target must be a positive number" });
      return;
    }

    const periodDays = body.windowDays ?? 180;
    const issues = await getJiraIssuesForProject(projectId, periodDays);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const resolvedWithDates = await Promise.all(
      issues.filter((i) => isIssueDone(i)).map(async (i) => ({
        issue: i,
        resolvedAt: await getResolutionDate(i),
      }))
    );
    const resolved = resolvedWithDates
      .filter((r) => r.resolvedAt && r.resolvedAt >= startDate)
      .map((r) => r.issue);

    if (resolved.length < 3) {
      res.status(400).json({ error: "Not enough resolved data for forecast (need at least 3 issues)" });
      return;
    }

    const weeks = Math.max(1, Math.ceil(periodDays / 7));
    let throughputSamples: number[];

    if (unit === "story_points" && issues.some((i) => getStoryPoints(i) > 0)) {
      const perWeek: number[] = new Array(weeks).fill(0);
      for (const issue of resolved) {
        const d = resolvedWithDates.find((r) => r.issue.id === issue.id)?.resolvedAt;
        if (!d) continue;
        const weekIdx = Math.min(weeks - 1, Math.floor((d.getTime() - startDate.getTime()) / (7 * 86400000)));
        perWeek[weekIdx] += getStoryPoints(issue);
      }
      throughputSamples = perWeek.filter((v) => v > 0);
    } else {
      const perWeek: number[] = new Array(weeks).fill(0);
      for (const issue of resolved) {
        const d = resolvedWithDates.find((r) => r.issue.id === issue.id)?.resolvedAt;
        if (!d) continue;
        const weekIdx = Math.min(weeks - 1, Math.floor((d.getTime() - startDate.getTime()) / (7 * 86400000)));
        perWeek[weekIdx]++;
      }
      throughputSamples = perWeek.filter((v) => v > 0);
    }

    if (throughputSamples.length < 2) {
      const avg = resolved.length / weeks;
      throughputSamples = Array.from({ length: 20 }, () => Math.max(0, avg + (Math.random() - 0.5) * avg));
    }

    const { weeks: results, histogram } = monteCarlo(throughputSamples, target, unit, simulations);

    const p = (k: number) => {
      const idx = k * (results.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return results[lo];
      return Math.round((results[lo] * (hi - idx) + results[hi] * (idx - lo)) * 10) / 10;
    };

    const targetWeeks = p(0.5);
    const probability = results.filter((w) => w <= targetWeeks).length / simulations;

    res.json({
      target,
      unit: unit as "issues" | "story_points",
      simulations,
      probability: Math.round(probability * 1000) / 10,
      medianWeeks: p(0.5),
      p75Weeks: p(0.75),
      p85Weeks: p(0.85),
      p95Weeks: p(0.95),
      histogram,
    } satisfies ForecastResponse);
  }
);

export default router;
