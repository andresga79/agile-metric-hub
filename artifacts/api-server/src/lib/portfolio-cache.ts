import { db } from "@workspace/db";
import { portfolioCacheTable } from "@workspace/db/schema";
import {
  listJiraProjects,
  getIssuesStatusCounts,
} from "./jira";
import { logger } from "./logger";
import { eq } from "drizzle-orm";

const PORTFOLIO_PERIOD_DAYS = 180;

async function processProject(p: { id: string; key: string; name: string }) {
  try {
    const counts = await getIssuesStatusCounts(p.id, PORTFOLIO_PERIOD_DAYS);

    return {
      projectId: p.id,
      projectKey: p.key,
      projectName: p.name,
      issueCount: counts.total,
      doneCount: counts.done,
      inProgressCount: counts.inProgress,
      throughput: counts.done,  // Simplified: throughput = done count from period
      cycleTimeP50: null,  // Skip expensive calculations
      leadTimeAvg: null,   // Skip expensive calculations
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

    // Process in batches of 10 to manage load
    const batchSize = 10;
    for (let i = 0; i < jiraProjects.length; i += batchSize) {
      const batch = jiraProjects.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((p) =>
          Promise.race<Record<string, unknown> | null>([
            processProject(p),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 60000)
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
