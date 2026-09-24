import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../jira", () => ({
  isJiraConfigured: () => true,
}));

vi.mock("../portfolio-cache", () => ({ calculateAndCachePortfolio: vi.fn() }));
vi.mock("../metric-snapshots", () => ({ storeWeeklySnapshots: vi.fn() }));
vi.mock("../release-sync", () => ({ syncReleaseEpics: vi.fn() }));

describe("withCache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shares one in-flight fetch across concurrent calls for the same cache key", async () => {
    const { withCache } = await import("../jira-cache");
    let calls = 0;
    const fetchFn = () =>
      new Promise<number>((resolve) => {
        calls++;
        setTimeout(() => resolve(42), 20);
      });

    // Two report-page endpoints requesting the same historical range in parallel, as
    // report-insights and the metrics compareTo comparison do for a 1m report.
    const [a, b] = await Promise.all([
      withCache("issues:proj:range:60-30:changelog", fetchFn),
      withCache("issues:proj:range:60-30:changelog", fetchFn),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe(42);
    expect(b).toBe(42);
  });
});

describe("purgeStaleCacheEntries", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("deletes every row outside the current tenant + schema-version namespace", async () => {
    vi.stubEnv("JIRA_URL", "https://Example.atlassian.net/");
    vi.stubEnv("JIRA_EMAIL", "Someone@Example.com");
    const { db } = await import("@workspace/db");
    const execute = vi.mocked(db.execute);
    execute.mockClear();
    execute.mockResolvedValueOnce({ rows: [], rowCount: 110 } as never);

    const { purgeStaleCacheEntries } = await import("../jira-cache");
    const purged = await purgeStaleCacheEntries();

    expect(purged).toBe(110);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    const prefix = "tenant:https://example.atlassian.net/|someone@example.com|v2:";
    // Compares the exact key prefix (not LIKE, whose `_` wildcard would also match look-alikes).
    expect(query.sql).toBe("DELETE FROM jira_cache WHERE left(cache_key, $1) <> $2");
    expect(query.params).toEqual([prefix.length, prefix]);
    vi.unstubAllEnvs();
  });
});
