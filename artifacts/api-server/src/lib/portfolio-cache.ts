import { db } from "@workspace/db";
import { portfolioCacheTable } from "@workspace/db/schema";
import {
  listJiraProjects,
  getJiraIssuesForProject,
  getOpenIssuesForProject,
  getResolvedJiraIssuesInRange,
  getLeadTimeDays,
  getCycleTimeDays,
  getResolutionDate,
  isIssueDone,
  isIssueInProgress,
  mapIssueType,
  getEffectiveIssueType,
  getQaStatusSet,
  getDevReturnStatusSet,
  computeQaRejectionRate,
  type JiraIssue,
} from "./jira";
import { filterVisibleProjects } from "./project-visibility";
import { getPortfolioAllowedIssueTypes } from "./portfolio-metric-settings";
import { getEffectiveThresholds, normalize } from "./health-thresholds";
import { logger } from "./logger";
import { desc, sql } from "drizzle-orm";

const PORTFOLIO_METRICS_PERIOD_DAYS = 90;
// getJiraIssuesForProject is hard-capped at 90 days back (JIRA_MAX_LOOKBACK_DAYS — Forecast and
// Analytics both build on that cap and were tuned to respect it), so the "previous period" slice
// (91-180 days ago) is fetched separately via getResolvedJiraIssuesInRange, which deliberately
// bypasses that cap instead of trying to stretch a single fetch across both windows.
const PORTFOLIO_TREND_WINDOW_DAYS = PORTFOLIO_METRICS_PERIOD_DAYS * 2;
let isPortfolioRecalculating = false;
let portfolioRecalculationStartedAt: Date | null = null;
let portfolioRecalculationFinishedAt: Date | null = null;
let portfolioRecalculationLastError: string | null = null;

export interface PortfolioRecalculationStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastCalculatedAt: string | null;
  cachedProjects: number;
  lastError: string | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * 0.5;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const value = lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  return Math.round(value * 10) / 10;
}

/** Resolved-issue metrics for a single bounded [windowStart, windowEnd) slice. Called twice per
 *  project — once for the current 90-day period, once for the previous one — so the KPI trend
 *  arrows on the executive dashboard have something to compare against. */
async function computeWindowMetrics(filteredIssues: JiraIssue[], windowStart: Date, windowEnd: Date) {
  const resolvedWithDates = await Promise.all(
    filteredIssues
      .filter((issue) => isIssueDone(issue))
      .map(async (issue) => ({ issue, resolvedAt: await getResolutionDate(issue) }))
  );

  const inWindow = resolvedWithDates.filter(
    (entry) => entry.resolvedAt && entry.resolvedAt >= windowStart && entry.resolvedAt < windowEnd
  );
  const resolved = inWindow.map((entry) => entry.issue);

  const leadTimes = (
    await Promise.all(resolved.map((issue) => getLeadTimeDays(issue)))
  ).filter((value): value is number => value !== null);
  const cycleTimes = (
    await Promise.all(resolved.map((issue) => getCycleTimeDays(issue)))
  ).filter((value): value is number => value !== null);

  const leadTimeAvg =
    leadTimes.length > 0
      ? Math.round((leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length) * 10) / 10
      : null;
  const cycleTimeP50 = median(cycleTimes);

  const bugCount = resolved.filter((i) => mapIssueType(i.fields.issuetype.name) === "Bug").length;
  const cfr = resolved.length > 0 ? (bugCount / resolved.length) * 100 : 0;

  const windowDays = Math.max(1, (windowEnd.getTime() - windowStart.getTime()) / 86400000);
  const weeks = Math.max(1, Math.ceil(windowDays / 7));
  const throughputPerWeek = resolved.length > 0 ? Math.round((resolved.length / weeks) * 10) / 10 : 0;

  return { resolvedCount: resolved.length, cycleTimeP50, leadTimeAvg, cfr, throughputPerWeek };
}

/** Same DORA-style formula as project-health.ts's per-project score (throughput + cycle time +
 *  CFR normalized against Admin -> Health thresholds, averaged) — kept in lockstep so a project's
 *  row on the executive dashboard isn't measuring something different from its own Health tab. */
function computeHealthScore(
  throughputPerWeek: number,
  cycleTimeP50: number | null,
  cfr: number,
  thresholds: Record<string, { goodValue: number; warningValue: number }>
): number {
  const throughputThreshold = thresholds.throughput ?? { goodValue: 10, warningValue: 5 };
  const cycleTimeThreshold = thresholds.cycleTime ?? { goodValue: 15, warningValue: 25 };
  const cfrThreshold = thresholds.cfr ?? { goodValue: 10, warningValue: 25 };

  const freqScore = normalize(throughputPerWeek, throughputThreshold.warningValue, throughputThreshold.goodValue);
  const ltScore = normalize(
    cycleTimeP50 ?? cycleTimeThreshold.warningValue,
    cycleTimeThreshold.warningValue,
    cycleTimeThreshold.goodValue
  );
  const cfrScore = normalize(cfr, cfrThreshold.warningValue, cfrThreshold.goodValue);
  return Math.round((freqScore + ltScore + cfrScore) / 3);
}

async function processProject(
  p: { id: string; key: string; name: string },
  allowedIssueTypes: string[],
  qaStatusSet: Set<string>,
  options?: { forceRefresh?: boolean }
) {
  try {
    // Current period (0-90 days back, within getJiraIssuesForProject's hard cap) merged with
    // getOpenIssuesForProject (no date bound, now with changelog too) so a ticket opened more
    // than 90 days ago and still in progress or still cycling through QA doesn't silently vanish
    // — same fix already applied to the per-project pages. Previous period (91-180 days back)
    // needs its own fetch since the shared cap can't reach that far back in one call.
    const [issues, openIssues, previousResolvedIssues, devStatusSet, thresholds] = await Promise.all([
      getJiraIssuesForProject(p.id, PORTFOLIO_METRICS_PERIOD_DAYS, {
        includeChangelog: true,
        forceRefresh: options?.forceRefresh,
      }),
      getOpenIssuesForProject(p.id, { includeChangelog: true, forceRefresh: options?.forceRefresh }),
      getResolvedJiraIssuesInRange(p.id, PORTFOLIO_TREND_WINDOW_DAYS, PORTFOLIO_METRICS_PERIOD_DAYS, {
        includeChangelog: true,
        forceRefresh: options?.forceRefresh,
      }),
      getDevReturnStatusSet(p.id),
      getEffectiveThresholds(p.id),
    ]);
    const combinedIssues = Array.from(
      new Map([...issues, ...openIssues].map((issue) => [issue.id, issue])).values()
    );
    const filteredIssues = combinedIssues.filter((issue) =>
      allowedIssueTypes.includes(getEffectiveIssueType(issue))
    );
    const previousFilteredIssues = previousResolvedIssues.filter((issue) =>
      allowedIssueTypes.includes(getEffectiveIssueType(issue))
    );
    const issueCount = filteredIssues.length;
    const inProgressCount = filteredIssues.filter((issue) => isIssueInProgress(issue)).length;

    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - PORTFOLIO_METRICS_PERIOD_DAYS);
    const previousStart = new Date(now);
    previousStart.setDate(previousStart.getDate() - PORTFOLIO_TREND_WINDOW_DAYS);

    const [current, previous] = await Promise.all([
      computeWindowMetrics(filteredIssues, currentStart, now),
      computeWindowMetrics(previousFilteredIssues, previousStart, currentStart),
    ]);

    // Health score and QA rejection rate mirror what a project's own /health and /qa-rejected
    // tabs show (both work off ALL issue types, no Admin issue-type filter), so these use the
    // unfiltered issue pools rather than the Admin issue-type filter to stay comparable with the
    // per-project view. QA rejection scanning merges in the previous-period resolved issues too —
    // an issue rejected from QA 100 days ago but resolved more recently would otherwise be missed
    // by the current-period pool alone (approximation: an issue rejected long before the 180-day
    // window and resolved even later would still be missed, but that's a rare shape in practice).
    const healthScore = computeHealthScore(current.throughputPerWeek, current.cycleTimeP50, current.cfr, thresholds);
    const healthScorePrevious = computeHealthScore(
      previous.throughputPerWeek,
      previous.cycleTimeP50,
      previous.cfr,
      thresholds
    );
    const allIssuesForQaScan = Array.from(
      new Map([...combinedIssues, ...previousResolvedIssues].map((issue) => [issue.id, issue])).values()
    );
    const currentQa = computeQaRejectionRate(allIssuesForQaScan, qaStatusSet, devStatusSet, currentStart, now);
    const previousQa = computeQaRejectionRate(allIssuesForQaScan, qaStatusSet, devStatusSet, previousStart, currentStart);

    return {
      projectId: p.id,
      projectKey: p.key,
      projectName: p.name,
      issueCount,
      doneCount: current.resolvedCount,
      inProgressCount,
      throughput: current.resolvedCount,
      cycleTimeP50: current.cycleTimeP50,
      leadTimeAvg: current.leadTimeAvg,
      healthScore,
      qaRejectionRate: currentQa.overallRejectionRate,
      throughputPrevious: previous.resolvedCount,
      cycleTimeP50Previous: previous.cycleTimeP50,
      leadTimeAvgPrevious: previous.leadTimeAvg,
      healthScorePrevious,
      qaRejectionRatePrevious: previousQa.overallRejectionRate,
      error: null,
    };
  } catch (err) {
    logger.error({ err, projectId: p.id }, `Error processing project ${p.id}`);
    return {
      projectId: p.id,
      projectKey: p.key,
      projectName: p.name,
      issueCount: 0,
      doneCount: 0,
      inProgressCount: 0,
      throughput: 0,
      cycleTimeP50: null,
      leadTimeAvg: null,
      healthScore: null,
      qaRejectionRate: null,
      throughputPrevious: null,
      cycleTimeP50Previous: null,
      leadTimeAvgPrevious: null,
      healthScorePrevious: null,
      qaRejectionRatePrevious: null,
      error: String(err),
    };
  }
}

export async function calculateAndCachePortfolio(options?: { forceRefresh?: boolean }) {
  if (isPortfolioRecalculating) {
    logger.info("Portfolio cache calculation already running, skipping duplicate trigger");
    return;
  }

  isPortfolioRecalculating = true;
  portfolioRecalculationStartedAt = new Date();
  portfolioRecalculationLastError = null;
  logger.info("Starting portfolio cache calculation...");
  const startTime = Date.now();

  try {
    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
    // Global (not per-project), so fetch once instead of once per project in the loop below.
    const qaStatusSet = await getQaStatusSet();
    const jiraProjects = await filterVisibleProjects(
      await listJiraProjects({ forceRefresh: options?.forceRefresh })
    );
    const portfolio: Array<Record<string, unknown>> = [];
    // Projects whose calc timed out or threw. We deliberately do NOT upsert these:
    // writing an all-null placeholder row would overwrite the project's last known-good
    // cached values with zeros/blanks on a transient Jira hiccup. Skipping the write
    // preserves the previous row instead. Tracked here so the skip is logged, not silent.
    const failedProjectIds: string[] = [];

    // Keep concurrency low so Jira searches don't trip the upstream 30s abort.
    const batchSize = 3;
    for (let i = 0; i < jiraProjects.length; i += batchSize) {
      const batch = jiraProjects.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((p) =>
          Promise.race<Record<string, unknown> | null>([
            processProject(p, allowedIssueTypes, qaStatusSet, options),
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), 120000)
              ).then(() => {
              return {
                projectId: p.id,
                projectKey: p.key,
                projectName: p.name,
                issueCount: 0,
                doneCount: 0,
                inProgressCount: 0,
                throughput: 0,
                cycleTimeP50: null,
                leadTimeAvg: null,
                healthScore: null,
                qaRejectionRate: null,
                throughputPrevious: null,
                cycleTimeP50Previous: null,
                leadTimeAvgPrevious: null,
                healthScorePrevious: null,
                qaRejectionRatePrevious: null,
                error: "timeout",
              } as Record<string, unknown>;
            }),
          ])
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value !== null) {
          const row = result.value;
          if (row.error) {
            failedProjectIds.push(String(row.projectId));
          } else {
            portfolio.push(row);
          }
        }
      }
    }

    if (failedProjectIds.length > 0) {
      logger.warn(
        { failedProjectIds, count: failedProjectIds.length },
        "Portfolio calc: some projects timed out or errored; keeping their previous cached rows (not overwriting with nulls)"
      );
    }

    // Sort by throughput (highest first)
    portfolio.sort((a, b) => (b.throughput as number) - (a.throughput as number));

    // Update or insert into database
    for (const item of portfolio) {
      await db
        .insert(portfolioCacheTable)
        .values(item as any)
        .onConflictDoUpdate({
          target: portfolioCacheTable.projectId,
          set: {
            projectKey: item.projectKey as string,
            projectName: item.projectName as string,
            issueCount: item.issueCount as number,
            doneCount: item.doneCount as number,
            inProgressCount: item.inProgressCount as number,
            throughput: item.throughput as number,
            cycleTimeP50: item.cycleTimeP50 as string,
            leadTimeAvg: item.leadTimeAvg as string,
            healthScore: item.healthScore as number,
            qaRejectionRate: item.qaRejectionRate as string,
            throughputPrevious: item.throughputPrevious as number,
            cycleTimeP50Previous: item.cycleTimeP50Previous as string,
            leadTimeAvgPrevious: item.leadTimeAvgPrevious as string,
            healthScorePrevious: item.healthScorePrevious as number,
            qaRejectionRatePrevious: item.qaRejectionRatePrevious as string,
            error: item.error as string,
            calculatedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `Portfolio cache calculated successfully in ${elapsed}ms (${portfolio.length} projects)`
    );
  } catch (err) {
    portfolioRecalculationLastError = String(err);
    logger.error({ err }, "Error calculating portfolio cache");
  } finally {
    isPortfolioRecalculating = false;
    portfolioRecalculationFinishedAt = new Date();
  }
}

export async function getPortfolioRecalculationStatus(): Promise<PortfolioRecalculationStatus> {
  try {
    const [lastCalculated] = await db
      .select({ calculatedAt: portfolioCacheTable.calculatedAt })
      .from(portfolioCacheTable)
      .orderBy(desc(portfolioCacheTable.calculatedAt))
      .limit(1);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(portfolioCacheTable);

    return {
      running: isPortfolioRecalculating,
      startedAt: portfolioRecalculationStartedAt?.toISOString() ?? null,
      finishedAt: portfolioRecalculationFinishedAt?.toISOString() ?? null,
      lastCalculatedAt: lastCalculated?.calculatedAt?.toISOString() ?? null,
      cachedProjects: countRow?.count ?? 0,
      lastError: portfolioRecalculationLastError,
    };
  } catch (err) {
    logger.error({ err }, "Error getting portfolio recalculation status");
    return {
      running: isPortfolioRecalculating,
      startedAt: portfolioRecalculationStartedAt?.toISOString() ?? null,
      finishedAt: portfolioRecalculationFinishedAt?.toISOString() ?? null,
      lastCalculatedAt: null,
      cachedProjects: 0,
      lastError: portfolioRecalculationLastError ?? String(err),
    };
  }
}

// Export function to check if cache needs refresh (older than 1 day)
export async function isPortfolioCacheStale(): Promise<boolean> {
  try {
    const cached = await db.query.portfolioCacheTable.findFirst({
      orderBy: (t) => [t.calculatedAt],
    });

    if (!cached) return true;

    const oneDayMs = 24 * 60 * 60 * 1000;
    const age = Date.now() - cached.calculatedAt.getTime();
    return age > oneDayMs;
  } catch (err) {
    logger.error({ err }, "Error checking portfolio cache staleness");
    return true;
  }
}
