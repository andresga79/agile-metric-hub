import { describe, it, expect } from "vitest";
import { buildScrumTeamView } from "../v2/team-scrum";
import type { SprintFacts, TrendRow } from "../v2/types";
import type { WipAgingItem } from "../flow-insights";

const committedSp = [99, 86, 99, 101, 112, 99];
const doneSp = [63, 42, 57, 72, 85, 53];
const added = [31, 30, 10, 25, 42, 51];
const carry = [40, 47, 52, 45, 43, 43];
const doneIssues = [25, 18, 21, 28, 32, 22];
const committedIssues = [37, 33, 34, 40, 42, 38];

function sprint(i: number): SprintFacts {
  return {
    sprintId: 112 + i, name: `S${112 + i}`, state: "closed", startDate: null, endDate: null, closeDate: null,
    basis: "storyPoints", committedSp: committedSp[i], committedIssues: committedIssues[i],
    rovoDoneSp: doneSp[i], rovoDoneIssues: doneIssues[i], rovoRate: 0,
    realDoneSp: doneSp[i], realDoneIssues: doneIssues[i], realRate: (doneSp[i] / committedSp[i]) * 100,
    addedSp: 0, addedIssues: 0, addedRate: added[i], carryoverSp: 0, carryoverRate: carry[i],
    deliveredByType: { historia: 0, tecnico: 0, bug: 0 },
    cycleTimes: [2 + i, 4 + i], leadTimes: [6 + i, 8 + i],
  };
}
const all = [0, 1, 2, 3, 4, 5].map(sprint);
const wip = (key: string, alertLevel: WipAgingItem["alertLevel"]): WipAgingItem => ({
  id: key, key, summary: "", assignee: null, issueType: "Task", priority: "Medium", daysInProgress: 1, alertLevel, enteredDate: "",
});
const base = {
  project: { id: "p1", key: "OLI", name: "Olimpo" },
  windowSprints: 6 as const,
  display: all, recent: all.slice(3), previous: all.slice(0, 3),
  active: null, nextSprintName: "S118",
  timeInStatus: [
    { status: "Todo", category: "new", totalDays: 1, avgDays: 9, medianDays: 1, issueCount: 1 },
    { status: "In Review", category: "indeterminate", totalDays: 1, avgDays: 1, medianDays: 1, issueCount: 1 },
    { status: "Waiting for QA", category: "indeterminate", totalDays: 1, avgDays: 3, medianDays: 1, issueCount: 1 },
  ],
  wipAging: [wip("A", "critical"), wip("B", "warning"), wip("C", "watch"), wip("D", null)],
  thresholds: {},
};

describe("buildScrumTeamView", () => {
  const v = buildScrumTeamView(base);
  const trend = (k: TrendRow["key"]) => v.trends.find((t) => t.key === k) as TrendRow;

  it("computes compliance over display", () => {
    expect(v.boardType).toBe("scrum");
    expect(v.compliance.avgRealRate).toBeCloseTo(61.78, 1);
    expect(v.compliance.deltaPp).toBeCloseTo(10.23, 1);
    expect(v.compliance.band).toBe("media");
    expect(v.compliance.minRate).toBeCloseTo(48.8, 1);
    expect(v.compliance.maxRate).toBeCloseTo(75.9, 1);
  });

  it("computes trends", () => {
    expect(trend("addedRate").before).toBeCloseTo(23.67, 1);
    expect(trend("addedRate").after).toBeCloseTo(39.33, 1);
    expect(trend("carryoverRate").delta).toBeCloseTo(-2.67, 1);
    expect(trend("carryoverRate").unit).toBe("pp");
    expect(trend("cycleMedian").unit).toBe("%");
    expect(trend("realRate").betterWhen).toBe("up");
    expect(trend("leadMedian").betterWhen).toBe("down");
    expect(v.flow.cycleMedianDeltaPct).toBe(trend("cycleMedian").delta);
  });

  it("recommends planning from last 3", () => {
    expect(v.planning?.plannedSp).toBe(42);
  });

  it("builds flow block", () => {
    expect(v.flow.timeInStatus.map((r) => r.status)).toEqual(["Waiting for QA", "In Review"]);
    expect(v.flow.timeInStatus[0].waiting).toBe(true);
    expect(v.flow.wip.total).toBe(4);
    expect(v.flow.wip.aged.map((a) => a.key)).toEqual(["A", "B"]);
    expect(v.flow.flowEfficiencyPct).toBeCloseTo((5.5 / 9.5) * 100, 1);
  });

  it("2 closed sprints only: no deltas, no planning", () => {
    const two = buildScrumTeamView({ ...base, display: all.slice(0, 2), recent: all.slice(0, 2), previous: [] });
    expect(two.compliance.deltaPp).toBeNull();
    expect(two.compliance.stdDevPp).not.toBeNull();
    expect(two.planning).toBeNull();
    for (const t of two.trends) {
      expect(t.before).toBeNull();
      expect(t.delta).toBeNull();
    }
  });

  it("1 sprint: predictability null", () => {
    const one = buildScrumTeamView({ ...base, display: all.slice(0, 1), recent: all.slice(0, 1), previous: [] });
    expect(one.compliance.stdDevPp).toBeNull();
    expect(one.compliance.band).toBeNull();
  });

  it("active null builds fine", () => {
    expect(v.active).toBeNull();
    expect(v.nextSprintName).toBe("S118");
  });
});
