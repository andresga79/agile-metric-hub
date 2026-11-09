import { describe, it, expect } from "vitest";
import { buildScrumTeamView } from "../v2/team-scrum";
import { toPortfolioRow, errorRow, buildPortfolioView } from "../v2/portfolio";
import type { PortfolioRow, SprintFacts, TrendRow } from "../v2/types";

const committedSp = [99, 86, 99, 101, 112, 99];
const doneSp = [63, 42, 57, 72, 85, 53];
const added = [31, 30, 10, 25, 42, 51];
const carry = [40, 47, 52, 45, 43, 43];
const doneIssues = [25, 18, 21, 28, 32, 22];
function sprint(i: number): SprintFacts {
  return {
    sprintId: 112 + i, name: `S${112 + i}`, state: "closed", startDate: null, endDate: null, closeDate: null,
    basis: "storyPoints", committedSp: committedSp[i], committedIssues: 30,
    rovoDoneSp: doneSp[i], rovoDoneIssues: doneIssues[i], rovoRate: 0,
    realDoneSp: doneSp[i], realDoneIssues: doneIssues[i], realRate: (doneSp[i] / committedSp[i]) * 100,
    addedSp: 0, addedIssues: 0, addedRate: added[i], carryoverSp: 0, carryoverRate: carry[i],
    deliveredByType: { historia: 0, tecnico: 0, bug: 0 },
    cycleTimes: [2 + i, 4 + i], leadTimes: [6 + i, 8 + i],
  };
}
const all = [0, 1, 2, 3, 4, 5].map(sprint);
const olimpo = buildScrumTeamView({
  project: { id: "p1", key: "OLI", name: "Olimpo" }, windowSprints: 6,
  display: all, recent: all.slice(3), previous: all.slice(0, 3),
  active: null, nextSprintName: null, timeInStatus: [], wipAging: [], thresholds: {},
});

const mk = (name: string, rate: number | null, over: Partial<PortfolioRow> = {}): PortfolioRow => ({
  projectId: name, projectKey: name, projectName: name, boardType: "scrum",
  avgRealRate: rate, realDeltaPp: null, band: null, minRate: null, maxRate: null,
  cycleMedian: null, cycleMedianDeltaPct: null, delivered: null, deliveredDeltaPct: null,
  addedRate: null, carryoverRate: null, attention: [], reading: "", error: null, ...over,
});

describe("portfolio", () => {
  it("averages scrum rates 62/60/51", () => {
    const v = buildPortfolioView([mk("A", 62), mk("B", 60), mk("C", 51)], 6);
    expect(v.summary.scrumAvgRealRate).toBeCloseTo(57.67, 1);
    expect(v.summary.scrumTeams).toBe(3);
  });

  it("row equals the team view", () => {
    const r = toPortfolioRow(olimpo);
    const t = olimpo.trends.find((x) => x.key === "closedIssues") as TrendRow;
    expect(r.avgRealRate).toBe(olimpo.compliance.avgRealRate);
    expect(r.realDeltaPp).toBe(olimpo.compliance.deltaPp);
    expect(r.delivered).toBe(doneIssues.reduce((a, b) => a + b, 0));
    expect(r.deliveredDeltaPct).toBe(t.delta);
    expect(r.cycleMedianDeltaPct).toBe(olimpo.flow.cycleMedianDeltaPct);
    expect(r.attention).toEqual(olimpo.attention);
    expect(r.error).toBeNull();
  });

  it("errorRow is listed but excluded from summary", () => {
    const e = errorRow({ id: "x", key: "X", name: "Boom", boardType: "scrum" }, new Error("jira down"));
    expect(e.error).toBe("jira down");
    const v = buildPortfolioView([mk("A", 60, { realDeltaPp: 3, attention: ["x"] }), e], 6);
    expect(v.rows).toHaveLength(2);
    expect(v.summary.scrumAvgRealRate).toBe(60);
    expect(v.summary.scrumTeams).toBe(1);
    expect(v.summary.improving).toBe(1);
    expect(v.summary.attention).toHaveLength(1);
  });

  it("headline and readings", () => {
    const v = buildPortfolioView([mk("A", 46, { realDeltaPp: -2, attention: ["cumplimiento real 46%", "predictibilidad baja"] })], 6);
    expect(v.headline).toBe("Ningún equipo mejora su cumplimiento. A: cumplimiento real 46%.");
    const row = toPortfolioRow({ ...olimpo, attention: ["cumplimiento real 46%", "predictibilidad baja"] });
    expect(row.reading).toBe("Cumplimiento real 46%; predictibilidad baja.");
    expect(toPortfolioRow({ ...olimpo, attention: [] }).reading).toBe("Mejora su cumplimiento real en 10 pp.");
    expect(buildPortfolioView([mk("A", 60, { realDeltaPp: 3 })], 6).headline).toBe("1 equipo mejora su cumplimiento.");
  });
});
