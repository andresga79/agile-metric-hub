import { describe, it, expect } from "vitest";
import { bucketDays, deliveredByWeek } from "../time-buckets";
import { isoWeekLabel } from "../iso-week";

describe("bucketDays", () => {
  it("bucketDays([]) gives the 6 buckets with zero", () => {
    const b = bucketDays([]);
    expect(b.map((x) => x.range)).toEqual(["0-1d", "1-3d", "3-7d", "7-14d", "14-30d", "30d+"]);
    expect(b.every((x) => x.count === 0)).toBe(true);
  });

  it("bucket edges are half-open", () => {
    expect(bucketDays([0, 1, 2.9, 3, 14, 29.9, 30, 427]).map((x) => x.count)).toEqual([1, 2, 1, 0, 2, 2]);
  });
});

describe("deliveredByWeek", () => {
  it("deliveredByWeek groups by ISO week label, ascending", () => {
    const a = new Date("2026-11-02T10:00:00Z");
    const b = new Date("2026-11-04T10:00:00Z");
    const c = new Date("2026-10-28T10:00:00Z");
    expect(deliveredByWeek([a, b, c])).toEqual([
      { week: isoWeekLabel(c), count: 1 },
      { week: isoWeekLabel(a), count: 2 },
    ]);
  });
});
