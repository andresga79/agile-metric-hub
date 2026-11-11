import { describe, it, expect } from "vitest";
import { buildCurrentSprintView, sprintBusinessDays, withBusinessDays } from "../v2/current-sprint";
import type { WipAgingItem } from "../flow-insights";
import type { SprintFacts } from "../v2/types";

const TZ = "America/Santiago";
// Tablero Sprint 118 as Jira has it: started Mon 2 Nov 10:13 local, ends Fri 13 Nov 18:00 local.
const START = "2026-11-02T13:13:38.857Z";
const END = "2026-11-13T21:00:00.000Z";

describe("sprintBusinessDays", () => {
  it("Wed 11 Nov: day 8 of 10, 7 fully behind", () => {
    expect(sprintBusinessDays(START, END, new Date("2026-11-11T12:00:00Z"), TZ)).toEqual({ total: 10, elapsed: 7, current: 8 });
  });

  it("uses the local day: 01:00 UTC on Thu 12 is still Wed 11 in Santiago", () => {
    expect(sprintBusinessDays(START, END, new Date("2026-11-12T01:00:00Z"), TZ)).toEqual({ total: 10, elapsed: 7, current: 8 });
  });

  it("first day: nothing behind yet", () => {
    expect(sprintBusinessDays(START, END, new Date("2026-11-02T20:00:00Z"), TZ)).toEqual({ total: 10, elapsed: 0, current: 1 });
  });

  it("weekend counts as the last weekday, with Friday fully behind", () => {
    expect(sprintBusinessDays(START, END, new Date("2026-11-07T15:00:00Z"), TZ)).toEqual({ total: 10, elapsed: 5, current: 5 });
  });

  it("past the end date (sprint not closed yet): all behind, capped", () => {
    expect(sprintBusinessDays(START, END, new Date("2026-11-17T15:00:00Z"), TZ)).toEqual({ total: 10, elapsed: 10, current: 10 });
  });

  it("null without dates or with an end before the start", () => {
    expect(sprintBusinessDays(null, END, new Date(), TZ)).toBeNull();
    expect(sprintBusinessDays(END, START, new Date(), TZ)).toBeNull();
  });
});

const facts = (over: Partial<SprintFacts> = {}): SprintFacts => ({
  sprintId: 118, name: "Tablero Sprint 118", state: "active", startDate: START, endDate: END, closeDate: null,
  basis: "storyPoints", committedSp: 117, committedIssues: 49, rovoDoneSp: 85, rovoDoneIssues: 29, rovoRate: 72.6,
  realDoneSp: null, realDoneIssues: null, realRate: null, addedSp: 28, addedIssues: 21, addedRate: 23.9,
  carryoverSp: 52, carryoverRate: 44.4, deliveredByType: { historia: 12, tecnico: 11, bug: 6 }, cycleTimes: [], leadTimes: [],
  ...over,
});
const wip = (key: string, alertLevel: WipAgingItem["alertLevel"]): WipAgingItem => ({
  id: key, key, summary: "", assignee: null, issueType: "Task", priority: "Medium", daysInProgress: 1, alertLevel, enteredDate: "",
});
const project = { id: "10003", key: "TAB", name: "Tablero" };

describe("buildCurrentSprintView + withBusinessDays", () => {
  const view = buildCurrentSprintView({
    project,
    sprint: facts(),
    timeInStatus: [
      { status: "To Do", category: "new", totalDays: 1, avgDays: 9, medianDays: 1, issueCount: 1 },
      { status: "DEV in Progress", category: "indeterminate", totalDays: 1, avgDays: 2, medianDays: 1, issueCount: 1 },
      { status: "Ready for QA", category: "indeterminate", totalDays: 1, avgDays: 3, medianDays: 1, issueCount: 1 },
    ],
    wipAging: [wip("A", "critical"), wip("B", "warning"), wip("C", "watch"), wip("D", null)],
  });

  it("keeps flow statuses only, longest first, and today's WIP", () => {
    expect(view.timeInStatus.map((r) => r.status)).toEqual(["Ready for QA", "DEV in Progress"]);
    expect(view.wip.total).toBe(4);
    expect(view.wip.aged.map((a) => a.key)).toEqual(["A", "B"]);
  });

  it("the cached part carries no today-dependent fields", () => {
    expect(view.businessDays).toBeNull();
    expect(view.expectedRate).toBeNull();
  });

  it("expected pace = business days behind / total", () => {
    const v = withBusinessDays(view, new Date("2026-11-11T12:00:00Z"), TZ);
    expect(v.businessDays).toEqual({ total: 10, elapsed: 7, current: 8 });
    expect(v.expectedRate).toBe(70);
  });

  it("no active sprint: no days, no pace", () => {
    const none = withBusinessDays(buildCurrentSprintView({ project, sprint: null, timeInStatus: [], wipAging: [] }), new Date(), TZ);
    expect(none.sprint).toBeNull();
    expect(none.businessDays).toBeNull();
    expect(none.expectedRate).toBeNull();
  });
});
