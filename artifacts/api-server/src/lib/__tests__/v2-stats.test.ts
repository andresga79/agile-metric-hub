import { describe, it, expect } from "vitest";
import { mean, sampleStdDev, pctChange, ppChange, predictabilityBand } from "../v2/stats";
import { selectSprintWindow, parseSprintWindow, parseDayWindow } from "../v2/window";
import type { JiraSprint } from "../jira";

const sprints: JiraSprint[] = [
  ...[110, 111, 112, 113, 114, 115, 116, 117].map((n, i) => ({
    id: n,
    name: `S${n}`,
    state: "closed",
    startDate: `2026-0${1 + Math.floor(i / 2)}-${i % 2 ? "15" : "01"}T00:00:00Z`,
    endDate: `2026-0${1 + Math.floor(i / 2)}-${i % 2 ? "28" : "14"}T00:00:00Z`,
    completeDate: `2026-0${1 + Math.floor(i / 2)}-${i % 2 ? "28" : "14"}T12:00:00Z`,
  })),
  { id: 118, name: "S118", state: "active", startDate: "2026-06-01T00:00:00Z", endDate: "2026-06-14T00:00:00Z" },
];
const names = (l: JiraSprint[]) => l.map((s) => s.name);

describe("v2 stats", () => {
  it("mean / stddev", () => {
    const v = [63.6, 48.8, 57.6, 71.3, 75.9, 53.5];
    expect(mean(v)).toBeCloseTo(61.78, 2);
    expect(mean([])).toBeNull();
    expect(sampleStdDev(v)).toBeCloseTo(10.47, 2);
    expect(sampleStdDev([60])).toBeNull();
  });
  it("changes", () => {
    expect(pctChange(21.33, 27.33)).toBeCloseTo(28.1, 1);
    expect(pctChange(0, 5)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
    expect(pctChange(5, null)).toBeNull();
    expect(ppChange(56.67, 66.9)).toBeCloseTo(10.23, 2);
    expect(ppChange(null, 1)).toBeNull();
  });
  it("predictability band", () => {
    const t = { goodValue: 8, warningValue: 12 };
    expect(predictabilityBand(8, t)).toBe("alta");
    expect(predictabilityBand(10.47, t)).toBe("media");
    expect(predictabilityBand(12.01, t)).toBe("baja");
    expect(predictabilityBand(null, t)).toBeNull();
  });
});

describe("v2 window", () => {
  it("size 6", () => {
    const w = selectSprintWindow(sprints, 6);
    expect(names(w.display)).toEqual(["S112", "S113", "S114", "S115", "S116", "S117"]);
    expect(names(w.previous)).toEqual(["S112", "S113", "S114"]);
    expect(names(w.recent)).toEqual(["S115", "S116", "S117"]);
    expect(w.active?.name).toBe("S118");
  });
  it("size 3", () => {
    const w = selectSprintWindow(sprints, 3);
    expect(names(w.recent)).toEqual(["S115", "S116", "S117"]);
    expect(names(w.previous)).toEqual(["S112", "S113", "S114"]);
  });
  it("size 12 with 8 closed (fewer than window)", () => {
    const w = selectSprintWindow(sprints, 12);
    expect(w.display).toHaveLength(8);
    expect(w.recent).toHaveLength(8);
    expect(w.previous).toEqual([]);
  });
  it("fewer closed than window, shuffled input, no active", () => {
    const w = selectSprintWindow(sprints.slice(0, 2).reverse(), 6);
    expect(names(w.display)).toEqual(["S110", "S111"]);
    expect(names(w.recent)).toEqual(["S110", "S111"]);
    expect(w.previous).toEqual([]);
    expect(w.active).toBeNull();
  });
  it("parsers", () => {
    expect(parseSprintWindow("12")).toBe(12);
    expect(parseSprintWindow("7")).toBe(6);
    expect(parseSprintWindow(undefined)).toBe(6);
    expect(parseDayWindow(undefined)).toBe(90);
    expect(parseDayWindow("180")).toBe(180);
    expect(parseDayWindow("45")).toBe(90);
  });
});
