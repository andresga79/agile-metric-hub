import { describe, it, expect } from "vitest";
import { computeSprintMetrics, selectSprintWindow } from "../sprint-metrics";
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

  it("completion uses the current Jira status, like Rovo: a cleanup closed after the sprint is left out entirely", async () => {
    // OLP-3756: carried through sprints 106-112 unfinished, closed TO DO -> DONE in the 2026-10-14 cleanup.
    const laterCleanup = issue("C-1", {
      status: "DONE", category: "done",
      transitions: [["TO DO", "DONE", "2026-10-14T00:00:00.000Z"]],
    });
    const m = await computeSprintMetrics(sprint, [delivered, laterCleanup], ["Story"], [sprint]);
    expect(m.totalIssues).toBe(1);
    expect(m.completedIssues).toBe(1);
    expect(m.completionRate).toBe(100);
  });
});

// Tablero Sprint 117: Rovo/"% Finalizado (acum.)" counts what is Done today (86 of 99 SP), while
// "% Real cerrado" only counts what was already Done when the sprint closed (53 of 99 SP).
describe("computeSprintMetrics: % real cerrado vs cumulative completion", () => {
  const doneInSprint = issue("R-1", {
    status: "Listo", category: "done", assigned: true,
    transitions: [["To Do", "En progreso", "2026-09-15T00:00:00.000Z"], ["En progreso", "Listo", "2026-09-20T00:00:00.000Z"]],
  });
  const doneInNextSprint = issue("R-2", {
    status: "Listo", category: "done", assigned: true,
    transitions: [["To Do", "En progreso", "2026-09-16T00:00:00.000Z"], ["En progreso", "Listo", "2026-09-30T00:00:00.000Z"]],
  });

  it("a closed sprint reports both: done today and done at close", async () => {
    const m = await computeSprintMetrics(sprint, [doneInSprint, doneInNextSprint], ["Story"], [sprint]);
    expect(m.completedIssues).toBe(2);
    expect(m.completionRate).toBe(100);
    expect(m.closedAtSprintEndIssues).toBe(1);
    expect(m.closedAtSprintEndRate).toBe(50);
  });

  it("a sprint that hasn't closed has no 'done at close' yet", async () => {
    const active: JiraSprint = { ...sprint, state: "active", completeDate: undefined };
    const m = await computeSprintMetrics(active, [doneInSprint], ["Story"], [active]);
    expect(m.closedAtSprintEndIssues).toBeNull();
    expect(m.closedAtSprintEndRate).toBeNull();
  });
});

// "Comprometido" used to be the sprint's final scope, including what entered after the planning
// (Tablero Sprint 118: ~52 issues, part of them added mid-sprint). The plan is what was in the
// sprint at the end of day 1; "% real cerrado sobre planificado" only counts those issues.
describe("computeSprintMetrics: planned scope vs added after planning", () => {
  const plannedDone = issue("P-1", {
    status: "Listo", category: "done", assigned: true,
    transitions: [["To Do", "En progreso", "2026-09-15T00:00:00.000Z"], ["En progreso", "Listo", "2026-09-20T00:00:00.000Z"]],
  });
  const plannedLate = issue("P-2", {
    status: "Listo", category: "done", assigned: true,
    transitions: [["To Do", "En progreso", "2026-09-16T00:00:00.000Z"], ["En progreso", "Listo", "2026-09-30T00:00:00.000Z"]],
  });
  // Created straight into the sprint mid-way: entry = creation date, after the day-1 cutoff.
  const addedDone: JiraIssue = {
    ...issue("A-1", {
      status: "Listo", category: "done", assigned: true,
      transitions: [["To Do", "En progreso", "2026-09-19T00:00:00.000Z"], ["En progreso", "Listo", "2026-09-22T00:00:00.000Z"]],
    }),
  };
  addedDone.fields = { ...addedDone.fields, created: "2026-09-18T00:00:00.000Z" };

  it("splits the scope into planned and added, and rates the plan on planned issues only", async () => {
    const m = await computeSprintMetrics(sprint, [plannedDone, plannedLate, addedDone], ["Story"], [sprint]);
    expect(m.totalIssues).toBe(3);
    expect(m.addedAfterPlanningCount).toBe(1);
    expect(m.plannedIssues).toBe(2);
    expect(m.plannedStoryPoints).toBe(0);
    expect(m.closedAtSprintEndPlannedIssues).toBe(1);
    expect(m.closedAtSprintEndPlannedRate).toBe(50);
    expect(m.closedAtSprintEndRate).toBeCloseTo(66.67, 1);
  });

  it("an active sprint has no planned rate at close, only its current planned progress", async () => {
    const active: JiraSprint = { ...sprint, state: "active", completeDate: undefined };
    const m = await computeSprintMetrics(active, [plannedDone, plannedLate, addedDone], ["Story"], [active]);
    expect(m.closedAtSprintEndPlannedRate).toBeNull();
    expect(m.plannedCompletionRate).toBe(100);
  });

  it("no planned issues → planned rates are null, not 0", async () => {
    const m = await computeSprintMetrics(sprint, [addedDone], ["Story"], [sprint]);
    expect(m.plannedIssues).toBe(0);
    expect(m.closedAtSprintEndPlannedRate).toBeNull();
    expect(m.plannedCompletionRate).toBeNull();
  });
});

// The Sprints page reads the same cadence as Composición del sprint: last 2 / 6 CLOSED sprints,
// plus the sprint in progress as its own row.
describe("selectSprintWindow", () => {
  const s = (id: number, state: string, start: string, end: string): JiraSprint => ({
    id, name: `S${id}`, state, startDate: `${start}T00:00:00.000Z`, endDate: `${end}T00:00:00.000Z`,
    ...(state === "closed" ? { completeDate: `${end}T00:00:00.000Z` } : {}),
  });
  const all = [
    s(4, "closed", "2026-10-05", "2026-10-16"),
    s(1, "closed", "2026-08-24", "2026-09-04"),
    s(9, "future", "2026-11-16", "2026-11-27"),
    s(5, "active", "2026-10-19", "2026-11-02"),
    s(3, "closed", "2026-09-21", "2026-10-02"),
    s(2, "closed", "2026-09-07", "2026-09-17"),
  ];

  it("last N closed, oldest first, then the active sprint; future sprints never", () => {
    expect(selectSprintWindow(all, 2).map((x) => x.id)).toEqual([3, 4, 5]);
    expect(selectSprintWindow(all, 6).map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("no active sprint → only the closed ones", () => {
    expect(selectSprintWindow(all.filter((x) => x.state !== "active"), 2).map((x) => x.id)).toEqual([3, 4]);
  });
});
