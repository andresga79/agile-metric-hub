import { db, metricSnapshotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  isIssueDone,
  getEffectiveIssueType,
  getResolutionDate,
  getLeadTimeDays,
  getCycleTimeDays,
  getQaStatusSet,
  getDevReturnStatusSet,
  getStatusCategoryMap,
  findQaRejections,
  JIRA_MAX_LOOKBACK_DAYS,
  sprintCloseTime,
  wasIssueDoneAt,
  type JiraIssue,
  type JiraSprint,
} from "./jira";
import { getPortfolioAllowedIssueTypes } from "./portfolio-metric-settings";
import { isoWeekStart } from "./iso-week";

interface WeekAccumulator {
  leadTimes: number[];
  cycleTimes: number[];
  throughput: number;
  qaEntries: number;
  qaRejections: number;
}

function emptyAccumulator(): WeekAccumulator {
  return { leadTimes: [], cycleTimes: [], throughput: 0, qaEntries: 0, qaRejections: 0 };
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Computes one snapshot row per ISO week represented in `issues`, covering
 *  Lead Time, Cycle Time, Throughput (all filtered to the portfolio's allowed
 *  issue types) and QA rejection rate (unfiltered, matching qa-rejected.ts). */
export async function computeWeeklySnapshots(
  projectId: string,
  issues: JiraIssue[]
): Promise<Array<{ weekStart: string; leadTimeAvg: number | null; cycleTimeAvg: number | null; throughput: number; qaRejectionRate: number | null }>> {
  const [allowedIssueTypes, qaStatusSet, devStatusSet] = await Promise.all([
    getPortfolioAllowedIssueTypes(),
    getQaStatusSet(),
    getDevReturnStatusSet(projectId),
  ]);

  const weeks = new Map<string, WeekAccumulator>();
  const getWeek = (weekStart: string): WeekAccumulator => {
    let acc = weeks.get(weekStart);
    if (!acc) {
      acc = emptyAccumulator();
      weeks.set(weekStart, acc);
    }
    return acc;
  };

  const filteredIssues = issues.filter((issue) =>
    allowedIssueTypes.includes(getEffectiveIssueType(issue))
  );
  const doneIssues = filteredIssues.filter((issue) => isIssueDone(issue));

  // Pre-warm the shared status-category cache before fanning out concurrent
  // per-issue lookups below - otherwise every one of them races to fetch it,
  // hammering Jira's /status endpoint (and risking 429s) on a cold cache.
  await getStatusCategoryMap();

  const resolvedIssues = await Promise.all(
    doneIssues.map(async (issue) => ({
      resolvedAt: await getResolutionDate(issue),
      leadTime: await getLeadTimeDays(issue),
      cycleTime: await getCycleTimeDays(issue),
    }))
  );

  for (const { resolvedAt, leadTime, cycleTime } of resolvedIssues) {
    if (!resolvedAt) continue;
    const acc = getWeek(isoWeekStart(resolvedAt));
    acc.throughput += 1;
    if (leadTime !== null) acc.leadTimes.push(leadTime);
    if (cycleTime !== null) acc.cycleTimes.push(cycleTime);
  }

  // QA rejection rate uses the full (unfiltered) issue set, mirroring qa-rejected.ts.
  // Changelogs can carry events from long before the lookback window (an issue
  // resolved this week may have been created months ago) - skip anything older
  // than the window so a single old transition can't create a phantom week.
  const windowStart = Date.now() - JIRA_MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  for (const issue of issues) {
    const histories = issue.changelog?.histories ?? [];
    for (const h of histories) {
      const createdAt = new Date(h.created).getTime();
      if (createdAt < windowStart) continue;
      for (const item of h.items) {
        if (item.field !== "status") continue;
        const to = item.toString?.trim() ?? "";
        if (to && qaStatusSet.has(to.toLowerCase())) {
          getWeek(isoWeekStart(new Date(h.created))).qaEntries += 1;
        }
      }
    }

    for (const rejection of findQaRejections(issue, qaStatusSet, devStatusSet)) {
      if (rejection.transitionedAt.getTime() < windowStart) continue;
      getWeek(isoWeekStart(rejection.transitionedAt)).qaRejections += 1;
    }
  }

  return Array.from(weeks.entries())
    .map(([weekStart, acc]) => ({
      weekStart,
      leadTimeAvg: avg(acc.leadTimes),
      cycleTimeAvg: avg(acc.cycleTimes),
      throughput: acc.throughput,
      // Entries and rejections can land in different weeks near the window edge
      // (a rejection whose original QA entry fell just outside the 90-day cutoff),
      // which can push the raw ratio past 100% - clamp since it's shown as a rate.
      qaRejectionRate: acc.qaEntries > 0 ? Math.min(100, Math.round((acc.qaRejections / acc.qaEntries) * 1000) / 10) : null,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Weeks safe to persist: only those starting on/after the lookback window's start. The week
 *  straddling the window edge is only partly covered by the fetched issues, and it's the one
 *  about to age out - upserting it would overwrite a complete row with an ever-smaller partial
 *  one each day, so the value that finally "freezes" is the most truncated one (seen live:
 *  OLP's 2026-06-01/08/15 rows ended up stored as throughput 0). */
export function snapshotsFullyInWindow<T extends { weekStart: string }>(
  snapshots: T[],
  windowStart: Date
): T[] {
  return snapshots.filter((s) => new Date(`${s.weekStart}T00:00:00Z`).getTime() >= windowStart.getTime());
}

/** Recomputes and upserts weekly snapshots for a project. Rows for weeks fully
 *  inside the live Jira lookback window get refreshed; rows for weeks that have
 *  started aging out of that window are left untouched, so they become the
 *  project's only remaining record of that period. */
export async function storeWeeklySnapshots(projectId: string, issues: JiraIssue[]): Promise<void> {
  const windowStart = new Date(Date.now() - JIRA_MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const snapshots = snapshotsFullyInWindow(await computeWeeklySnapshots(projectId, issues), windowStart);

  for (const snapshot of snapshots) {
    await db
      .insert(metricSnapshotsTable)
      .values({
        projectId,
        weekStart: snapshot.weekStart,
        leadTimeAvg: snapshot.leadTimeAvg?.toString() ?? null,
        cycleTimeAvg: snapshot.cycleTimeAvg?.toString() ?? null,
        throughput: snapshot.throughput,
        qaRejectionRate: snapshot.qaRejectionRate?.toString() ?? null,
      })
      .onConflictDoUpdate({
        target: [metricSnapshotsTable.projectId, metricSnapshotsTable.weekStart],
        set: {
          leadTimeAvg: snapshot.leadTimeAvg?.toString() ?? null,
          cycleTimeAvg: snapshot.cycleTimeAvg?.toString() ?? null,
          throughput: snapshot.throughput,
          qaRejectionRate: snapshot.qaRejectionRate?.toString() ?? null,
          updatedAt: new Date(),
        },
      });
  }

  logger.debug({ projectId, weeks: snapshots.length }, "Stored weekly metric snapshots");
}

/** Computes Lead Time, Cycle Time, Throughput and QA rejection rate for a single sprint's
 *  issue set - the sprint-bucketed sibling of computeWeeklySnapshots' per-week accumulator.
 *  No date-window bucketing needed here: `issues` already comes scoped to one sprint (via
 *  `sprint = {sprintId}` JQL), so every issue's full history counts toward this one row. */
export async function computeSprintSnapshot(
  projectId: string,
  issues: JiraIssue[],
  sprint: JiraSprint
): Promise<{ leadTimeAvg: number | null; cycleTimeAvg: number | null; throughput: number; qaRejectionRate: number | null }> {
  const [allowedIssueTypes, qaStatusSet, devStatusSet] = await Promise.all([
    getPortfolioAllowedIssueTypes(),
    getQaStatusSet(),
    getDevReturnStatusSet(projectId),
  ]);

  const filteredIssues = issues.filter((issue) =>
    allowedIssueTypes.includes(getEffectiveIssueType(issue))
  );
  const categoryMap = await getStatusCategoryMap();
  // Same "completed at sprint close" rule as computeSprintMetrics, so Evolution's per-sprint
  // throughput matches the Sprints tab instead of growing as carried-over work gets finished.
  const closeTime = sprintCloseTime(sprint);
  const doneIssues = filteredIssues.filter((issue) =>
    closeTime ? wasIssueDoneAt(issue, closeTime, categoryMap) : isIssueDone(issue)
  );

  const resolvedIssues = await Promise.all(
    doneIssues.map(async (issue) => ({
      leadTime: await getLeadTimeDays(issue),
      cycleTime: await getCycleTimeDays(issue),
    }))
  );

  const acc = emptyAccumulator();
  // Throughput counts every issue done at close, even one reopened since (its current resolution
  // date is gone, but the sprint still completed it) - matching computeSprintMetrics.
  acc.throughput = doneIssues.length;
  for (const { leadTime, cycleTime } of resolvedIssues) {
    if (leadTime !== null) acc.leadTimes.push(leadTime);
    if (cycleTime !== null) acc.cycleTimes.push(cycleTime);
  }

  // QA rejection rate uses the full (unfiltered) issue set, mirroring computeWeeklySnapshots.
  for (const issue of issues) {
    const histories = issue.changelog?.histories ?? [];
    for (const h of histories) {
      for (const item of h.items) {
        if (item.field !== "status") continue;
        const to = item.toString?.trim() ?? "";
        if (to && qaStatusSet.has(to.toLowerCase())) {
          acc.qaEntries += 1;
        }
      }
    }
    acc.qaRejections += findQaRejections(issue, qaStatusSet, devStatusSet).length;
  }

  return {
    leadTimeAvg: avg(acc.leadTimes),
    cycleTimeAvg: avg(acc.cycleTimes),
    throughput: acc.throughput,
    qaRejectionRate: acc.qaEntries > 0 ? Math.min(100, Math.round((acc.qaRejections / acc.qaEntries) * 1000) / 10) : null,
  };
}

export async function getProjectSnapshots(projectId: string) {
  return db
    .select()
    .from(metricSnapshotsTable)
    .where(eq(metricSnapshotsTable.projectId, projectId))
    .orderBy(metricSnapshotsTable.weekStart);
}
