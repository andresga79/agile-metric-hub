import { describe, it, expect } from "vitest";
import {
  workingDays,
  teamRate,
  recommend,
  availabilityPct,
  personLoad,
  commitmentBand,
  type SprintSample,
  type TeamRate,
} from "../capacity";

describe("workingDays", () => {
  it("counts a two-week Monday-to-Friday sprint as 10", () => {
    expect(workingDays("2026-07-06T09:00:00.000-0300", "2026-07-17T18:00:00.000-0300")).toBe(10);
  });

  it("skips a Sunday start (counts from Monday)", () => {
    // OLI sprint registered as starting Sunday 2026-07-19
    expect(workingDays("2026-07-19T22:00:00.000-0300", "2026-07-31T18:00:00.000-0300")).toBe(10);
  });

  it("uses the calendar date as Jira wrote it, not the UTC-shifted one", () => {
    // 21:00 -03:00 on Friday is Saturday in UTC; must still count Friday
    expect(workingDays("2026-07-13T09:00:00.000-0300", "2026-07-17T21:00:00.000-0300")).toBe(5);
  });

  it("counts a one-day sprint as 1", () => {
    expect(workingDays("2026-08-03T09:00:00.000Z", "2026-08-03T18:00:00.000Z")).toBe(1);
  });

  it("returns 0 when end is before start", () => {
    expect(workingDays("2026-08-10T09:00:00.000Z", "2026-08-07T18:00:00.000Z")).toBe(0);
  });
});

describe("teamRate", () => {
  const s = (personDays: number, completedSp: number, completedIssues: number): SprintSample => ({
    personDays,
    completedSp,
    completedIssues,
  });

  it("returns null with fewer than 3 samples", () => {
    expect(teamRate([s(50, 50, 20), s(50, 40, 18)])).toBeNull();
  });

  it("normalizes by person-days so a 1-week and a 3-week sprint compare fairly", () => {
    // 5-day sprint x 6 people = 30 pd, 15 SP → 0.5/pd ; 15-day x 6 = 90 pd, 45 SP → 0.5/pd
    const rate = teamRate([s(30, 15, 6), s(90, 45, 18), s(60, 30, 12)])!;
    expect(rate.sp.p50).toBeCloseTo(0.5);
    expect(rate.sp.p25).toBeCloseTo(0.5);
    expect(rate.issues.p50).toBeCloseTo(0.2);
    expect(rate.sprintsUsed).toBe(3);
  });

  it("ignores samples with zero person-days", () => {
    expect(teamRate([s(0, 10, 3), s(50, 50, 20), s(50, 40, 18)])).toBeNull();
  });
});

describe("recommend / availabilityPct", () => {
  const rate: TeamRate = {
    sp: { p25: 0.4, p50: 0.5, p75: 0.6 },
    issues: { p25: 0.2, p50: 0.25, p75: 0.3 },
    sprintsUsed: 6,
  };

  it("scales the range with available person-days", () => {
    expect(recommend(100, rate)).toEqual({ sp: [40, 60], issues: [20, 30] });
    expect(recommend(50, rate)).toEqual({ sp: [20, 30], issues: [10, 15] });
  });

  it("gives [0, 0] when nobody is available", () => {
    expect(recommend(0, rate)).toEqual({ sp: [0, 0], issues: [0, 0] });
  });

  it("availability is available / (10 x members), 0 when there are no members", () => {
    expect(availabilityPct(92, 10)).toBe(92);
    expect(availabilityPct(0, 0)).toBe(0);
  });
});

describe("personLoad", () => {
  const rate: TeamRate = {
    sp: { p25: 0.4, p50: 0.5, p75: 0.6 },
    issues: { p25: 0.2, p50: 0.25, p75: 0.3 },
    sprintsUsed: 6,
  };

  it("capacity is the person's available days x the team median", () => {
    expect(personLoad(8, rate, { sp: 0, issues: 0 }).capacity).toEqual({ sp: 4, issues: 2 });
  });

  it("load is the worse of SP load and issue load", () => {
    // capacity 4 SP / 2 issues; assigned 4 SP (100%) and 3 issues (150%) → 150%, over
    const r = personLoad(8, rate, { sp: 4, issues: 3 });
    expect(r.loadPct).toBe(150);
    expect(r.band).toBe("over");
  });

  it("bands: <=85 ok, <=110 warn, >110 over", () => {
    expect(personLoad(8, rate, { sp: 3.4, issues: 0 }).band).toBe("ok"); // 85%
    expect(personLoad(8, rate, { sp: 4.4, issues: 0 }).band).toBe("warn"); // 110%
    expect(personLoad(8, rate, { sp: 4.5, issues: 0 }).band).toBe("over");
  });

  it("zero availability with assigned work is over with null %, no division by zero", () => {
    expect(personLoad(0, rate, { sp: 3, issues: 1 })).toEqual({
      capacity: { sp: 0, issues: 0 },
      loadPct: null,
      band: "over",
    });
  });

  it("nothing assigned is 0% ok", () => {
    expect(personLoad(0, rate, { sp: 0, issues: 0 })).toEqual({
      capacity: { sp: 0, issues: 0 },
      loadPct: 0,
      band: "ok",
    });
  });
});

describe("commitmentBand", () => {
  it("ok up to the max, warn up to +15%, over beyond", () => {
    expect(commitmentBand(60, [45, 60])).toBe("ok");
    expect(commitmentBand(69, [45, 60])).toBe("warn");
    expect(commitmentBand(70, [45, 60])).toBe("over");
  });
});
