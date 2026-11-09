import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JiraSprint } from "../jira";

// A Jira failure while building a v2 team view must reject - so nothing is cached under
// v2:team:<id>:... for 6 h - and show up in the portfolio as an error row. The plain Jira
// helpers turn failures into [] / "simple", which v2 would otherwise read as real data.

const store = new Map<string, unknown>();
vi.mock("../jira-cache", () => ({
  withCache: async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (store.has(key)) return store.get(key) as T;
    const v = await fn();
    store.set(key, v);
    return v;
  },
}));
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("../health-thresholds", () => ({ getEffectiveThresholds: vi.fn(async () => ({})) }));
vi.mock("../portfolio-metric-settings", () => ({
  getPortfolioAllowedIssueTypes: vi.fn(async () => ["Story", "Task", "Bug"]),
  KANBAN_EXCLUDED_ISSUE_TYPES: ["Test Execution", "Test", "Test Plan"],
}));
vi.mock("../project-visibility", () => ({ filterVisibleProjects: vi.fn(async <T,>(p: T[]) => p) }));
vi.mock("../flow-insights", () => ({
  computeTimeInStatus: vi.fn(async () => []),
  computeWipAging: vi.fn(async () => []),
}));
vi.mock("../../routes/sprint-metrics", () => ({ sprintScopeIssues: vi.fn(async (issues: unknown[]) => issues) }));

const jira = vi.hoisted(() => ({
  getProjectBoardTypeOrThrow: vi.fn(),
  getJiraSprintsOrThrow: vi.fn(),
  getFutureJiraSprintsOrThrow: vi.fn(),
  getSprintIssuesOrThrow: vi.fn(),
}));
vi.mock("../jira", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../jira")>()),
  ...jira,
  isJiraConfigured: () => true,
  getStatusCategoryMap: vi.fn(async () => new Map()),
  getBoardStatusNames: vi.fn(async () => null),
  listJiraProjects: vi.fn(async () => [{ id: "10013", key: "OLP", name: "Olimpo" }]),
  getJiraProject: vi.fn(async () => ({ id: "10013", key: "OLP", name: "Olimpo" })),
}));

const { getTeamView, getPortfolioView } = await import("../v2/service");

const closed = (id: number, close: string): JiraSprint => ({
  id, name: `S${id}`, state: "closed", startDate: "2026-10-01T00:00:00.000Z", completeDate: close,
});
const sprints = [closed(116, "2026-10-19T13:00:00.000Z"), closed(117, "2026-11-02T13:00:00.000Z")];

describe("v2 service: Jira failures are not cached", () => {
  beforeEach(() => {
    store.clear();
    jira.getProjectBoardTypeOrThrow.mockReset().mockResolvedValue("scrum");
    jira.getJiraSprintsOrThrow.mockReset().mockResolvedValue(sprints);
    jira.getFutureJiraSprintsOrThrow.mockReset().mockResolvedValue([]);
    jira.getSprintIssuesOrThrow.mockReset().mockResolvedValue([]);
  });

  it("control: a successful build is cached under v2:team:<id>:s6", async () => {
    const view = await getTeamView("10013", { sprints: 6 });
    expect(view.boardType).toBe("scrum");
    expect(store.has("v2:team:10013:s6")).toBe(true);
  });

  it("a closed sprint whose issue fetch fails rejects and caches nothing", async () => {
    jira.getSprintIssuesOrThrow.mockImplementation(async (id: number) => {
      if (id === 117) throw new Error("Jira 503");
      return [];
    });
    await expect(getTeamView("10013", { sprints: 6 })).rejects.toThrow("Jira 503");
    expect(store.size).toBe(0);
  });

  it("a failed sprint list rejects instead of a cached 'no sprints' view", async () => {
    jira.getJiraSprintsOrThrow.mockRejectedValue(new Error("Jira 500"));
    await expect(getTeamView("10013", { sprints: 6 })).rejects.toThrow("Jira 500");
    expect(store.size).toBe(0);
  });

  it("a failed board-type detection rejects instead of caching a Kanban view", async () => {
    jira.getProjectBoardTypeOrThrow.mockRejectedValue(new Error("board 502"));
    await expect(getTeamView("10013", { days: 90 })).rejects.toThrow("board 502");
    expect(store.size).toBe(0);
  });

  it("portfolio: a failing sprint fetch becomes an error row", async () => {
    jira.getSprintIssuesOrThrow.mockRejectedValue(new Error("Jira 503"));
    const view = await getPortfolioView(6);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ projectKey: "OLP", boardType: "scrum", error: "Jira 503", avgRealRate: null });
    expect(store.size).toBe(0);
  });

  it("portfolio: a failed board-type detection becomes an error row with boardType scrum", async () => {
    jira.getProjectBoardTypeOrThrow.mockRejectedValue(new Error("board 502"));
    const view = await getPortfolioView(6);
    expect(view.rows[0]).toMatchObject({ projectKey: "OLP", boardType: "scrum", error: "board 502" });
    expect(store.size).toBe(0);
  });
});
