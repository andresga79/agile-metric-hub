import { db, releaseEpicsTable } from "@workspace/db";
import { fetchReleaseCoordinationEpics } from "./jira";
import { logger } from "./logger";

/**
 * Replaces the full contents of release_epics with the current state of Jira project RC.
 * Called once per sync cycle (see jira-cache.ts executeSync) - RC is shared across all
 * projects, so this must not run inside the per-project warm loop.
 */
export async function syncReleaseEpics(): Promise<void> {
  const epics = await fetchReleaseCoordinationEpics();
  if (epics.length === 0) {
    logger.info("No RC epics fetched, leaving release_epics untouched");
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(releaseEpicsTable);
    await tx.insert(releaseEpicsTable).values(
      epics.map((e) => ({
        issueKey: e.key,
        summary: e.summary,
        description: e.description,
        status: e.status,
        statusCategory: e.statusCategory,
        assignee: e.assignee,
        jiraUpdatedAt: new Date(e.updated),
      }))
    );
  });

  logger.info({ count: epics.length }, "Synced RC (Release Coordination) epics");
}
