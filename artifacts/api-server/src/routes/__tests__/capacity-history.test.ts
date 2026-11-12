import { describe, it, expect, vi } from "vitest";
import type { JiraIssue, JiraSprint } from "../../lib/jira";

const sprintIssues: JiraIssue[] = [];
vi.mock("../../lib/jira", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/jira")>();
  return { ...actual, getSprintIssues: vi.fn(async () => sprintIssues) };
});

const { loadSprintIssues } = await import("../capacity");

function issue(key: string, transitions: Array<[from: string, to: string, at: string]>): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: key,
      status: { name: "Done", statusCategory: { key: "done" } },
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      created: "2026-10-01T00:00:00.000Z",
      updated: "2026-11-10T00:00:00.000Z",
      assignee: { displayName: "Dev", accountId: "dev-1" },
      customfield_10016: 5,
    } as JiraIssue["fields"],
    changelog: {
      histories: transitions.map(([from, to, at]) => ({
        created: at,
        items: [{ field: "status", fromString: from, toString: to }],
      })),
    },
  };
}

const closed: JiraSprint = {
  id: 117, name: "Sprint 117", state: "closed",
  startDate: "2026-10-19T11:00:00.000Z", endDate: "2026-11-02T11:00:00.000Z", completeDate: "2026-11-02T12:47:00.000Z",
};

describe("Capacity history: closed sprints count what was Done at close", () => {
  it("doesn't credit a carried-over issue finished after the sprint closed", async () => {
    sprintIssues.length = 0;
    sprintIssues.push(
      issue("OLP-1", [["To Do", "In Progress", "2026-10-20T10:00:00Z"], ["In Progress", "Done", "2026-10-28T10:00:00Z"]]),
      issue("OLP-2", [["To Do", "In Progress", "2026-10-20T10:00:00Z"], ["In Progress", "Done", "2026-11-10T10:00:00Z"]]),
    );
    const rows = await loadSprintIssues(closed, "OLP", ["Story"]);
    expect(rows.map((r) => [r.key, r.done])).toEqual([["OLP-1", true], ["OLP-2", false]]);
  });

  it("keeps 'done now' for an active sprint", async () => {
    const active: JiraSprint = { ...closed, state: "active", completeDate: undefined };
    const rows = await loadSprintIssues(active, "OLP", ["Story"]);
    expect(rows.every((r) => r.done)).toBe(true);
  });
});
