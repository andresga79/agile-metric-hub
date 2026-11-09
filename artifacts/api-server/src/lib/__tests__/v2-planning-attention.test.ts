import { describe, it, expect } from "vitest";
import { recommendPlanning } from "../v2/planning";
import { scrumAttention } from "../v2/attention";
import type { SprintFacts } from "../v2/types";
import type { EffectiveThreshold } from "../health-thresholds";

function f(name: string, sp: number | null, issues: number | null, added: number, basis: "storyPoints" | "issueCount" = "storyPoints"): SprintFacts {
  return {
    sprintId: 1, name, state: "closed", startDate: null, endDate: null, closeDate: null, basis,
    committedSp: 0, committedIssues: 0, rovoDoneSp: 0, rovoDoneIssues: 0, rovoRate: 0,
    realDoneSp: sp, realDoneIssues: issues, realRate: 0, addedSp: 0, addedIssues: 0, addedRate: added,
    carryoverSp: 0, carryoverRate: 0, deliveredByType: { historia: 0, tecnico: 0, bug: 0 }, cycleTimes: [], leadTimes: [],
  };
}
const facts = [f("S115", 72, 28, 25), f("S116", 85, 32, 42), f("S117", 53, 22, 51)];
const eff = (g: number, w: number): EffectiveThreshold => ({ goodValue: g, warningValue: w, isOverride: false });
const T = {
  sprintCompletionReal: eff(80, 50),
};

describe("recommendPlanning", () => {
  it("recommends from the last 3 closed sprints", () => {
    const p = recommendPlanning(facts)!;
    expect(p).toMatchObject({ totalSp: 70, totalIssues: 27, plannedSp: 42, plannedIssues: 17, marginSp: 28, marginIssues: 10 });
    expect(p.unplannedPct).toBeCloseTo(39.33, 2);
    expect(p.basedOn).toEqual(["S115", "S116", "S117"]);
  });
  it("needs exactly 3", () => {
    expect(recommendPlanning(facts.slice(0, 2))).toBeNull();
    expect(recommendPlanning([...facts, facts[0]])).toBeNull();
  });
  it("skips issue-count sprints for SP sums", () => {
    const p = recommendPlanning([facts[0], facts[1], f("S117", null, 22, 51, "issueCount")])!;
    expect(p.totalSp).toBe(79);
    expect(p.totalIssues).toBe(27);
  });
  it("null SP when no sprint has story points", () => {
    const p = recommendPlanning([1, 2, 3].map((i) => f("S" + i, null, 20, 10, "issueCount")))!;
    expect(p.totalSp).toBeNull();
    expect(p.plannedSp).toBeNull();
    expect(p.marginSp).toBeNull();
    expect(p.totalIssues).toBe(20);
  });
});

describe("attention", () => {
  it("scrum", () => {
    expect(scrumAttention(46, "media", T)).toEqual(["cumplimiento real 46%"]);
    expect(scrumAttention(61.8, "baja", T)).toEqual(["predictibilidad baja"]);
    expect(scrumAttention(40, "baja", T)).toEqual(["cumplimiento real 40%", "predictibilidad baja"]);
    expect(scrumAttention(null, null, T)).toEqual([]);
  });
  it("shows one decimal (es-CL) so the reason never contradicts its cut-off", () => {
    expect(scrumAttention(49.6, null, T)).toEqual(["cumplimiento real 49,6%"]);
    expect(scrumAttention(61.78, null, { sprintCompletionReal: eff(80, 65) })).toEqual(["cumplimiento real 61,8%"]);
  });
  it("never rounds onto or across the cut-off", () => {
    // 49,96 would round to 50 (= the cut-off).
    expect(scrumAttention(49.96, null, T)).toEqual(["cumplimiento real 49,9%"]);
  });
  it("falls back to defaults when thresholds are missing", () => {
    expect(scrumAttention(46, null, {})).toEqual(["cumplimiento real 46%"]);
  });
});
