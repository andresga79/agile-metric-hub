import { describe, it, expect } from "vitest";
import { buildScrumTeamView } from "../v2/team-scrum";
import { buildKanbanTeamView } from "../v2/team-kanban";
import { applyThresholds, v2Thresholds } from "../v2/thresholds";
import type { DeliveredIssue, KanbanTeamView, ScrumTeamView, SprintFacts } from "../v2/types";
import type { EffectiveThreshold } from "../health-thresholds";

// The colour bands and attention cut-offs ARE the Admin → Health thresholds (spec §5). The
// facts are cached for 6 h, so band/attention are re-derived from the cached numbers with the
// thresholds read on every request: an Admin change must apply without rebuilding the facts.

const eff = (g: number, w: number): EffectiveThreshold => ({ goodValue: g, warningValue: w, isOverride: false });

const committedSp = [99, 86, 99, 101, 112, 99];
const doneSp = [63, 42, 57, 72, 85, 53];
function sprint(i: number): SprintFacts {
  return {
    sprintId: 112 + i, name: `S${112 + i}`, state: "closed", startDate: null, endDate: null, closeDate: null,
    basis: "storyPoints", committedSp: committedSp[i], committedIssues: 30,
    rovoDoneSp: doneSp[i], rovoDoneIssues: 20, rovoRate: 0,
    realDoneSp: doneSp[i], realDoneIssues: 20, realRate: (doneSp[i] / committedSp[i]) * 100,
    addedSp: 0, addedIssues: 0, addedRate: 10, carryoverSp: 0, carryoverRate: 10,
    deliveredByType: { historia: 0, tecnico: 0, bug: 0 }, cycleTimes: [3], leadTimes: [6],
  };
}
const all = [0, 1, 2, 3, 4, 5].map(sprint);
// avg real ≈ 61,8%, sample std dev ≈ 10,4 pp -> "media" with the 8/12 defaults.
const scrum: ScrumTeamView = buildScrumTeamView({
  project: { id: "p1", key: "OLI", name: "Olimpo" }, windowSprints: 6,
  display: all, recent: all.slice(3), previous: all.slice(0, 3),
  active: null, nextSprintName: null, timeInStatus: [], thresholds: {},
});

const now = new Date("2026-11-09T12:00:00Z");
const issues = (n: number): DeliveredIssue[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `K-${i}`, resolvedAt: new Date(now.getTime() - (i % 85) * 86400000).toISOString(),
    type: "historia", cycleDays: 3, leadDays: 6,
  }));
// 80 -> 64 delivered: −20%, under the default 30% drop cut-off.
const kanban: KanbanTeamView = buildKanbanTeamView({
  project: { id: "p2", key: "KAN", name: "Kanban" }, windowDays: 90,
  current: issues(64), previous: issues(80), timeInStatus: [], wipAging: [], thresholds: {}, now,
});

describe("v2Thresholds", () => {
  it("defaults to 80/50 completion and 8/12 predictability", () => {
    expect(v2Thresholds({})).toEqual({ completionGood: 80, completionWarning: 50, predictabilityGood: 8, predictabilityWarning: 12 });
  });
  it("reads sprintCompletionReal and sprintPredictability", () => {
    expect(v2Thresholds({ sprintCompletionReal: eff(85, 60), sprintPredictability: eff(6, 9) })).toEqual({
      completionGood: 85, completionWarning: 60, predictabilityGood: 6, predictabilityWarning: 9,
    });
  });
});

describe("applyThresholds", () => {
  it("builders expose the thresholds they used", () => {
    expect(scrum.thresholds).toEqual(v2Thresholds({}));
    expect(kanban.thresholds).toEqual(v2Thresholds({}));
    expect(scrum.compliance.band).toBe("media");
    expect(scrum.attention).toEqual([]);
  });

  it("a stricter sprintPredictability flips media -> baja without rebuilding facts", () => {
    const v = applyThresholds(scrum, { sprintPredictability: eff(6, 9) }) as ScrumTeamView;
    expect(v.compliance.band).toBe("baja");
    expect(v.attention).toEqual(["predictibilidad baja"]);
    expect(v.thresholds).toMatchObject({ predictabilityGood: 6, predictabilityWarning: 9 });
    // Numbers untouched.
    expect(v.compliance.stdDevPp).toBe(scrum.compliance.stdDevPp);
    expect(v.sprints).toBe(scrum.sprints);
  });

  it("a looser sprintPredictability flips media -> alta", () => {
    const v = applyThresholds(scrum, { sprintPredictability: eff(11, 15) }) as ScrumTeamView;
    expect(v.compliance.band).toBe("alta");
  });

  it("a higher sprintCompletionReal warning raises the completion attention", () => {
    const v = applyThresholds(scrum, { sprintCompletionReal: eff(90, 65) }) as ScrumTeamView;
    expect(v.attention).toEqual(["cumplimiento real 61,8%"]);
    expect(v.thresholds).toMatchObject({ completionGood: 90, completionWarning: 65 });
  });

  it("a stale cached band/attention is replaced", () => {
    const stale = { ...scrum, compliance: { ...scrum.compliance, band: "alta" as const }, attention: ["x"] };
    const v = applyThresholds(stale, {}) as ScrumTeamView;
    expect(v.compliance.band).toBe("media");
    expect(v.attention).toEqual([]);
  });

  it("kanban is never flagged, whatever its numbers and thresholds", () => {
    const bad = { ...kanban, deliveredDeltaPct: -80, flow: { ...kanban.flow, cycleMedianDeltaPct: 90 }, attention: ["x"] };
    expect(applyThresholds(bad, {}).attention).toEqual([]);
    expect(applyThresholds(bad, { kanbanThroughputDrop: eff(5, 15) }).attention).toEqual([]);
  });

  it("a cached view without thresholds (older shape) gets them", () => {
    const { thresholds: _t, ...old } = scrum;
    const v = applyThresholds(old as ScrumTeamView, {}) as ScrumTeamView;
    expect(v.thresholds).toEqual(v2Thresholds({}));
  });
});
