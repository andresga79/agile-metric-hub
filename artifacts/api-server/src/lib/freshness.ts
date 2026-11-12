/** Data older than this is shown in amber: Jira may have changes the screen doesn't reflect. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** How fresh a project's Jira data is, for the "Datos de Jira: hace X" label. */
export function freshness(fetchedAt: Date | null, now: Date): { fetchedAt: string | null; stale: boolean } {
  if (!fetchedAt) return { fetchedAt: null, stale: false };
  return { fetchedAt: fetchedAt.toISOString(), stale: now.getTime() - fetchedAt.getTime() > STALE_AFTER_MS };
}
