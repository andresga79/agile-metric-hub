import { db } from "@workspace/db";
import { portfolioCacheTable } from "@workspace/db/schema";
import {
  listJiraProjects,
  getRecentlyResolvedIssues,
  getIssuesStatusCounts,
  getLeadTimeDays,
  getCycleTimeDays,
} from "./jira";
import { logger } from "./logger";
import { eq } from "drizzle-orm";

const PORTFOLIO_PERIOD_DAYS = 180;

async function processProject(p: { id: string; key: string; name: string }) {
  try {
    const [counts, resolved] = await Promise.all([
      getIssuesStatusCounts(p.id, PORTFOLIO_PERIOD_DAYS),
      getRecentlyResolvedIssues(p.id, PORTFOLIO_PERIOD_DAYS),
    ]);

    const leadTimes = (await Promise.all(resolved.map((i) => getLeadTimeDays(i)))).filter((v): v is number => v !== null);
    const cycleTimes = (await Promise.all(resolved.map((i) => getCycleTimeDays(i)))).filter((v): v is number => v !== null);

    const sortedLead = [...leadTimes].sort((a, b) => a - b);
    const sortedCycle = [...cycleTimes].sort((a, b) => a - b);
    const p50 = sortedLead.length > 0 ? sortedLead[Math.floor(sortedLead.length * 0.5)] : null;
    const cycleP50 = sortedCycle.length > 0 ? sortedCycle[Math.floor(sortedCycle.length * 0.5)] : null;

    return {
      projectId: p.id,
      projectKey: p.key,
      projectName: p.name,
      issueCount: counts.total,
      doneCount: counts.done,
      inProgressCount: counts.inProgress,
      throughput: resolved.length,
      cycleTimeP50: cycleP50?.toString() || null,
      leadTimeAvg: leadTimes.length > 0 ? (Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) * 10) / 10).toString() : null,
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
  logger.info("Starting portfolio cache calculation...");
  const startTime = Date.now();

  try {
    const jiraProjects = await listJiraProjects();
    const portfolio: Array<Record<string, unknown>> = [];

    // Process in batches of 5 to manage load
    const batchSize = 5;
    for (let i = 0; i < jiraProjects.length; i += batchSize) {
      const batch = jiraProjects.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((p) =>
          Promise.race<Record<string, unknown> | null>([
            processProject(p),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 30000)
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
    logger.info(`Portfolio cache calculated successfully in ${elapsed}ms (${portfolio.length} projects)`);
  } catch (err) {
    logger.error("Error calculating portfolio cache:", err);
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
