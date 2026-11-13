import { describe, it, expect, vi } from "vitest";
import type { JiraIssue, JiraSprint } from "../jira";

// Fixed per-issue facts so the test is about bucketing, not about changelog parsing.
const facts: Record<string, { delivered: string; lead: number; cycle: number }> = {
  "1": { delivered: "2026-10-10T00:00:00Z", lead: 4, cycle: 2 },
  "2": { delivered: "2026-10-12T00:00:00Z", lead: 6, cycle: 3 },
  // Carried over from sprint A, delivered in sprint B: must count once, in B only.
  "3": { delivered: "2026-10-22T00:00:00Z", lead: 427, cycle: 5 },
  "4": { delivered: "2026-10-24T00:00:00Z", lead: 8, cycle: 1 },
  "5": { delivered: "2026-10-26T00:00:00Z", lead: 10, cycle: 3 },
};

vi.mock("../jira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../jira")>();
  return {
    ...actual,
    getJiraIssuesForWindow: vi.fn(async () => Object.keys(facts).map(issue)),
    getDeliveryDate: vi.fn(async (i: JiraIssue) => new Date(facts[i.id]!.delivered)),
    getLeadTimeDays: vi.fn(async (i: JiraIssue) => facts[i.id]!.lead),
    getCycleTimeDays: vi.fn(async (i: JiraIssue) => facts[i.id]!.cycle),
  };
});
vi.mock("../portfolio-metric-settings", () => ({ getPortfolioAllowedIssueTypes: async () => ["Story"] }));

function issue(id: string): JiraIssue {
  return {
    id,
    key: `OLP-${id}`,
    fields: {
      summary: "x",
      status: { name: "Done", statusCategory: { key: "done" } },
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-02T00:00:00.000Z",
    },
  };
}

const { sprintDeliveryTimes } = await import("../sprint-delivery-times");

describe("sprintDeliveryTimes", () => {
  const a: JiraSprint = { id: 1, name: "Sprint A", state: "closed", startDate: "2026-10-05T00:00:00Z", completeDate: "2026-10-19T00:00:00Z" };
  const b: JiraSprint = { id: 2, name: "Sprint B", state: "closed", startDate: "2026-10-19T00:00:00Z", completeDate: "2026-11-02T00:00:00Z" };

  it("buckets each issue once, by delivery date, and takes the median", async () => {
    const t = await sprintDeliveryTimes("10003", [a, b]);
    expect(t.perSprint.get(1)).toEqual({ lead: 5, cycle: 2.5, cycleCount: 2 });
    // The 427-day carryover only moves sprint B's median one rank, not its mean by ~140 days.
    expect(t.perSprint.get(2)).toEqual({ lead: 10, cycle: 3, cycleCount: 3 });
  });

  it("pools closed sprints for the window-level median", async () => {
    const t = await sprintDeliveryTimes("10003", [a, b]);
    expect(t.closedPooled).toEqual({ lead: 8, cycle: 3 });
  });

  it("leaves the active sprint out of the pooled median", async () => {
    const active: JiraSprint = { ...b, state: "active", completeDate: undefined, endDate: "2026-11-02T00:00:00Z" };
    const t = await sprintDeliveryTimes("10003", [a, active]);
    expect(t.closedPooled).toEqual({ lead: 5, cycle: 2.5 });
    expect(t.perSprint.get(2)).toEqual({ lead: 10, cycle: 3, cycleCount: 3 });
  });

  // A per-sprint P50 over 2 deliveries swings a lot: the Sprints table shows the n beside it.
  it("reports how many delivered issues each sprint's median is over", async () => {
    const t = await sprintDeliveryTimes("10003", [a, b]);
    expect(t.perSprint.get(1)?.cycleCount).toBe(2);
    expect(t.perSprint.get(2)?.cycleCount).toBe(3);
  });
});
