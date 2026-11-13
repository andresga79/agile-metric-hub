import { describe, it, expect } from "vitest";
import {
  buildSprintComposition,
  type CompositionIssue,
  type CompositionSprintInput,
  type CompositionDelivered,
} from "../sprint-composition";

let seq = 0;
function issue(category: string, opts: Partial<CompositionIssue> = {}): CompositionIssue {
  seq += 1;
  return { key: `X-${seq}`, category, storyPoints: 0, doneAtClose: false, addedAfterPlanning: false, ...opts };
}
function sprint(id: number, issues: CompositionIssue[]): CompositionSprintInput {
  return { sprintId: id, sprintName: `S${id}`, issues };
}
function times(n: number, make: () => CompositionIssue): CompositionIssue[] {
  return Array.from({ length: n }, make);
}
const row = (c: ReturnType<typeof buildSprintComposition>, category: string) => {
  const r = c.rows.find((x) => x.category === category);
  if (!r) throw new Error(`no row ${category}`);
  return r;
};

describe("buildSprintComposition", () => {
  it("shares and per-sprint averages over the window", () => {
    const c = buildSprintComposition(
      [
        sprint(1, [...times(3, () => issue("Story")), issue("Bug")]),
        sprint(2, [issue("Story"), ...times(3, () => issue("Bug"))]),
      ],
      []
    );
    expect(c.rows.map((r) => r.category)).toEqual(["Story", "Bug"]);
    expect(row(c, "Story").issueShare).toBe(50);
    expect(row(c, "Story").issuesPerSprint).toBe(2);
    expect(row(c, "Bug").issueShare).toBe(50);
    expect(row(c, "Bug").issuesPerSprint).toBe(2);
    expect(c.sprintCount).toBe(2);
    expect(c.totalIssues).toBe(8);
    expect(c.sprints[0].shares.Story).toBe(75);
    expect(c.sprints[0].totalIssues).toBe(4);
  });

  it("averages story points per sprint", () => {
    const c = buildSprintComposition(
      [sprint(1, [issue("Story", { storyPoints: 5 }), issue("Story", { storyPoints: 3 })]), sprint(2, [issue("Story", { storyPoints: 1 })])],
      []
    );
    expect(row(c, "Story").storyPointsPerSprint).toBe(4.5);
  });

  it("realClosedRate is pooled by issues", () => {
    const c = buildSprintComposition(
      [
        sprint(1, [...times(3, () => issue("Story", { doneAtClose: true })), issue("Story")]),
        sprint(2, [issue("Story")]),
      ],
      []
    );
    // 3 of 5 issues (pooled), not the mean of 75% and 0%.
    expect(row(c, "Story").realClosedRate).toBe(60);
  });

  it("addedAfterPlanning rate and per sprint", () => {
    const c = buildSprintComposition(
      [
        sprint(1, [issue("Bug", { addedAfterPlanning: true }), issue("Bug", { addedAfterPlanning: true })]),
        sprint(2, [issue("Bug", { addedAfterPlanning: true }), issue("Bug")]),
      ],
      []
    );
    expect(row(c, "Bug").addedAfterPlanningRate).toBe(75);
    expect(row(c, "Bug").addedAfterPlanningPerSprint).toBe(1.5);
  });

  it("cycle percentiles need 3 delivered", () => {
    const issues = [issue("Story"), issue("Bug")];
    const two: CompositionDelivered[] = [
      { key: "A-1", category: "Story", cycleTimeDays: 2 },
      { key: "A-2", category: "Story", cycleTimeDays: 4 },
    ];
    const few = buildSprintComposition([sprint(1, issues)], two);
    expect(row(few, "Story").cycleP50).toBeNull();
    expect(row(few, "Story").cycleP85).toBeNull();

    const four: CompositionDelivered[] = [2, 4, 6, 8].map((d, i) => ({ key: `B-${i}`, category: "Story", cycleTimeDays: d }));
    const enough = buildSprintComposition([sprint(1, issues)], four);
    expect(row(enough, "Story").cycleP50).toBe(5);
    expect(row(enough, "Story").cycleP85).toBe(7.1);
    expect(row(enough, "Bug").cycleP50).toBeNull();
  });

  it("carried-over issue counts per sprint, cycle once", () => {
    const carried = issue("Story", { key: "X-carry" });
    const c = buildSprintComposition(
      [sprint(1, [carried]), sprint(2, [{ ...carried }])],
      [
        { key: "X-carry", category: "Story", cycleTimeDays: 30 },
        { key: "X-a", category: "Story", cycleTimeDays: 2 },
        { key: "X-b", category: "Story", cycleTimeDays: 4 },
      ]
    );
    expect(row(c, "Story").issuesPerSprint).toBe(1);
    expect(c.totalIssues).toBe(2);
    expect(row(c, "Story").cycleP50).toBe(4);
  });

  it("delivered listed twice by key counts once", () => {
    const c = buildSprintComposition(
      [sprint(1, [issue("Story")])],
      [
        { key: "D-1", category: "Story", cycleTimeDays: 100 },
        { key: "D-1", category: "Story", cycleTimeDays: 100 },
        { key: "D-2", category: "Story", cycleTimeDays: 1 },
        { key: "D-3", category: "Story", cycleTimeDays: 2 },
      ]
    );
    expect(row(c, "Story").cycleP50).toBe(2);
  });

  it("empty sprint counts as zero in the average", () => {
    const c = buildSprintComposition([sprint(1, [issue("Story"), issue("Story")]), sprint(2, [])], []);
    expect(row(c, "Story").issuesPerSprint).toBe(1);
    expect(c.sprintCount).toBe(2);
    expect(c.sprints[1]).toEqual({ sprintId: 2, sprintName: "S2", totalIssues: 0, shares: {} });
  });

  it("no sprints → empty", () => {
    expect(buildSprintComposition([], [])).toEqual({ sprintCount: 0, totalIssues: 0, rows: [], sprints: [] });
  });

  it("row order is fixed, unknown types after, alphabetic", () => {
    const c = buildSprintComposition(
      [sprint(1, [issue("Zeta"), issue("Task"), issue("Story"), issue("Alpha")])],
      []
    );
    expect(c.rows.map((r) => r.category)).toEqual(["Story", "Task", "Alpha", "Zeta"]);
  });

  it("category with no issues is omitted", () => {
    const c = buildSprintComposition(
      [sprint(1, [issue("Story")])],
      [1, 2, 3].map((d) => ({ key: `Bug-${d}`, category: "Bug", cycleTimeDays: d }))
    );
    expect(c.rows.map((r) => r.category)).toEqual(["Story"]);
  });

  it("null cycle times are ignored", () => {
    const c = buildSprintComposition(
      [sprint(1, [issue("Story")])],
      [
        { key: "N-1", category: "Story", cycleTimeDays: null },
        { key: "N-2", category: "Story", cycleTimeDays: 2 },
        { key: "N-3", category: "Story", cycleTimeDays: 4 },
      ]
    );
    expect(row(c, "Story").cycleP50).toBeNull();
  });

  it("rounds to one decimal", () => {
    const c = buildSprintComposition(
      [sprint(1, [issue("Story"), issue("Story"), issue("Bug")]), sprint(2, []), sprint(3, [])],
      []
    );
    expect(row(c, "Story").issueShare).toBe(66.7);
    expect(row(c, "Story").issuesPerSprint).toBe(0.7);
    expect(row(c, "Bug").issueShare).toBe(33.3);
  });
});
