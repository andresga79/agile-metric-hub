import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A sprint Jira failed to return must fail the composition, not count as an empty sprint: an
// empty sprint lowers Issues/sprint and shifts Capacity's expected mix with no signal to the user.

const execute = vi.fn();
vi.mock("@workspace/db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));
vi.mock("../portfolio-cache", () => ({ calculateAndCachePortfolio: vi.fn() }));
vi.mock("../release-sync", () => ({ syncReleaseEpics: vi.fn() }));

const sprint = {
  id: 117,
  name: "Sprint 117",
  state: "closed",
  startDate: "2026-10-20T12:00:00.000Z",
  endDate: "2026-11-03T12:00:00.000Z",
  completeDate: "2026-11-03T15:00:00.000Z",
};

describe("loadCompositionSprint", () => {
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

  it("rejects when Jira fails to return the sprint's issues", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const { loadCompositionSprint } = await import("../sprint-composition-source");

    await expect(
      loadCompositionSprint(sprint as never, "OLP", ["Story", "Bug"], new Map())
    ).rejects.toThrow();
  });
});
