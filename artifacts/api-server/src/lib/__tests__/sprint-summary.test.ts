import { describe, it, expect } from "vitest";
import { buildSprintSummary, previousClosedSprint, isUnestimated } from "../sprint-summary";
import type { JiraIssue, JiraSprint } from "../jira";

function issue(key: string, opts: { type: string; sp?: number | null; assignee?: string | null; done: boolean }): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: key,
      status: { name: opts.done ? "DONE" : "TO DO", statusCategory: { key: opts.done ? "done" : "new" } },
      issuetype: { name: opts.type },
      priority: { name: "Medium" },
      created: "2026-10-01T00:00:00.000Z",
      updated: "2026-10-01T00:00:00.000Z",
      ...(opts.sp != null ? { customfield_10016: opts.sp } : {}),
      ...(opts.assignee ? { assignee: { displayName: opts.assignee, accountId: `id-${opts.assignee}` } } : {}),
    },
  } as JiraIssue;
}

const sprint: JiraSprint = {
  id: 116, name: "Tablero Sprint 116", state: "closed",
  startDate: "2026-10-05T00:00:00.000Z", endDate: "2026-10-16T00:00:00.000Z", completeDate: "2026-10-19T13:01:00.000Z",
};
const isDone = (i: JiraIssue) => i.fields.status.statusCategory?.key === "done";

// Shape of Tablero Sprint 116 (Rovo's report): KPIs, per member and per Jira type.
describe("buildSprintSummary", () => {
  const scope = [
    issue("A-1", { type: "Historia", sp: 5, assignee: "Juan", done: true }),
    issue("A-2", { type: "Historia", sp: 3, assignee: "Juan", done: false }),
    issue("A-3", { type: "Error", sp: 1, assignee: "Matías", done: true }),
    issue("A-4", { type: "Deuda Técnica", sp: null, assignee: "Matías", done: false }),
    issue("A-5", { type: "Tarea Técnica", sp: 2, assignee: null, done: true }),
  ];
  const s = buildSprintSummary(sprint, scope, isDone);

  it("KPIs: committed vs delivered, incomplete, bugs and unestimated", () => {
    expect(s.kpis.committedStoryPoints).toBe(11);
    expect(s.kpis.deliveredStoryPoints).toBe(8);
    expect(s.kpis.completionRate).toBeCloseTo(72.73, 1);
    expect(s.kpis.completedIssues).toBe(3);
    expect(s.kpis.incompleteIssues).toBe(2);
    expect(s.kpis.incompleteStoryPoints).toBe(3);
    expect(s.kpis.bugsTotal).toBe(1);
    expect(s.kpis.bugsCompleted).toBe(1);
    expect(s.kpis.unestimatedIssues).toBe(1);
  });

  it("per member: most SP first, unassigned last, totals add up to the KPIs", () => {
    expect(s.members.map((m) => m.name)).toEqual(["Juan", "Matías", null]);
    const juan = s.members[0];
    expect([juan.totalIssues, juan.completedIssues, juan.totalStoryPoints, juan.completedStoryPoints]).toEqual([2, 1, 8, 5]);
    expect(juan.completionRate).toBeCloseTo(62.5, 1);
    expect(s.members.reduce((a, m) => a + m.totalStoryPoints, 0)).toBe(s.kpis.committedStoryPoints);
    expect(s.members.reduce((a, m) => a + m.completedIssues, 0)).toBe(s.kpis.completedIssues);
  });

  it("per Jira type name, with the keys of what was left incomplete", () => {
    const debt = s.types.find((t) => t.type === "Deuda Técnica")!;
    expect(debt.incompleteKeys).toEqual(["A-4"]);
    expect(debt.unestimatedIssues).toBe(1);
    expect(debt.completionRate).toBeNull();
    expect(s.types.find((t) => t.type === "Historia")!.incompleteKeys).toEqual(["A-2"]);
  });

  it("0 story points is an estimate; no value at all is not", () => {
    expect(isUnestimated(issue("Z-1", { type: "Historia", sp: 0, done: false }))).toBe(false);
    expect(isUnestimated(issue("Z-2", { type: "Historia", sp: null, done: false }))).toBe(true);
  });
});

// Rovo's number ("Done hoy": current status) next to the real one (done at sprint close): an issue
// finished after the sprint closed counts in the first and not in the second.
describe("buildSprintSummary Done hoy", () => {
  const scope = [
    issue("B-1", { type: "Historia", sp: 5, done: true }),
    issue("B-2", { type: "Historia", sp: 3, done: true }), // finished after close
    issue("B-3", { type: "Historia", sp: 2, done: false }),
  ];
  const doneAtClose = (i: JiraIssue) => i.key === "B-1";
  const k = buildSprintSummary(sprint, scope, doneAtClose).kpis;

  it("real completion excludes work finished after close; Done hoy counts it", () => {
    expect(k.deliveredStoryPoints).toBe(5);
    expect(k.completionRate).toBeCloseTo(50, 5);
    expect(k.doneTodayStoryPoints).toBe(8);
    expect(k.doneTodayIssues).toBe(2);
    expect(k.doneTodayRate).toBeCloseTo(80, 5);
    expect(k.completionRate).toBeLessThan(k.doneTodayRate);
  });

  it("Done hoy uses the same basis as completion (issue count without story points)", () => {
    const noSp = [
      issue("C-1", { type: "Historia", done: true }),
      issue("C-2", { type: "Historia", done: true }),
      issue("C-3", { type: "Historia", done: false }),
      issue("C-4", { type: "Historia", done: false }),
    ];
    const kk = buildSprintSummary(sprint, noSp, (i) => i.key === "C-1").kpis;
    expect(kk.completionBasis).toBe("issueCount");
    expect(kk.completionRate).toBeCloseTo(25, 5);
    expect(kk.doneTodayStoryPoints).toBe(0);
    expect(kk.doneTodayIssues).toBe(2);
    expect(kk.doneTodayRate).toBeCloseTo(50, 5);
  });
});

describe("previousClosedSprint", () => {
  const s115: JiraSprint = { id: 115, name: "115", state: "closed", completeDate: "2026-10-05T12:48:00.000Z" };
  const s117: JiraSprint = { id: 117, name: "117", state: "closed", completeDate: "2026-11-02T13:00:00.000Z" };
  const s118: JiraSprint = { id: 118, name: "118", state: "active", startDate: "2026-11-02T12:00:00.000Z" };

  it("is the sprint that closed right before this one", () => {
    expect(previousClosedSprint(sprint, [s115, sprint, s117, s118])?.id).toBe(115);
    expect(previousClosedSprint(s115, [s115, sprint])).toBeNull();
  });

  it("for an active sprint, the last closed one even if it closed after the active one started", () => {
    expect(previousClosedSprint(s118, [s115, sprint, s117, s118])?.id).toBe(117);
  });
});
