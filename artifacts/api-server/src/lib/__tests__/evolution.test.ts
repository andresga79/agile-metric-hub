import { describe, it, expect } from "vitest";
import {
  summarizeTimes,
  assignDeliverySprint,
  ownSprints,
  buildSprintRow,
  aggregateByPeriod,
  compareAroundMilestone,
  FORMULA_VERSION,
  type EvolutionDelivery,
  type EvolutionSprintRow,
  type SprintWindow,
} from "../evolution";
import type { SprintMetric } from "../../routes/sprint-metrics";
import type { JiraSprint } from "../jira";

function delivery(p: Partial<EvolutionDelivery> = {}): EvolutionDelivery {
  return {
    issueKey: "OLP-1",
    issueType: "Task",
    deliveredAt: new Date("2026-11-10T15:00:00Z"),
    leadDays: 5,
    cycleDays: 2,
    storyPoints: 1,
    assigneeId: "a",
    sprintId: 1,
    ...p,
  };
}

function row(p: Partial<EvolutionSprintRow> = {}): EvolutionSprintRow {
  const t = { n: 0, p50: null, p85: null, avg: null };
  return {
    projectId: "OLP", sprintId: 1, sprintName: "S1",
    startAt: new Date("2026-09-01T13:00:00Z"), closedAt: new Date("2026-09-15T13:00:00Z"),
    scopeIssues: 10, scopeSp: 10, plannedIssues: 8, addedIssues: 2, carryoverIssues: 1,
    closedAtEndIssues: 5, closedAtEndSp: 5, realClosedPct: 50, rovoPct: 100,
    delivered: 4, deliveredSp: 4, people: 2, ct: t, lt: t, formulaVersion: FORMULA_VERSION,
    ...p,
  };
}

describe("summarizeTimes", () => {
  it("is all null for an empty sample", () => {
    expect(summarizeTimes([])).toEqual({ n: 0, p50: null, p85: null, avg: null });
  });
  it("hides percentiles below their minimum n but keeps the average", () => {
    expect(summarizeTimes([4, 2])).toEqual({ n: 2, p50: null, p85: null, avg: 3 });
    expect(summarizeTimes([1, 2, 3])).toMatchObject({ n: 3, p50: 2, p85: null });
  });
  it("gives P50 and P85 from n >= 5", () => {
    expect(summarizeTimes([1, 2, 3, 4, 10])).toEqual({ n: 5, p50: 3, p85: 6.4, avg: 4 });
  });
});

describe("assignDeliverySprint", () => {
  const windows: SprintWindow[] = [
    { sprintId: 1, start: new Date("2026-11-02T13:00:00Z"), close: new Date("2026-11-16T13:00:00Z") },
    { sprintId: 2, start: new Date("2026-11-16T13:31:00Z"), close: new Date("2026-11-27T21:00:00Z") },
  ];
  it("treats the close as exclusive (gap between sprints belongs to none)", () => {
    expect(assignDeliverySprint(new Date("2026-11-16T13:00:00Z"), windows)).toBeNull();
  });
  it("assigns by window", () => {
    expect(assignDeliverySprint(new Date("2026-11-16T13:31:00Z"), windows)).toBe(2);
    expect(assignDeliverySprint(new Date("2026-11-10T12:00:00Z"), windows)).toBe(1);
    expect(assignDeliverySprint(new Date("2026-12-30T12:00:00Z"), windows)).toBeNull();
  });
});

describe("ownSprints", () => {
  const sprints = [{ id: 4263, originBoardId: 15 }, { id: 4267, originBoardId: 1350 }, { id: 9 }];
  it("keeps sprints of the board plus those without origin", () => {
    expect(ownSprints(sprints, 1350).map((s) => s.id)).toEqual([4267, 9]);
  });
  it("keeps everything without a board id", () => {
    expect(ownSprints(sprints, null)).toHaveLength(3);
  });
});

describe("buildSprintRow", () => {
  const sprint: JiraSprint = {
    id: 7, name: "Sprint 7", state: "closed",
    startDate: "2026-11-02T13:00:00Z", endDate: "2026-11-16T13:00:00Z", completeDate: "2026-11-16T14:00:00Z",
  };
  const metric = {
    totalIssues: 38, totalStoryPoints: 40, closedAtSprintEndIssues: 22, closedAtSprintEndStoryPoints: 20,
    closedAtSprintEndRate: 53, completionRate: 100, plannedIssues: 16, addedAfterPlanningCount: 22,
    carryoverCount: 14,
  } as SprintMetric;
  it("uses issues for the real closed pct and carries Rovo's rate", () => {
    const r = buildSprintRow("OLP", sprint, metric, [
      delivery({ assigneeId: "a", cycleDays: 1 }),
      delivery({ assigneeId: "a", cycleDays: null }),
      delivery({ assigneeId: "b", cycleDays: 3 }),
    ]);
    expect(r.realClosedPct).toBe(57.9);
    expect(r.rovoPct).toBe(100);
    expect(r).toMatchObject({
      scopeIssues: 38, plannedIssues: 16, addedIssues: 22, carryoverIssues: 14,
      closedAtEndIssues: 22, closedAtEndSp: 20, delivered: 3, people: 2, formulaVersion: FORMULA_VERSION,
    });
    expect(r.ct.n).toBe(2);
    expect(r.lt.n).toBe(3);
  });
  it("rounds Rovo's rate to one decimal, like the real pct (S115: 98.0392… showed as 98.0)", () => {
    const r = buildSprintRow("OLP", sprint, { ...metric, completionRate: (100 / 102) * 100 } as SprintMetric, []);
    expect(r.rovoPct).toBe(98);
  });
  it("has null real pct for an empty scope", () => {
    expect(buildSprintRow("OLP", sprint, { ...metric, totalIssues: 0 } as SprintMetric, []).realClosedPct).toBeNull();
  });
});

describe("aggregateByPeriod", () => {
  it("buckets deliveries by Santiago month", () => {
    const out = aggregateByPeriod([], [delivery({ deliveredAt: new Date("2026-05-01T02:00:00Z") })], "month");
    expect(out.map((p) => p.period)).toEqual(["2026-04"]);
    expect(out[0].delivered).toBe(1);
  });
  it("averages real closed pct of the sprints closing in the period", () => {
    const rows = [
      row({ sprintId: 1, realClosedPct: 50, closedAt: new Date("2026-09-10T13:00:00Z") }),
      row({ sprintId: 2, realClosedPct: 70, closedAt: new Date("2026-09-24T13:00:00Z") }),
    ];
    const out = aggregateByPeriod(rows, [], "month");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ period: "2026-09", sprints: 2, realClosedPct: 60 });
  });
  it("labels quarters", () => {
    const out = aggregateByPeriod([], [delivery({ deliveredAt: new Date("2026-05-20T15:00:00Z") })], "quarter");
    expect(out[0].period).toBe("2026-Q2");
  });
});

describe("compareAroundMilestone", () => {
  const mk = (id: number, start: string, pct: number) =>
    row({ sprintId: id, startAt: new Date(start), realClosedPct: pct, people: 2, delivered: 4 });
  const rows = [
    mk(1, "2026-01-05T13:00:00Z", 16), mk(2, "2026-01-19T13:00:00Z", 50), mk(3, "2026-02-02T13:00:00Z", 67),
    mk(4, "2026-03-02T13:00:00Z", 70), mk(5, "2026-03-16T13:00:00Z", 76),
  ];
  const milestone = new Date("2026-03-01T00:00:00Z");
  it("splits rows and summarizes real closed", () => {
    const { before, after } = compareAroundMilestone(rows, [], milestone);
    expect(before.sprints).toBe(3);
    expect(before.realClosedMean).toBe(44.3);
    expect(before.realClosedStdevPp).toBe(26);
    expect(after.sprints).toBe(2);
    expect(after.realClosedMean).toBe(73);
    expect(after.deliveredPerPersonPerSprint).toBe(2);
  });
  it("pools times from deliveries of each side's sprints", () => {
    const ds = [1, 2, 3, 4, 5].map((i) => delivery({ sprintId: 1, cycleDays: i, leadDays: i }));
    const { before, after } = compareAroundMilestone(rows, ds, milestone);
    expect(before.ctN).toBe(5);
    expect(before.ctP85).toBe(4.4);
    expect(before.ltP50).toBe(3);
    expect(after.ctN).toBe(0);
  });
  it("returns an empty before when the milestone precedes everything", () => {
    const { before } = compareAroundMilestone(rows, [], new Date("2025-01-01T00:00:00Z"));
    expect(before).toEqual({
      sprints: 0, realClosedMean: null, realClosedStdevPp: null, ctP85: null, ctN: 0,
      ltP50: null, ltN: 0, deliveredPerPersonPerSprint: null,
    });
  });
});
