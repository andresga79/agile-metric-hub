import { describe, it, expect } from "vitest";
import {
  workingDays,
  teamRate,
  recommend,
  availabilityPct,
  personLoad,
  commitmentBand,
  availableDays,
  sprintSample,
  summarizeAssigned,
  buildTeam,
  buildTeamRows,
  validateCapacityRows,
  sprintClock,
  expectedByToday,
  paceBand,
  sprintDates,
  absenceTotal,
  validateAbsences,
  type Absence,
  type SprintSample,
  type TeamRate,
  type CapacityIssue,
  type MemberAvailability,
  type RosterEntry,
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
    // An active sprint uses its real working days, not the fixed 10.
    expect(availabilityPct(18, 2, 9)).toBe(100);
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

const issue = (key: string, accountId: string | null, storyPoints: number, done = false): CapacityIssue => ({
  key,
  accountId,
  displayName: accountId ? `Name ${accountId}` : null,
  storyPoints,
  done,
});
const member = (accountId: string, over: Partial<MemberAvailability> = {}): MemberAvailability => ({
  accountId,
  displayName: `Name ${accountId}`,
  absenceDays: 0,
  dedicationPct: 100,
  counts: true,
  manual: false,
  ...over,
});
const rosterEntry = (accountId: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  accountId,
  displayName: `Name ${accountId}`,
  counts: true,
  manual: false,
  ...over,
});

describe("availableDays", () => {
  it("is working days x dedication minus absence, never negative, 0 when not counting", () => {
    expect(availableDays(member("a", { absenceDays: 2 }), 10)).toBe(8);
    expect(availableDays(member("a", { dedicationPct: 50 }), 10)).toBe(5);
    expect(availableDays(member("a", { dedicationPct: 50, absenceDays: 7 }), 10)).toBe(0);
    expect(availableDays(member("a", { counts: false }), 10)).toBe(0);
  });
});

describe("sprintSample", () => {
  const start = "2026-07-06T09:00:00.000-0300";
  const end = "2026-07-17T18:00:00.000-0300"; // 10 working days
  const none = new Set<string>();

  it("without saved availability, counts each distinct assignee full-time", () => {
    const s = sprintSample({
      startDate: start,
      endDate: end,
      issues: [issue("A-1", "a", 3, true), issue("A-2", "b", 5, false), issue("A-3", "a", 2, true)],
      saved: [],
      notCounting: none,
    })!;
    expect(s).toEqual({ personDays: 20, completedSp: 5, completedIssues: 2 });
  });

  it("uses saved availability when the sprint was planned in Capacity", () => {
    const s = sprintSample({
      startDate: start,
      endDate: end,
      issues: [issue("A-1", "a", 3, true)],
      saved: [member("a", { absenceDays: 2 }), member("b", { dedicationPct: 50 })],
      notCounting: none,
    })!;
    expect(s.personDays).toBe(13);
  });

  it("adds full-time days for an assignee who was not in the saved availability", () => {
    // planned with a and b; c was assigned mid-sprint and completed work
    const s = sprintSample({
      startDate: start,
      endDate: end,
      issues: [issue("A-1", "a", 3, true), issue("A-2", "c", 13, true)],
      saved: [member("a"), member("b")],
      notCounting: none,
    })!;
    expect(s.personDays).toBe(30);
    expect(s.completedSp).toBe(16);
  });

  it("people who do not count add no days, but what they completed still counts", () => {
    const s = sprintSample({
      startDate: start,
      endDate: end,
      issues: [issue("A-1", "dev", 5, true), issue("A-2", "po", 1, true)],
      saved: [],
      notCounting: new Set(["po"]),
    })!;
    expect(s).toEqual({ personDays: 10, completedSp: 6, completedIssues: 2 });
  });

  it("returns null without dates", () => {
    expect(sprintSample({ startDate: undefined, endDate: end, issues: [], saved: [], notCounting: none })).toBeNull();
  });

  it("returns null when nobody who counts was assigned (0 person-days)", () => {
    expect(
      sprintSample({ startDate: start, endDate: end, issues: [issue("A-1", null, 3, true)], saved: [], notCounting: none })
    ).toBeNull();
  });
});

describe("summarizeAssigned", () => {
  it("groups by assignee, separates unassigned and counts unestimated", () => {
    const r = summarizeAssigned([issue("A-1", "a", 3), issue("A-2", "a", 0), issue("A-3", null, 5)]);
    expect(r.byAccount.get("a")).toEqual({ sp: 3, issues: 2 });
    expect(r.unassigned).toEqual({ sp: 5, issues: 1 });
    expect(r.total).toEqual({ sp: 8, issues: 3 });
    expect(r.unestimated).toBe(1);
  });
});

describe("buildTeam", () => {
  it("roster members (counting or not) plus new assignees, who count by default; counting first", () => {
    const team = buildTeam({
      roster: [rosterEntry("b", { counts: false })],
      recentIssues: [issue("A-1", "c", 1), issue("A-2", "b", 1)],
      saved: [member("c", { absenceDays: 3 })],
    });
    expect(team.map((m) => [m.accountId, m.counts])).toEqual([
      ["c", true],
      ["b", false],
    ]);
    expect(team.find((m) => m.accountId === "c")!.absenceDays).toBe(3);
  });

  it("new assignees get default availability", () => {
    const team = buildTeam({ roster: [], recentIssues: [issue("A-3", "d", 1)], saved: [] });
    expect(team[0]).toMatchObject({ accountId: "d", absenceDays: 0, dedicationPct: 100, counts: true, manual: false });
  });

  it("a manual entry is replaced by the Jira assignee with the same name, keeping its counts flag", () => {
    const team = buildTeam({
      roster: [rosterEntry("manual:juan-perez", { displayName: "Juan  Pérez", manual: true, counts: false })],
      recentIssues: [{ key: "A-1", accountId: "jira-77", displayName: "juan pérez", storyPoints: 2, done: false }],
      saved: [],
    });
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ accountId: "jira-77", counts: false, manual: false });
  });

  it("people only in older sprints are listed (to decide if they count) but are not part of the next sprint", () => {
    const team = buildTeam({
      roster: [],
      recentIssues: [issue("A-1", "a", 1)],
      historyIssues: [issue("A-0", "old", 3), issue("A-2", "a", 1)],
      saved: [],
    });
    expect(team.map((m) => [m.accountId, m.recent])).toEqual([
      ["a", true],
      ["old", false],
    ]);
  });

  it("a roster entry not seen in recent sprints is not recent, unless it is manual", () => {
    const team = buildTeam({
      roster: [rosterEntry("gone"), rosterEntry("manual:ana", { displayName: "Ana", manual: true })],
      recentIssues: [],
      saved: [],
    });
    expect(Object.fromEntries(team.map((m) => [m.accountId, m.recent]))).toEqual({ gone: false, "manual:ana": true });
  });

  it("a manual entry with no matching assignee stays", () => {
    const team = buildTeam({
      roster: [rosterEntry("manual:ana", { displayName: "Ana", manual: true })],
      recentIssues: [],
      saved: [],
    });
    expect(team).toEqual([expect.objectContaining({ accountId: "manual:ana", manual: true, counts: true })]);
  });
});

describe("buildTeamRows", () => {
  const rate = {
    sp: { p25: 0.4, p50: 0.5, p75: 0.6 },
    issues: { p25: 0.2, p50: 0.25, p75: 0.3 },
    sprintsUsed: 6,
  };

  it("someone who does not count keeps their assigned work visible, with no capacity and no load", () => {
    const rows = buildTeamRows([member("a", { counts: false })], new Map([["a", { sp: 3, issues: 1 }]]), rate);
    expect(rows[0]).toMatchObject({
      availableDays: 0,
      capacity: { sp: 0, issues: 0 },
      assigned: { sp: 3, issues: 1 },
      loadPct: null,
      band: "ok",
    });
  });

  it("a counting member with 0 availability and assigned work is over", () => {
    const rows = buildTeamRows([member("a", { dedicationPct: 0 })], new Map([["a", { sp: 3, issues: 1 }]]), rate);
    expect(rows[0]).toMatchObject({ availableDays: 0, band: "over", loadPct: null });
  });

  it("someone not in the next sprint has no availability or capacity, even if they count", () => {
    const rows = buildTeamRows([{ ...member("old"), recent: false }], new Map(), rate);
    expect(rows[0]).toMatchObject({ availableDays: 0, capacity: { sp: 0, issues: 0 }, loadPct: null, band: "ok", counts: true });
  });

  it("without a rate, capacity is 0 and band ok (no recommendation yet)", () => {
    const rows = buildTeamRows([member("a")], new Map(), null);
    expect(rows[0]).toMatchObject({ availableDays: 10, capacity: { sp: 0, issues: 0 }, loadPct: null, band: "ok" });
  });
});

describe("buildTeamRows (active sprint)", () => {
  const rate = {
    sp: { p25: 0.4, p50: 0.5, p75: 0.6 },
    issues: { p25: 0.2, p50: 0.25, p75: 0.3 },
    sprintsUsed: 6,
  };

  it("measures load as remaining work against the remaining share of availability", () => {
    // 10 days, half the sprint left -> 5 days -> 2.5 SP / 1.25 issues of capacity.
    const rows = buildTeamRows([member("a")], new Map([["a", { sp: 8, issues: 3 }]]), rate, {
      workingDays: 10,
      remainingDays: 5,
      done: new Map([["a", { sp: 6, issues: 2 }]]),
    });
    expect(rows[0]).toMatchObject({
      availableDays: 10,
      capacity: { sp: 2.5, issues: 1.3 },
      assigned: { sp: 8, issues: 3 },
      done: { sp: 6, issues: 2 },
      loadPct: 80, // max(2/2.5, 1/1.25) = 0.8
      band: "ok",
    });
  });

  it("with no days left and work still open, the person is over", () => {
    const rows = buildTeamRows([member("a")], new Map([["a", { sp: 3, issues: 1 }]]), rate, {
      workingDays: 10,
      remainingDays: 0,
      done: new Map(),
    });
    expect(rows[0]).toMatchObject({ band: "over", loadPct: null });
  });

  it("next-sprint rows report nothing done", () => {
    const rows = buildTeamRows([member("a")], new Map(), rate);
    expect(rows[0]!.done).toEqual({ sp: 0, issues: 0 });
  });
});

describe("sprintClock", () => {
  // ORINI Sprint 6: Mon 2026-10-05 to Fri 2026-10-16 (Jira end at 00:00 local = 03:00Z).
  const start = "2026-10-05T15:13:25.886Z";
  const end = "2026-10-16T03:00:00.000Z";

  it("counts today as remaining", () => {
    expect(sprintClock(start, end, new Date("2026-10-08T15:00:00Z"))).toEqual({ workingDays: 10, elapsedDays: 3, remainingDays: 7 });
  });

  it("before the start nothing has elapsed; after the end nothing remains", () => {
    expect(sprintClock(start, end, new Date("2026-10-02T12:00:00Z"))).toEqual({ workingDays: 10, elapsedDays: 0, remainingDays: 10 });
    expect(sprintClock(start, end, new Date("2026-10-20T12:00:00Z"))).toEqual({ workingDays: 10, elapsedDays: 10, remainingDays: 0 });
  });

  it("a weekend counts the following Monday onward as remaining", () => {
    expect(sprintClock(start, end, new Date("2026-10-10T12:00:00Z"))).toEqual({ workingDays: 10, elapsedDays: 5, remainingDays: 5 });
  });

  it("without dates falls back to the team's 10 days, none elapsed", () => {
    expect(sprintClock(undefined, undefined, new Date())).toEqual({ workingDays: 10, elapsedDays: 0, remainingDays: 10 });
  });
});

describe("expectedByToday / paceBand", () => {
  it("prorates the recommended range by the elapsed share of the sprint", () => {
    expect(expectedByToday({ sp: [20, 30], issues: [10, 14] }, 3, 10)).toEqual({ sp: [6, 9], issues: [3, 4] });
    expect(expectedByToday({ sp: [20, 30], issues: [10, 14] }, 0, 0)).toEqual({ sp: [0, 0], issues: [0, 0] });
  });

  it("is ok at or above the low end, warn within 15 % below, over further behind", () => {
    expect(paceBand(6, [6, 9])).toBe("ok");
    expect(paceBand(5.2, [6, 9])).toBe("warn");
    expect(paceBand(4, [6, 9])).toBe("over");
    expect(paceBand(0, [0, 0])).toBe("ok");
  });
});

describe("validateCapacityRows", () => {
  it("accepts valid rows", () => {
    expect(validateCapacityRows([member("a", { absenceDays: 10, dedicationPct: 0 })])).toBeNull();
  });

  it("rejects absence above the sprint's 10 working days", () => {
    expect(validateCapacityRows([member("a", { absenceDays: 10.5 })])).toMatch(/ausencia/i);
  });

  it("rejects dedication outside 0-100 or not an integer", () => {
    expect(validateCapacityRows([member("a", { dedicationPct: 101 })])).toMatch(/dedicaci/i);
    expect(validateCapacityRows([member("a", { dedicationPct: 50.5 })])).toMatch(/dedicaci/i);
  });

  it("rejects duplicated accountIds", () => {
    expect(validateCapacityRows([member("a"), member("a")])).toMatch(/duplicad/i);
  });
});

const absence = (date: string, portion: Absence["portion"] = "full", over: Partial<Absence> = {}): Absence => ({
  date,
  portion,
  type: "personal",
  note: null,
  ...over,
});

describe("sprintDates", () => {
  it("lists the weekdays between the sprint's dates", () => {
    const days = sprintDates("2026-10-05T15:13:25.886Z", "2026-10-16T03:00:00.000Z", "2026-10-01");
    expect(days).toHaveLength(10);
    expect(days[0]).toBe("2026-10-05");
    expect(days[4]).toBe("2026-10-09");
    expect(days[5]).toBe("2026-10-12");
    expect(days[9]).toBe("2026-10-16");
  });

  it("without dates assumes the team rule: 10 working days from the first Monday after `after`", () => {
    // Olimpo's next sprint has no dates in Jira; the active one ends Friday 2026-10-16.
    const days = sprintDates(undefined, undefined, "2026-10-16");
    expect(days).toHaveLength(10);
    expect(days[0]).toBe("2026-10-19");
    expect(days[9]).toBe("2026-10-30");
  });
});

describe("absenceTotal", () => {
  it("a full day is 1, a morning or an afternoon is 0.5", () => {
    // "Cristóbal estará 2 mañanas fuera"
    expect(absenceTotal([absence("2026-10-06", "am"), absence("2026-10-08", "am")])).toBe(1);
    expect(absenceTotal([absence("2026-10-06"), absence("2026-10-07", "pm")])).toBe(1.5);
    expect(absenceTotal([])).toBe(0);
  });
});

describe("validateAbsences", () => {
  const days = ["2026-10-05", "2026-10-06", "2026-10-07"];

  it("accepts a morning and an afternoon of the same day", () => {
    expect(validateAbsences("Ana", [absence("2026-10-05", "am"), absence("2026-10-05", "pm")], days)).toBeNull();
  });

  it("rejects overlapping entries on the same day", () => {
    expect(validateAbsences("Ana", [absence("2026-10-05"), absence("2026-10-05", "am")], days)).toMatch(/repetid|superpuest/i);
    expect(validateAbsences("Ana", [absence("2026-10-05", "am"), absence("2026-10-05", "am")], days)).toMatch(/repetid|superpuest/i);
  });

  it("rejects a day outside the sprint or a malformed date", () => {
    expect(validateAbsences("Ana", [absence("2026-10-12")], days)).toMatch(/sprint/i);
    expect(validateAbsences("Ana", [absence("5/10/2026")], days)).toMatch(/fecha/i);
  });

  it("rejects a note longer than 200 characters", () => {
    expect(validateAbsences("Ana", [absence("2026-10-05", "full", { note: "x".repeat(201) })], days)).toMatch(/motivo/i);
  });
});

describe("buildTeamRows (active sprint, dated absences)", () => {
  const rate = {
    sp: { p25: 0.4, p50: 0.5, p75: 0.6 },
    issues: { p25: 0.2, p50: 0.25, p75: 0.3 },
    sprintsUsed: 6,
  };
  const sprint = { workingDays: 10, remainingDays: 5, today: "2026-10-12", done: new Map() };

  it("an absence already past doesn't reduce what is left", () => {
    const rows = buildTeamRows(
      [member("a", { absenceDays: 1, absences: [absence("2026-10-06")] })],
      new Map([["a", { sp: 2, issues: 1 }]]),
      rate,
      sprint
    );
    // 5 days left, none of them absent -> 2.5 SP
    expect(rows[0]).toMatchObject({ availableDays: 9, capacity: { sp: 2.5, issues: 1.3 } });
  });

  it("an absence still ahead (today included) does", () => {
    const rows = buildTeamRows(
      [member("a", { absenceDays: 1, absences: [absence("2026-10-12", "am"), absence("2026-10-14", "am")] })],
      new Map([["a", { sp: 2, issues: 1 }]]),
      rate,
      sprint
    );
    // 5 - 1 = 4 days left -> 2 SP
    expect(rows[0]!.capacity.sp).toBe(2);
  });
});
