import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// This Jira site's nextPageToken never advances (page 2 == page 1), so any chunk with more than
// one page of results used to be silently cut at 100 issues. Searches now paginate by key.

vi.mock("@workspace/db", () => ({ db: { execute: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock("../portfolio-cache", () => ({ calculateAndCachePortfolio: vi.fn() }));
vi.mock("../metric-snapshots", () => ({ storeWeeklySnapshots: vi.fn() }));
vi.mock("../release-sync", () => ({ syncReleaseEpics: vi.fn() }));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fakeIssue(n: number) {
  return {
    id: String(n),
    key: `OLI-${n}`,
    fields: {
      summary: `Issue ${n}`,
      status: { name: "Listo", statusCategory: { key: "done" } },
      issuetype: { name: "Historia" },
      priority: { name: "Medium" },
      created: "2026-09-08T10:00:00.000Z",
      updated: "2026-09-09T10:00:00.000Z",
      resolutiondate: "2026-09-09T10:00:00.000Z",
    },
  };
}

/** A Jira that holds 112 matching issues, ignores pageToken (like the real site) but honours
 *  `key > "OLI-n"` + ORDER BY key. */
function stubJira(total: number): string[] {
  const jqls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/project/search")) return jsonResponse({ values: [{ id: "10013", key: "OLI", name: "OLI" }] });
      const jql = new URL(url).searchParams.get("jql") ?? "";
      jqls.push(jql);
      const maxResults = Number(new URL(url).searchParams.get("maxResults") ?? 100);
      const after = /key > "OLI-(\d+)"/.exec(jql);
      const start = after ? Number(after[1]) + 1 : 1;
      const page = [];
      for (let n = start; n <= total && page.length < maxResults; n++) page.push(fakeIssue(n));
      // nextPageToken present but useless, as on the real site
      return jsonResponse({ issues: page, nextPageToken: "same-token", isLast: false });
    })
  );
  return jqls;
}

describe("Jira search pagination", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env["JIRA_URL"] = "https://example.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns every issue of a chunk with more than one page (112, not 100)", async () => {
    const jqls = stubJira(112);
    const { getResolvedJiraIssuesInRange } = await import("../jira");
    // A 3-day slice -> a single weekly chunk.
    const issues = await getResolvedJiraIssuesInRange("10013", 3, 0);
    expect(new Set(issues.map((i) => i.key)).size).toBe(112);
    expect(jqls.every((q) => q.endsWith("ORDER BY key ASC"))).toBe(true);
    expect(jqls.some((q) => q.includes('key > "OLI-100"'))).toBe(true);
  });

  it("stops after one request when the chunk fits in a page", async () => {
    const jqls = stubJira(40);
    const { getResolvedJiraIssuesInRange } = await import("../jira");
    const issues = await getResolvedJiraIssuesInRange("10013", 3, 0);
    expect(issues).toHaveLength(40);
    expect(jqls).toHaveLength(1);
  });
});

describe("Jira throttling (429/503)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env["JIRA_URL"] = "https://example.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throttleRetryDelayMs honours Retry-After (seconds or date), else backs off, and is capped", async () => {
    const { throttleRetryDelayMs } = await import("../jira");
    expect(throttleRetryDelayMs("2", 1)).toBe(2000);
    expect(throttleRetryDelayMs("0", 1)).toBe(0);
    const now = Date.parse("2026-09-23T15:00:00Z");
    expect(throttleRetryDelayMs("Wed, 23 Sep 2026 15:00:05 GMT", 1, now)).toBe(5000);
    expect(throttleRetryDelayMs(null, 1)).toBe(1000);
    expect(throttleRetryDelayMs(null, 2)).toBe(2000);
    expect(throttleRetryDelayMs("3600", 1)).toBe(30_000);
  });

  it("retries a 429 and returns the data instead of failing the fetch", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
        return jsonResponse({ values: [{ id: 15, type: "scrum", location: { projectId: 10013, projectKey: "OLI" } }] });
      })
    );
    const { getProjectBoardType } = await import("../jira");
    expect(await getProjectBoardType("10013")).toBe("scrum");
    expect(calls).toBe(2);
  });
});

describe("truncated changelogs", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env["JIRA_URL"] = "https://example.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 45 status changes; search only embeds the NEWEST 40, dropping the first move to In Progress.
  const DAY = 86400000;
  const start = Date.parse("2026-06-01T00:00:00.000Z");
  const fullHistories = Array.from({ length: 45 }, (_, n) => ({
    created: new Date(start + n * DAY).toISOString(),
    items: [
      n === 0
        ? { field: "status", fromString: "To Do", toString: "En progreso" }
        : n === 44
          ? { field: "status", fromString: "En progreso", toString: "Listo" }
          : { field: "status", fromString: "En progreso", toString: "En progreso" },
    ],
  }));

  function stub(): { changelogCalls: number } {
    const counter = { changelogCalls: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/project/search")) return jsonResponse({ values: [{ id: "10003", key: "OLP", name: "OLP" }] });
        if (url.includes("/issue/OLP-1/changelog")) {
          counter.changelogCalls++;
          const startAt = Number(new URL(url).searchParams.get("startAt") ?? 0);
          const values = fullHistories.slice(startAt, startAt + 100);
          return jsonResponse({ values, isLast: startAt + values.length >= fullHistories.length, total: fullHistories.length });
        }
        if (url.includes("/status")) return jsonResponse([]);
        const jql = new URL(url).searchParams.get("jql") ?? "";
        if (jql.includes('key > "OLP-1"')) return jsonResponse({ issues: [] });
        return jsonResponse({
          issues: [{
            id: "1",
            key: "OLP-1",
            fields: {
              summary: "Long-lived story",
              status: { name: "Listo", statusCategory: { key: "done" } },
              issuetype: { name: "Historia" },
              priority: { name: "Medium" },
              created: "2026-05-20T00:00:00.000Z",
              updated: fullHistories[44]!.created,
              resolutiondate: fullHistories[44]!.created,
            },
            changelog: { histories: fullHistories.slice(5), total: 45, maxResults: 40 },
          }],
        });
      })
    );
    return counter;
  }

  it("replaces a truncated changelog with the full one, so cycle time starts at the real first In Progress", async () => {
    const counter = stub();
    const { getResolvedJiraIssuesInRange, getCycleTimeDays } = await import("../jira");
    const [issue] = await getResolvedJiraIssuesInRange("10003", 3, 0, { includeChangelog: true });
    expect(counter.changelogCalls).toBe(1);
    expect(issue!.changelog!.histories).toHaveLength(45);
    // Full history: In Progress on day 0, Done on day 44 -> 44 days (truncated view gave ~39).
    expect(await getCycleTimeDays(issue!)).toBeCloseTo(44, 5);
  });

  it("doesn't fetch anything extra when the changelog wasn't truncated", async () => {
    const counter = stub();
    const { completeTruncatedChangelogs } = await import("../jira");
    const issues = [{ id: "2", key: "OLP-2", fields: {} as never, changelog: { histories: [], total: 0, maxResults: 40 } }];
    expect(await completeTruncatedChangelogs(issues)).toBe(0);
    expect(counter.changelogCalls).toBe(0);
  });
});
