import { describe, it, expect } from "vitest";
import { isoWeek, isoWeekLabel, isoWeekStart } from "../iso-week";

describe("isoWeek", () => {
  it.each([
    // The case that exposed the old floor((thu - Jan4)/7)+1 formula: Jan 4 2026 is a Sunday.
    ["2026-09-21T12:00:00Z", 2026, 39],
    ["2026-09-27T23:59:00Z", 2026, 39],
    // Year boundaries: ISO week-year differs from the calendar year.
    ["2026-01-01T00:00:00Z", 2026, 1],
    ["2025-12-29T00:00:00Z", 2026, 1],
    ["2021-01-03T00:00:00Z", 2020, 53],
    ["2027-01-01T00:00:00Z", 2026, 53],
    // A year where Jan 4 is a Monday-Thursday (old formula happened to be right here).
    ["2024-01-01T00:00:00Z", 2024, 1],
    ["2024-12-30T00:00:00Z", 2025, 1],
  ])("%s -> %i-W%i", (iso, year, week) => {
    expect(isoWeek(new Date(iso))).toEqual({ year, week });
  });

  it("agrees with a brute-force week count for every day of 2020-2030", () => {
    // Reference: week N of an ISO year starts N-1 weeks after the Monday of the week holding Jan 4.
    const mondayOfJan4Week = (y: number) => {
      const jan4 = new Date(Date.UTC(y, 0, 4));
      return Date.UTC(y, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
    };
    for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2031, 0, 1); t += 86400000) {
      const d = new Date(t);
      let y = d.getUTCFullYear() + 1;
      while (mondayOfJan4Week(y) > t) y--;
      const week = Math.floor((t - mondayOfJan4Week(y)) / (7 * 86400000)) + 1;
      expect(isoWeek(d)).toEqual({ year: y, week });
    }
  });
});

describe("isoWeekLabel", () => {
  it("zero-pads the week and never produces W00", () => {
    expect(isoWeekLabel(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekLabel(new Date("2026-03-02T00:00:00Z"))).toBe("2026-W10");
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday of the week, including when the date is a Sunday", () => {
    expect(isoWeekStart(new Date("2026-09-23T15:00:00Z"))).toBe("2026-09-21");
    expect(isoWeekStart(new Date("2026-09-27T23:00:00Z"))).toBe("2026-09-21");
    expect(isoWeekStart(new Date("2026-09-21T00:00:00Z"))).toBe("2026-09-21");
    expect(isoWeekStart(new Date("2026-01-01T00:00:00Z"))).toBe("2025-12-29");
  });
});
