import { db } from "@workspace/db";
import { portfolioCacheTable } from "@workspace/db/schema";
import {
  listJiraProjects,
  getJiraIssuesForProject,
  getLeadTimeDays,
  getCycleTimeDays,
  getResolutionDate,
  isIssueDone,
  isIssueInProgress,
  mapIssueType,
} from "./jira";
import { getPortfolioAllowedIssueTypes } from "./portfolio-metric-settings";
import { logger } from "./logger";
import { desc, sql } from "drizzle-orm";

const PORTFOLIO_METRICS_PERIOD_DAYS = 30;
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

async function getLightweightPortfolioMetrics(
  issues: Awaited<ReturnType<typeof getJiraIssuesForProject>>
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - PORTFOLIO_METRICS_PERIOD_DAYS);

  const resolvedWithDates = await Promise.all(
    issues
      .filter((issue) => isIssueDone(issue))
      .map(async (issue) => ({
        issue,
        resolvedAt: await getResolutionDate(issue),
      }))
  );

  const resolved = resolvedWithDates
    .filter((entry) => entry.resolvedAt && entry.resolvedAt >= startDate)
    .map((entry) => entry.issue);

  const leadTimes = (
    await Promise.all(resolved.map((issue) => getLeadTimeDays(issue)))
  ).filter((value): value is number => value !== null);

  const cycleTimes = (
    await Promise.all(resolved.map((issue) => getCycleTimeDays(issue)))
  ).filter((value): value is number => value !== null);

  const averageLeadTime =
    leadTimes.length > 0
      ? Math.round(
          (leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length) * 10
        ) / 10
      : null;

  const cycleTimeP50 = (() => {
    if (cycleTimes.length === 0) return null;
    const sorted = [...cycleTimes].sort((a, b) => a - b);
    const idx = (sorted.length - 1) * 0.5;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const value =
      lo === hi
        ? sorted[lo]
        : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
    return Math.round(value * 10) / 10;
  })();

  return {
    cycleTimeP50,
    leadTimeAvg: averageLeadTime,
  };
}

async function processProject(
  p: { id: string; key: string; name: string },
  allowedIssueTypes: string[]
) {
  try {
    const issues = await getJiraIssuesForProject(p.id, PORTFOLIO_METRICS_PERIOD_DAYS);
    const allowedTypeSet = new Set(allowedIssueTypes.map((value) => mapIssueType(value)));
    const filteredIssues = issues.filter((issue) => {
      if (allowedTypeSet.size === 0) return true;
      return allowedTypeSet.has(mapIssueType(issue.fields.issuetype?.name ?? ""));
    });

    const issueCount = filteredIssues.length;
    const doneCount = filteredIssues.filter((issue) => isIssueDone(issue)).length;
    const inProgressCount = filteredIssues.filter((issue) => isIssueInProgress(issue)).length;
    const { cycleTimeP50, leadTimeAvg } = await getLightweightPortfolioMetrics(
      filteredIssues
    );

    return {
      projectId: p.id,
      projectKey: p.key,
      projectName: p.name,
      issueCount,
      doneCount,
      inProgressCount,
      throughput: doneCount,
      cycleTimeP50,
      leadTimeAvg,
      error: null,
    };
  } catch (err) {
    logger.error(`Error processing project ${p.id}:`, err);
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
      error: String(err),
    };
  }
}

export async function calculateAndCachePortfolio() {
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
    const jiraProjects = await listJiraProjects();
    const portfolio: Array<Record<string, unknown>> = [];

    // Keep concurrency low so Jira searches don't trip the upstream 30s abort.
    const batchSize = 3;
    for (let i = 0; i < jiraProjects.length; i += batchSize) {
      const batch = jiraProjects.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((p) =>
          Promise.race<Record<string, unknown> | null>([
            processProject(p, allowedIssueTypes),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 15000)
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
                error: "timeout",
              } as Record<string, unknown>;
            }),
          ])
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value !== null) {
          portfolio.push(result.value);
        }
      }
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
            issueCount: item.issueCount as number,
            doneCount: item.doneCount as number,
            inProgressCount: item.inProgressCount as number,
            throughput: item.throughput as number,
            cycleTimeP50: item.cycleTimeP50 as string,
            leadTimeAvg: item.leadTimeAvg as string,
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
    logger.error("Error calculating portfolio cache:", err);
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
    logger.error("Error getting portfolio recalculation status:", err);
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
    logger.error("Error checking portfolio cache staleness:", err);
    return true;
  }
}
