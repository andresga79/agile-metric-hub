import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { calculateAndCachePortfolio } from "./portfolio-cache";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAILY_SYNC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const JIRA_CACHE_NAMESPACE = (() => {
  const jiraUrl = (process.env["JIRA_URL"] ?? "").trim().toLowerCase();
  const jiraEmail = (process.env["JIRA_EMAIL"] ?? "").trim().toLowerCase();
  return `tenant:${jiraUrl}|${jiraEmail}`;
})();

function scopedCacheKey(cacheKey: string): string {
  return `${JIRA_CACHE_NAMESPACE}:${cacheKey}`;
}

let lastSyncedAt: Date | null = null;
let isSyncing = false;
let lastSyncStartedAt: Date | null = null;
let lastSyncFinishedAt: Date | null = null;
let lastSyncError: string | null = null;
let lastSyncTrigger: "startup" | "daily" | "manual" | null = null;
let syncProcessedProjects = 0;
let syncTotalProjects = 0;

type SyncTrigger = "startup" | "daily" | "manual";

export interface SyncStatus {
  lastSyncedAt: string | null;
  isSyncing: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  trigger: SyncTrigger | null;
  lastError: string | null;
  processedProjects: number;
  totalProjects: number;
}

export function getLastSyncedAt(): Date | null {
  return lastSyncedAt;
}

export function getIsSyncing(): boolean {
  return isSyncing;
}

export function getSyncStatus(): SyncStatus {
  return {
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    isSyncing,
    startedAt: lastSyncStartedAt ? lastSyncStartedAt.toISOString() : null,
    finishedAt: lastSyncFinishedAt ? lastSyncFinishedAt.toISOString() : null,
    trigger: lastSyncTrigger,
    lastError: lastSyncError,
    processedProjects: syncProcessedProjects,
    totalProjects: syncTotalProjects,
  };
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

  const scopedKey = scopedCacheKey(cacheKey);
  const cached = await getCached<T>(scopedKey);
  if (cached !== null) {
    logger.debug({ cacheKey: scopedKey }, "Cache hit");
    return cached;
  }

  logger.debug({ cacheKey: scopedKey }, "Cache miss, fetching from Jira");
  const fresh = await fetchFn();
  await setCache(scopedKey, fresh);
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

async function warmVisibleProjectsCache(): Promise<void> {
  try {
    const { isJiraConfigured, listJiraProjects, getProjectBoardType, getJiraSprints, getJiraIssuesForProject } = await import("./jira");
    const { filterVisibleProjects } = await import("./project-visibility");
    if (!isJiraConfigured()) return;

    const projects = await filterVisibleProjects(await listJiraProjects());
    syncTotalProjects = projects.length;
    syncProcessedProjects = 0;

    const CONCURRENCY = 3;
    const PROJECT_WARM_TIMEOUT_MS = 15000;
    for (let i = 0; i < projects.length; i += CONCURRENCY) {
      const batch = projects.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (project) => {
          const warmPromise = Promise.all([
            getJiraIssuesForProject(project.id, 90).catch(() => null),
            getJiraIssuesForProject(project.id, 90, { includeChangelog: true }).catch(() => null),
            getProjectBoardType(project.id).catch(() => null),
            getJiraSprints(project.id).catch(() => null),
          ]).then(() => "ok" as const);

          const timeoutPromise = new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), PROJECT_WARM_TIMEOUT_MS)
          );

          const result = await Promise.race<["ok" | "timeout"] | "ok" | "timeout">([
            warmPromise,
            timeoutPromise,
          ] as const);

          if (result === "timeout") {
            logger.warn({ projectId: project.id }, "Warm cache timeout, skipping");
          } else {
            logger.debug({ projectId: project.id }, "Warm cache done");
          }
          syncProcessedProjects += 1;
        })
      );
    }
  } catch (err) {
    logger.error({ err }, "Cache warm failed");
  }
}

export async function warmCache(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;
  try {
    await warmVisibleProjectsCache();
    lastSyncedAt = new Date();
  } finally {
    isSyncing = false;
  }
}

async function executeSync(trigger: SyncTrigger): Promise<void> {
  lastSyncStartedAt = new Date();
  lastSyncFinishedAt = null;
  lastSyncError = null;
  lastSyncTrigger = trigger;

  try {
    await warmVisibleProjectsCache();
    await calculateAndCachePortfolio();
    lastSyncedAt = new Date();
    logger.info({ trigger, projects: syncTotalProjects }, "Sync completed");
  } catch (err) {
    lastSyncError = err instanceof Error ? err.message : String(err);
    logger.error({ err, trigger }, "Sync failed");
  } finally {
    lastSyncFinishedAt = new Date();
    isSyncing = false;
  }
}

function canRunDailySync(): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - lastSyncedAt.getTime() >= DAILY_SYNC_MIN_INTERVAL_MS;
}

export async function triggerSyncNow(
  trigger: SyncTrigger = "manual"
): Promise<{ started: boolean; message: string }> {
  const { isJiraConfigured } = await import("./jira");

  if (!isJiraConfigured()) {
    return { started: false, message: "Jira is not configured" };
  }
  if (isSyncing) {
    return { started: false, message: "Sync already running" };
  }
  if (trigger === "daily" && !canRunDailySync()) {
    return { started: false, message: "Daily sync already executed in last 24h" };
  }

  isSyncing = true;
  syncProcessedProjects = 0;
  syncTotalProjects = 0;

  setImmediate(() => {
    void executeSync(trigger);
  });

  return { started: true, message: "Sync started" };
}

export function startBackgroundSync(): void {
  (async () => {
    const startup = await triggerSyncNow("startup");
    logger.info({ startup }, "Startup sync trigger");
  })();

  // Check hourly and run at most once every 24h.
  setInterval(() => {
    void triggerSyncNow("daily");
  }, 60 * 60 * 1000);

  logger.info("Background sync started (daily + on-demand)");
}

export async function clearCache(cacheKey: string): Promise<void> {
  await db.execute(sql`DELETE FROM jira_cache WHERE cache_key = ${scopedCacheKey(cacheKey)}`);
}

export async function getCacheTimestamp(cacheKey: string): Promise<Date | null> {
  const scopedKey = scopedCacheKey(cacheKey);
  const result = await db.execute<{ fetched_at: Date }>(
    sql`SELECT fetched_at FROM jira_cache WHERE cache_key = ${scopedKey}`
  );
  const rows = result.rows ?? [];
  return rows.length > 0 ? (rows[0]!.fetched_at as unknown as Date) : null;
}

export async function clearTenantCache(): Promise<void> {
  const prefix = `${JIRA_CACHE_NAMESPACE}:%`;
  await db.execute(sql`DELETE FROM jira_cache WHERE cache_key LIKE ${prefix}`);
}
