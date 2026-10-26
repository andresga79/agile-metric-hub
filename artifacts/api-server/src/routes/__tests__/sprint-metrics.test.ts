import { describe, it, expect } from "vitest";
import { computeSprintMetrics } from "../sprint-metrics";
import type { JiraIssue, JiraSprint } from "../../lib/jira";

const sprint: JiraSprint = {
  id: 47,
  name: "Sprint 47",
  state: "closed",
  startDate: "2026-09-14T00:00:00.000Z",
  endDate: "2026-09-25T00:00:00.000Z",
  completeDate: "2026-09-25T00:00:00.000Z",
};

function issue(key: string, opts: {
  status: string;
  category: "new" | "indeterminate" | "done";
  assigned?: boolean;
  transitions: Array<[from: string, to: string, at: string]>;
}): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: key,
      status: { name: opts.status, statusCategory: { key: opts.category } },
      issuetype: { name: "Story" },
      priority: { name: "Medium" },
      created: "2026-09-01T00:00:00.000Z",
      updated: "2026-10-14T00:00:00.000Z",
      ...(opts.assigned ? { assignee: { displayName: "Dev", accountId: "dev-1" } } : {}),
    },
    changelog: {
      histories: opts.transitions.map(([from, to, at]) => ({
        created: at,
        items: [{ field: "status", fromString: from, toString: to }],
      })),
    },
  };
}

// OLI: Jira's board doesn't treat "Cancelado" as done, so a cancelled issue gets carried into every
// following sprint, and the app counted it as completed in each one (OLI-3629: sprints 46-49).
describe("computeSprintMetrics: closures that aren't delivery", () => {
  const delivered = issue("D-1", {
    status: "Listo", category: "done", assigned: true,
    transitions: [["To Do", "En progreso", "2026-09-15T00:00:00.000Z"], ["En progreso", "Listo", "2026-09-20T00:00:00.000Z"]],
  });

  it("a non-delivery closure already closed when the sprint ended is out of scope and out of completed", async () => {
    // Cleanup closed mid-sprint. (A "Cancelado" takes the same path in production; tests have no
    // Jira status-category map, and the name-based fallback doesn't know "Cancelado" is done.)
    const closedBeforeEnd = issue("X-1", {
      status: "DONE", category: "done",
      transitions: [["TO DO", "DONE", "2026-09-18T00:00:00.000Z"]],
    });
    const m = await computeSprintMetrics(sprint, [delivered, closedBeforeEnd], ["Story"], [sprint]);
    expect(m.totalIssues).toBe(1);
    expect(m.completedIssues).toBe(1);
    expect(m.completionRate).toBe(100);
  });

  it("an issue cleaned up AFTER the sprint ended still counts as committed, not completed, in it", async () => {
    // OLP-3756: carried through sprints 106-112 unfinished, closed TO DO -> DONE in the 2026-10-14 cleanup.
    const laterCleanup = issue("C-1", {
      status: "DONE", category: "done",
      transitions: [["TO DO", "DONE", "2026-10-14T00:00:00.000Z"]],
    });
    const m = await computeSprintMetrics(sprint, [delivered, laterCleanup], ["Story"], [sprint]);
    expect(m.totalIssues).toBe(2);
    expect(m.completedIssues).toBe(1);
    expect(m.completionRate).toBe(50);
  });
});
