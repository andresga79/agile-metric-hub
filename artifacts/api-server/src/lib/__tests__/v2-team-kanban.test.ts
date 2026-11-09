import { describe, it, expect } from "vitest";
import { buildKanbanTeamView } from "../v2/team-kanban";
import type { DeliveredIssue } from "../v2/types";

const now = new Date("2026-11-09T12:00:00Z");
const issues = (n: number, cycle: number | null = 3, lead: number | null = 6): DeliveredIssue[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `K-${i}`,
    resolvedAt: new Date(now.getTime() - (i % 85) * 86400000).toISOString(),
    type: (["historia", "tecnico", "bug"] as const)[i % 3],
    cycleDays: cycle,
    leadDays: lead,
  }));
const base = {
  project: { id: "p1", key: "OLI", name: "Olimpo" },
  windowDays: 90 as const,
  timeInStatus: [],
  wipAging: [],
  thresholds: {},
  now,
};

describe("buildKanbanTeamView", () => {
  it("computes delivered delta", () => {
    const v = buildKanbanTeamView({ ...base, current: issues(137), previous: issues(79) });
    expect(v.delivered).toBe(137);
    expect(v.deliveredPrevious).toBe(79);
    expect(v.deliveredDeltaPct).toBeCloseTo(73.4, 1);
    expect(v.generatedAt).toBe(now.toISOString());
  });
  it("flags a throughput drop", () => {
    const v = buildKanbanTeamView({ ...base, current: issues(35), previous: issues(69) });
    expect(v.attention).toEqual(["entregó 49,3% menos"]); // 35 vs 69: −49,28%
  });
  it("null delta and no attention without previous", () => {
    const v = buildKanbanTeamView({ ...base, current: issues(10), previous: [] });
    expect(v.deliveredDeltaPct).toBeNull();
    expect(v.attention).toEqual([]);
  });
  it("buckets a 90-day window by week", () => {
    const v = buildKanbanTeamView({ ...base, current: issues(137), previous: issues(79) });
    expect([13, 14]).toContain(v.byWeek.length);
    expect(v.byWeek.reduce((a, w) => a + w.historia + w.tecnico + w.bug, 0)).toBe(137);
    expect(v.byWeek.map((w) => w.weekStart)).toEqual([...v.byWeek.map((w) => w.weekStart)].sort());
  });
  it("includes empty weeks with null averages and trend rows", () => {
    const v = buildKanbanTeamView({ ...base, current: issues(1, 4, 8), previous: issues(2, 2, 4) });
    expect(v.byWeek.filter((w) => w.cycleAvg === null).length).toBe(v.byWeek.length - 1);
    expect(v.trends.map((t) => t.key)).toEqual(["closedIssues", "cycleMedian", "leadMedian"]);
    expect(v.flow.cycleMedianDeltaPct).toBe(100);
    expect(v.flow.cycleMedian).toBe(4);
  });
});
