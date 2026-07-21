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
  type JiraIssue,
} from "./jira";
import { getPortfolioAllowedIssueTypes } from "./portfolio-metric-settings";

/** Monday of the ISO week containing `date`, as a YYYY-MM-DD string.
 *  Matches the bucketing used by kanban-metrics.ts so weeks line up across views. */
function isoWeekStart(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dayNum = (d.getDay() + 6) % 7; // 0=Monday .. 6=Sunday
  const monday = new Date(d.valueOf());
  monday.setDate(monday.getDate() - dayNum);
  return monday.toISOString().split("T")[0]!;
}

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
  const windowStart = Date.now() - 90 * 24 * 60 * 60 * 1000;
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

/** Recomputes and upserts weekly snapshots for a project. Rows for weeks still
 *  inside the live Jira lookback window get refreshed; rows for weeks that have
 *  since aged out of that window are left untouched, so they become the
 *  project's only remaining record of that period. */
export async function storeWeeklySnapshots(projectId: string, issues: JiraIssue[]): Promise<void> {
  const snapshots = await computeWeeklySnapshots(projectId, issues);

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

export async function getProjectSnapshots(projectId: string) {
  return db
    .select()
    .from(metricSnapshotsTable)
    .where(eq(metricSnapshotsTable.projectId, projectId))
    .orderBy(metricSnapshotsTable.weekStart);
}
