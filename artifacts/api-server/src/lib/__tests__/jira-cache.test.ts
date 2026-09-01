import { describe, it, expect, vi, beforeEach } from "vitest";

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
