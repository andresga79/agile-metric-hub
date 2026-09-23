import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A Jira failure must fall back for *this* request only - never be written to jira_cache,
// where it used to stick for the full 6h TTL (Scrum project read as "simple", no sprints,
// mock project list).

const execute = vi.fn();
vi.mock("@workspace/db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));
vi.mock("../portfolio-cache", () => ({ calculateAndCachePortfolio: vi.fn() }));
vi.mock("../metric-snapshots", () => ({ storeWeeklySnapshots: vi.fn() }));
vi.mock("../release-sync", () => ({ syncReleaseEpics: vi.fn() }));

/** Number of cache writes (INSERT INTO jira_cache ...) issued so far. */
function cacheWrites(): number {
  return execute.mock.calls.filter(([query]) =>
    JSON.stringify(query).includes("INSERT INTO jira_cache")
  ).length;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const scrumBoards = {
  values: [{ id: 15, type: "scrum", location: { projectId: 10013, projectKey: "OLI" } }],
};

describe("Jira failures are not cached", () => {
  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] }); // cache always cold
    process.env["JIRA_URL"] = "https://example.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getProjectBoardType: 500 -> 'simple' for this call, nothing cached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const { getProjectBoardType } = await import("../jira");

    expect(await getProjectBoardType("10013")).toBe("simple");
    expect(cacheWrites()).toBe(0);
  });

  it("getProjectBoardType: success is still cached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(scrumBoards)));
    const { getProjectBoardType } = await import("../jira");

    expect(await getProjectBoardType("10013")).toBe("scrum");
    expect(cacheWrites()).toBe(1);
  });

  it("getJiraSprints: board lookup failure -> [] for this call, nothing cached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    const { getJiraSprints } = await import("../jira");

    expect(await getJiraSprints("10013")).toEqual([]);
    expect(cacheWrites()).toBe(0);
  });

  it("getJiraSprints: sprint page failure -> [] for this call, nothing cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/sprint") ? jsonResponse({}, 500) : jsonResponse(scrumBoards)
      )
    );
    const { getJiraSprints } = await import("../jira");

    expect(await getJiraSprints("10013")).toEqual([]);
    expect(cacheWrites()).toBe(0);
  });

  it("getJiraSprints: a board that doesn't support sprints is a real answer and is cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/sprint")
          ? new Response("El tablero no admite sprints", { status: 400 })
          : jsonResponse(scrumBoards)
      )
    );
    const { getJiraSprints } = await import("../jira");

    expect(await getJiraSprints("10013")).toEqual([]);
    expect(cacheWrites()).toBe(1);
  });

  it("listJiraProjects: failure -> mock list for this call, nothing cached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const { listJiraProjects } = await import("../jira");

    const projects = await listJiraProjects();
    expect(projects.length).toBeGreaterThan(0);
    expect(cacheWrites()).toBe(0);
  });
});

describe("getJiraIssuesForWindow", () => {
  beforeEach(() => {
    vi.resetModules();
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    process.env["JIRA_URL"] = "https://example.atlassian.net";
    process.env["JIRA_EMAIL"] = "test@example.com";
    process.env["JIRA_API_TOKEN"] = "token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Records every JQL sent, answers each search with no issues. */
  function stubSearch(): string[] {
    const jqls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const jql = new URL(url).searchParams.get("jql");
        if (jql) jqls.push(jql);
        if (url.includes("/project/search")) return jsonResponse({ values: [{ id: "10013", key: "OLI", name: "OLI" }] });
        return jsonResponse({ issues: [], values: [] });
      })
    );
    return jqls;
  }

  it("within the 90-day cap issues exactly the same queries as getJiraIssuesForProject", async () => {
    const baseline = stubSearch();
    const { getJiraIssuesForProject } = await import("../jira");
    await getJiraIssuesForProject("10013", 60);

    vi.resetModules();
    const jqls = stubSearch();
    const { getJiraIssuesForWindow } = await import("../jira");
    await getJiraIssuesForWindow("10013", 60);
    expect(jqls).toEqual(baseline);
  });

  it("beyond the cap also fetches resolved issues older than 90 days", async () => {
    const jqls = stubSearch();
    const { getJiraIssuesForWindow } = await import("../jira");
    await getJiraIssuesForWindow("10013", 93);
    const since = new Date(Date.now() - 93 * 86400000).toISOString().split("T")[0]!;
    expect(jqls.some((q) => q.includes(`resolutiondate >= "${since}"`))).toBe(true);
  });
});
