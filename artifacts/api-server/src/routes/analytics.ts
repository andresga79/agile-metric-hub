import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { clearCache, getCacheTimestamp, issuesCacheKey } from "../lib/jira-cache";
import {
  getJiraIssuesForProject,
  periodToDays,
  isIssueDone,
  isIssueInProgress,
  getResolutionDate,
  getCycleTimeDays,
  getLeadTimeDays,
  getStoryPoints,
  getStatusCategoryMap,
  type JiraIssue,
} from "../lib/jira";

const router: IRouter = Router();

const VALID_PERIODS = ["1m", "3m", "6m"] as const;
type Period = (typeof VALID_PERIODS)[number];

function isValidPeriod(p: string): p is Period {
  return (VALID_PERIODS as readonly string[]).includes(p);
}

function getStartDate(periodDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - periodDays);
  return d;
}

function isBlockedStatus(name: string): boolean {
  return /block|impediment|bloqueado|obstáculo/i.test(name.trim());
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const year = d.getFullYear();
  const week = Math.floor((d.getTime() - new Date(year, 0, 4).getTime()) / 604800000) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function getAlertLevel(days: number | null): "critical" | "warning" | "watch" | null {
  if (days === null) return null;
  if (days >= 14) return "critical";
  if (days >= 7) return "warning";
  if (days >= 3) return "watch";
  return null;
}

interface TimeInStatusEntry {
  status: string;
  category: string;
  totalDays: number;
  avgDays: number;
  medianDays: number;
  issueCount: number;
}

async function computeTimeInStatus(
  issues: JiraIssue[],
): Promise<TimeInStatusEntry[]> {
  const categoryMap = await getStatusCategoryMap();
  const statusMap = new Map<string, Map<string, number>>();

  function addTime(status: string, issueKey: string, days: number) {
    if (days <= 0) return;
    let issueMap = statusMap.get(status);
    if (!issueMap) {
      issueMap = new Map();
      statusMap.set(status, issueMap);
    }
    issueMap.set(issueKey, (issueMap.get(issueKey) ?? 0) + days);
  }

  for (const issue of issues) {
    const histories = issue.changelog?.histories ?? [];
    if (histories.length === 0) continue;

    const transitions = histories
      .filter((h) => h.items.some((it) => it.field === "status"))
      .map((h) => ({
        at: new Date(h.created),
        from: h.items.find((it) => it.field === "status")?.fromString ?? "",
        to: h.items.find((it) => it.field === "status")?.toString ?? "",
      }))
      .filter((t) => t.from || t.to)
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    if (transitions.length === 0) continue;

    const created = new Date(issue.fields.created).getTime();
    let prevTime = created;

    for (const t of transitions) {
      if (t.from) {
        addTime(t.from, issue.key, (t.at.getTime() - prevTime) / (1000 * 60 * 60 * 24));
      }
      prevTime = t.at.getTime();
    }

    const lastTo = transitions[transitions.length - 1]!.to;
    if (lastTo) {
      const endTime = isIssueDone(issue)
        ? (await getResolutionDate(issue))?.getTime() ?? Date.now()
        : Date.now();
      addTime(lastTo, issue.key, (endTime - prevTime) / (1000 * 60 * 60 * 24));
    }
  }

  const entries: TimeInStatusEntry[] = [];
  for (const [status, issueMap] of statusMap) {
    const dayValues = Array.from(issueMap.values());
    if (dayValues.length === 0) continue;
    const total = dayValues.reduce((a, b) => a + b, 0);
    const sorted = [...dayValues].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
        : sorted[Math.floor(sorted.length / 2)]!;
    entries.push({
      status,
      category: categoryMap.get(status.trim().toLowerCase()) ?? "other",
      totalDays: Math.round(total * 10) / 10,
      avgDays: Math.round((total / dayValues.length) * 10) / 10,
      medianDays: Math.round(median * 10) / 10,
      issueCount: dayValues.length,
    });
  }

  return entries.sort((a, b) => b.avgDays - a.avgDays);
}

async function computePeriodMetrics(
  issues: JiraIssue[],
  startDate: Date,
): Promise<{
  flowEfficiency: number | null;
  avgCycleTime: number | null;
  avgLeadTime: number | null;
  issueTypeDistribution: { name: string; count: number; percentage: number }[];
  throughputByPriority: { priority: string; count: number }[];
  throughputOverTime: { week: string; count: number }[];
  leadTimeDistribution: { range: string; count: number }[];
}> {
  // --- Issue Type Distribution (#1) ---
  const typeCount = new Map<string, number>();
  for (const issue of issues) {
    const t = issue.fields.issuetype.name;
    typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
  }
  const totalIssues = issues.length;
  const issueTypeDistribution = Array.from(typeCount.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: totalIssues > 0 ? Math.round((count / totalIssues) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // --- Throughput by Priority (#4) ---
  const resolvedWithDates = await Promise.all(
    issues.filter((i) => isIssueDone(i)).map(async (i) => ({
      issue: i,
      resolvedAt: await getResolutionDate(i),
    }))
  );
  const resolved = resolvedWithDates
    .filter((r) => r.resolvedAt && r.resolvedAt >= startDate)
    .map((r) => r.issue);

  const priorityCount = new Map<string, number>();
  for (const issue of resolved) {
    const p = issue.fields.priority.name;
    priorityCount.set(p, (priorityCount.get(p) ?? 0) + 1);
  }
  const priorityOrder = ["Highest", "High", "Medium", "Low", "Lowest"];
  const throughputByPriority = Array.from(priorityCount.entries())
    .map(([priority, count]) => ({ priority, count }))
    .sort((a, b) => {
      const ai = priorityOrder.indexOf(a.priority);
      const bi = priorityOrder.indexOf(b.priority);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

  // --- Throughput Over Time / Run Chart (#8) ---
  const weekCount = new Map<string, number>();
  for (const r of resolvedWithDates) {
    if (!r.resolvedAt || r.resolvedAt < startDate) continue;
    const week = getISOWeek(r.resolvedAt);
    weekCount.set(week, (weekCount.get(week) ?? 0) + 1);
  }
  const throughputOverTime = Array.from(weekCount.entries())
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // --- Lead Time Distribution (#3) ---
  const leadTimes = (
    await Promise.all(resolved.map((i) => getLeadTimeDays(i)))
  ).filter((v): v is number => v !== null);

  const ltBuckets = [
    { range: "0-1d", min: 0, max: 1 },
    { range: "1-3d", min: 1, max: 3 },
    { range: "3-7d", min: 3, max: 7 },
    { range: "7-14d", min: 7, max: 14 },
    { range: "14-30d", min: 14, max: 30 },
    { range: "30d+", min: 30, max: Infinity },
  ];
  const leadTimeDistribution = ltBuckets.map(({ range, min, max }) => ({
    range,
    count: leadTimes.filter((d) => d >= min && d < max).length,
  }));

  // --- Flow Efficiency (#5) ---
  const cycleTimes = (await Promise.all(resolved.map((i) => getCycleTimeDays(i)))).filter((v): v is number => v !== null);
  const avgCycleTime = cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null;
  const avgLeadTime = leadTimes.length > 0 ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;
  const flowEfficiency = avgCycleTime !== null && avgLeadTime !== null && avgLeadTime > 0
    ? Math.round((avgCycleTime / avgLeadTime) * 100)
    : null;

  return { flowEfficiency, avgCycleTime, avgLeadTime, issueTypeDistribution, throughputByPriority, throughputOverTime, leadTimeDistribution };
}

router.get(
  "/projects/:projectId/analytics/:period",
  requireAuth,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
    const projectId = rawId ?? "";
    const period = rawPeriod ?? "1m";
    const compareTo = req.query.compareTo === "true";

    if (!isValidPeriod(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m, 3m, or 6m." });
      return;
    }

    const periodDays = periodToDays(period);
    const startDate = getStartDate(periodDays);

    if (req.query.refresh === "true") {
      await clearCache(issuesCacheKey(projectId, periodDays));
    }

    const issues = await getJiraIssuesForProject(projectId, periodDays);

    const cacheTimestamp = await getCacheTimestamp(issuesCacheKey(projectId, periodDays));

    const metrics = await computePeriodMetrics(issues, startDate);

    // --- WIP Aging Report (#2) ---
    const inProgressIssues = issues.filter((i) => isIssueInProgress(i));
    const wipAging = await Promise.all(
      inProgressIssues.map(async (i) => {
        const histories = i.changelog?.histories ?? [];
        let enteredInProgress: Date | null = null;

        if (histories.length > 0) {
          const categoryMap = await getStatusCategoryMap();
          const transitions = histories
            .filter((h) => h.items.some((it) => it.field === "status"))
            .map((h) => ({
              at: new Date(h.created),
              to: h.items.find((it) => it.field === "status")?.toString ?? "",
            }))
            .sort((a, b) => b.at.getTime() - a.at.getTime());

          for (const t of transitions) {
            const cat = categoryMap.get(t.to.trim().toLowerCase());
            if (cat === "indeterminate") {
              enteredInProgress = t.at;
              break;
            }
          }
        }

        const daysInProgress = enteredInProgress
          ? Math.round((Date.now() - enteredInProgress.getTime()) / (1000 * 60 * 60 * 24) * 10) / 10
          : null;

        return {
          id: i.id,
          key: i.key,
          summary: i.fields.summary,
          assignee: i.fields.assignee?.displayName ?? null,
          issueType: i.fields.issuetype.name,
          priority: i.fields.priority.name,
          daysInProgress,
          alertLevel: getAlertLevel(daysInProgress),
          enteredDate: enteredInProgress?.toISOString() ?? null,
        };
      })
    );

    wipAging.sort((a, b) => (b.daysInProgress ?? 0) - (a.daysInProgress ?? 0));

    // --- Blocked Time Analysis (#7) ---
    const blockedData = await Promise.all(
      issues.map(async (i) => {
        const histories = i.changelog?.histories ?? [];
        let totalBlockedMs = 0;
        let blockedStart: number | null = null;

        const sortedHistories = [...histories]
          .filter((h) => h.items.some((it) => it.field === "status"))
          .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

        for (const h of sortedHistories) {
          const transition = h.items.find((it) => it.field === "status");
          if (!transition) continue;
          const transitionTime = new Date(h.created).getTime();

          if (transition.toString && isBlockedStatus(transition.toString)) {
            blockedStart = transitionTime;
          } else if (blockedStart !== null) {
            totalBlockedMs += transitionTime - blockedStart;
            blockedStart = null;
          }
        }

        if (blockedStart !== null) {
          totalBlockedMs += Date.now() - blockedStart;
        }

        const totalDays = Math.round((totalBlockedMs / (1000 * 60 * 60 * 24)) * 10) / 10;
        return {
          key: i.key,
          summary: i.fields.summary,
          issueType: i.fields.issuetype.name,
          priority: i.fields.priority.name,
          totalDays,
          isCurrentlyBlocked: blockedStart !== null,
          currentStatus: i.fields.status.name,
        };
      })
    );

    const blockedIssues = blockedData
      .filter((b) => b.totalDays > 0)
      .sort((a, b) => {
        if (a.isCurrentlyBlocked !== b.isCurrentlyBlocked) return a.isCurrentlyBlocked ? -1 : 1;
        return b.totalDays - a.totalDays;
      });

    // --- Time in Status (#9) ---
    const timeInStatus = await computeTimeInStatus(issues);

    // --- Period-over-Period (#3) ---
    let previousPeriod: any = null;
    if (compareTo) {
      const prevStartDate = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const prevEndDate = new Date(startDate.getTime());
      const prevIssues = await getJiraIssuesForProject(projectId, periodDays * 2);
      const prevFiltered = prevIssues.filter((i) => {
        const created = new Date(i.fields.created);
        return created >= prevStartDate && created < prevEndDate;
      });
      if (prevFiltered.length > 0) {
        previousPeriod = await computePeriodMetrics(prevFiltered, prevStartDate);
      }
    }

    res.json({
      projectId,
      period,
      compareTo,
      fetchedAt: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : null,
      ...metrics,
      wipAging,
      blockedIssues,
      timeInStatus,
      previousPeriod,
    });
  }
);

export default router;
