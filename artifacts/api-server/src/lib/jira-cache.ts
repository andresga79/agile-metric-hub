import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const CACHE_TTL_MS = 30 * 60 * 1000;

let lastSyncedAt: Date | null = null;
let isSyncing = false;

export function getLastSyncedAt(): Date | null {
  return lastSyncedAt;
}

export function getIsSyncing(): boolean {
  return isSyncing;
}

export async function ensureCacheTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS jira_cache (
      cache_key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getCached<T>(cacheKey: string): Promise<T | null> {
  const result = await db.execute<{
    data: string;
    fetched_at: Date;
  }>(sql`
    SELECT data, fetched_at FROM jira_cache WHERE cache_key = ${cacheKey}
  `);

  const rows = result.rows ?? [];
  if (rows.length === 0) return null;

  const row = rows[0]!;
  const age = Date.now() - new Date(row.fetched_at as unknown as string).getTime();
  if (age > CACHE_TTL_MS) return null;

  return row.data as unknown as T;
}

async function setCache<T>(cacheKey: string, data: T): Promise<void> {
  await db.execute(sql`
    INSERT INTO jira_cache (cache_key, data, fetched_at)
    VALUES (${cacheKey}, ${JSON.stringify(data)}::jsonb, NOW())
    ON CONFLICT (cache_key) DO UPDATE
    SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
  `);
}

export async function withCache<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const { isJiraConfigured } = await import("./jira");
  if (!isJiraConfigured()) {
    return fetchFn();
  }

  const cached = await getCached<T>(cacheKey);
  if (cached !== null) {
    logger.debug({ cacheKey }, "Cache hit");
    return cached;
  }

  logger.debug({ cacheKey }, "Cache miss, fetching from Jira");
  const fresh = await fetchFn();
  await setCache(cacheKey, fresh);
  return fresh;
}

export function projectsCacheKey(): string {
  return "projects";
}

export function issuesCacheKey(projectId: string, periodDays: number): string {
  return `issues:${projectId}:${periodDays}`;
}

export function sprintsCacheKey(projectId: string): string {
  return `sprints:${projectId}`;
}

export async function warmCache(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const { isJiraConfigured, listJiraProjects, getRecentlyResolvedIssues, getIssuesStatusCounts, getProjectBoardType, getJiraSprints } = await import("./jira");
    if (!isJiraConfigured()) return;

    const projects = await listJiraProjects();
    let aborted = false;
    const overallTimeout = setTimeout(() => {
      logger.warn("Warm cache overall timeout reached, proceeding with partial cache");
      aborted = true;
      isSyncing = false;
    }, 180000);

    const batchSize = 3;
    try {
      for (let i = 0; i < projects.length; i += batchSize) {
        if (aborted) break;
        const batch = projects.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map((project) =>
            Promise.race([
              (async () => {
                try {
                  await Promise.allSettled([
                    getRecentlyResolvedIssues(project.id, 30),
                    getIssuesStatusCounts(project.id, 30),
                    getProjectBoardType(project.id),
                    getJiraSprints(project.id),
                  ]);
                } catch (_) {
                  /* individual project error already logged upstream */
                }
              })(),
              new Promise<void>((resolve) =>
                setTimeout(() => {
                  logger.warn({ projectId: project.id }, "Warm cache project timeout, skipping");
                  resolve();
                }, 60000)
              ),
            ])
          )
        );
        logger.info(`Warm cache progress: ${Math.min(i + batchSize, projects.length)}/${projects.length} projects`);
      }
      if (!aborted) {
        lastSyncedAt = new Date();
        logger.info({ projectCount: projects.length }, "Cache warmed successfully");
      }
    } finally {
      clearTimeout(overallTimeout);
    }
  } catch (err) {
    logger.error({ err }, "Cache warm failed");
  } finally {
    isSyncing = false;
  }
}

export function startBackgroundSync(): void {
  (async () => {
    const { isJiraConfigured } = await import("./jira");
    if (!isJiraConfigured()) return;
    warmCache();
  })();
  setInterval(warmCache, 15 * 60 * 1000);
  logger.info("Background sync started (interval: 15min)");
}

export async function clearCache(cacheKey: string): Promise<void> {
  await db.execute(sql`DELETE FROM jira_cache WHERE cache_key = ${cacheKey}`);
}

export async function getCacheTimestamp(cacheKey: string): Promise<Date | null> {
  const result = await db.execute<{ fetched_at: Date }>(
    sql`SELECT fetched_at FROM jira_cache WHERE cache_key = ${cacheKey}`
  );
  const rows = result.rows ?? [];
  return rows.length > 0 ? (rows[0]!.fetched_at as unknown as Date) : null;
}
