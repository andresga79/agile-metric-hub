import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { calculateAndCachePortfolio } from "./portfolio-cache";
import { storeWeeklySnapshots } from "./metric-snapshots";
import { syncReleaseEpics } from "./release-sync";

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
let lastSyncOutcome: "success" | "partial" | "failed" | null = null;
let syncProcessedProjects = 0;
let syncTotalProjects = 0;
let syncFailedProjects = 0;

type SyncTrigger = "startup" | "daily" | "manual";

export interface SyncStatus {
  lastSyncedAt: string | null;
  isSyncing: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  trigger: SyncTrigger | null;
  outcome: "success" | "partial" | "failed" | null;
  lastError: string | null;
  processedProjects: number;
  totalProjects: number;
  failedProjects: number;
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
    outcome: lastSyncOutcome,
    lastError: lastSyncError,
    processedProjects: syncProcessedProjects,
    totalProjects: syncTotalProjects,
    failedProjects: syncFailedProjects,
  };
}

// Keep this in sync with the Drizzle model in lib/db/src/schema/jira-cache.ts.
// This raw CREATE is what actually provisions the table at runtime; the Drizzle
// model exists so `drizzle-kit push` knows about the table and won't drop it.
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

// Several report-page endpoints request the same historical issue range in parallel
// (e.g. report-insights and the metrics compareTo comparison both fetch the prior-30-days
// window for a 1m report). Without dedup, a cold cache means each of them independently
// triggers a full paginated Jira fetch for the same key, doubling load right when the
// single Node process is already juggling several concurrent report requests.
const inFlight = new Map<string, Promise<unknown>>();

export async function withCache<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  options?: { forceRefresh?: boolean }
): Promise<T> {
  // The inFlight check/set must happen synchronously, before any `await`, so that two
  // concurrent calls for the same key can't both pass the check before either registers
  // itself — that race let both trigger their own fetchFn (verified by a regression test).
  const scopedKey = scopedCacheKey(cacheKey);

  const existing = inFlight.get(scopedKey);
  if (existing) {
    logger.debug({ cacheKey: scopedKey }, "Joining in-flight fetch");
    return existing as Promise<T>;
  }

  const promise = (async () => {
    const { isJiraConfigured } = await import("./jira");
    if (!isJiraConfigured()) {
      return fetchFn();
    }

    if (!options?.forceRefresh) {
      const cached = await getCached<T>(scopedKey);
      if (cached !== null) {
        logger.debug({ cacheKey: scopedKey }, "Cache hit");
        return cached;
      }
    } else {
      logger.info({ cacheKey: scopedKey }, "Force refresh enabled, skipping cache read");
    }

    logger.debug({ cacheKey: scopedKey }, "Cache miss, fetching from Jira");
    const fresh = await fetchFn();
    await setCache(scopedKey, fresh);
    return fresh;
  })();

  inFlight.set(scopedKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(scopedKey);
  }
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

async function warmVisibleProjectsCache(forceRefresh: boolean = false): Promise<void> {
  try {
    const { isJiraConfigured, listJiraProjects, getProjectBoardType, getJiraSprints, getJiraIssuesForProject } = await import("./jira");
    const { filterVisibleProjects } = await import("./project-visibility");
    if (!isJiraConfigured()) return;

    const projects = await filterVisibleProjects(
      await listJiraProjects({ forceRefresh })
    );
    syncTotalProjects = projects.length;
    syncProcessedProjects = 0;

    // Serial (1 project at a time): on the 512 MB free tier, warming several
    // projects concurrently held multiple full issue+changelog sets in memory
    // at once and segfaulted the process (status 139) before the sync could
    // finish — a crash loop that left lastSyncedAt perpetually null. One at a
    // time trades speed for staying under the memory ceiling. Bump back up only
    // if the instance gets more RAM.
    const CONCURRENCY = 1;
    const PROJECT_WARM_TIMEOUT_MS = 15000;
    for (let i = 0; i < projects.length; i += CONCURRENCY) {
      const batch = projects.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (project) => {
          const warmPromise = Promise.all([
            getJiraIssuesForProject(project.id, 90, { forceRefresh }).catch(() => null),
            getJiraIssuesForProject(project.id, 90, { includeChangelog: true, forceRefresh }).catch(() => null),
            getProjectBoardType(project.id, { forceRefresh }).catch(() => null),
            getJiraSprints(project.id, 50, { forceRefresh }).catch(() => null),
          ]).then(async ([, changelogIssues]) => {
            if (changelogIssues) {
              await storeWeeklySnapshots(project.id, changelogIssues).catch((err) => {
                logger.warn({ err, projectId: project.id }, "Failed to store weekly metric snapshots");
              });
            }
            return "ok" as const;
          });

          const timeoutPromise = new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), PROJECT_WARM_TIMEOUT_MS)
          );

          const result = await Promise.race<["ok" | "timeout"] | "ok" | "timeout">([
            warmPromise,
            timeoutPromise,
          ] as const);

          if (result === "timeout") {
            logger.warn({ projectId: project.id }, "Warm cache timeout, skipping");
            syncFailedProjects += 1;
          } else {
            logger.debug({ projectId: project.id }, "Warm cache done");
          }

          // Mark as failed if any upstream fetch failed and was swallowed in Promise.all catches.
          // We infer this by checking core cache keys after warm attempt.
          const [issuesTs, sprintsTs, boardTs] = await Promise.all([
            getCacheTimestamp(issuesCacheKey(project.id, 90)).catch(() => null),
            getCacheTimestamp(sprintsCacheKey(project.id)).catch(() => null),
            getCacheTimestamp(`boardType:${project.id}`).catch(() => null),
          ]);
          if (result !== "timeout" && (!issuesTs || !sprintsTs || !boardTs)) {
            syncFailedProjects += 1;
            logger.warn({ projectId: project.id }, "Warm cache partial data for project");
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
    await warmVisibleProjectsCache(false);
    lastSyncedAt = new Date();
  } finally {
    isSyncing = false;
  }
}

async function executeSync(trigger: SyncTrigger): Promise<void> {
  const forceRefresh = trigger === "manual";
  lastSyncStartedAt = new Date();
  lastSyncFinishedAt = null;
  lastSyncError = null;
  lastSyncTrigger = trigger;
  lastSyncOutcome = null;

  try {
    await warmVisibleProjectsCache(forceRefresh);
    await syncReleaseEpics().catch((err) => {
      logger.warn({ err }, "RC epics sync failed, continuing");
    });
    await calculateAndCachePortfolio({ forceRefresh });
    lastSyncedAt = new Date();
    lastSyncOutcome = syncFailedProjects > 0 ? "partial" : "success";
    logger.info(
      { trigger, projects: syncTotalProjects, failedProjects: syncFailedProjects, forceRefresh, outcome: lastSyncOutcome },
      "Sync completed"
    );
  } catch (err) {
    lastSyncOutcome = "failed";
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
  syncFailedProjects = 0;

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
