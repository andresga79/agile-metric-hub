import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<Record<string, unknown>>("../../../../../lib/db/src/schema/evolution");
  return { db: {}, ...schema };
});

import { toSprintRecord, fromSprintRecord, evolutionMeta, dedupeDeliveries, freezeBoundary } from "../evolution-store";
import { FORMULA_VERSION, type EvolutionDelivery, type EvolutionSprintRow } from "../evolution";

const row: EvolutionSprintRow = {
  projectId: "10001",
  sprintId: 42,
  sprintName: "Sprint 42",
  startAt: new Date("2026-03-02T13:00:00Z"),
  closedAt: new Date("2026-03-16T21:00:00Z"),
  scopeIssues: 12,
  scopeSp: 30,
  plannedIssues: 10,
  addedIssues: 2,
  carryoverIssues: 3,
  closedAtEndIssues: 9,
  closedAtEndSp: 24,
  realClosedPct: 75,
  rovoPct: 91.7,
  delivered: 9,
  deliveredSp: 24,
  people: 4,
  ct: { n: 2, p50: null, p85: null, avg: 3.5 },
  lt: { n: 0, p50: null, p85: null, avg: null },
  formulaVersion: FORMULA_VERSION,
};

describe("evolution-store records", () => {
  it("round-trips a row, nulls in p50/p85/avg included", () => {
    const rec = toSprintRecord(row, "backfill");
    const back = fromSprintRecord({ id: 1, computedAt: new Date(), frozenAt: null, ...rec } as never);
    expect(back).toEqual(row);
  });

  it("stamps formula version and source, flattening time summaries", () => {
    const rec = toSprintRecord({ ...row, formulaVersion: 999 }, "on_close");
    expect(rec.formulaVersion).toBe(FORMULA_VERSION);
    expect(rec.source).toBe("on_close");
    expect(rec.ctN).toBe(2);
    expect(rec.ctAvg).toBe(3.5);
    expect(rec.ltP50).toBeNull();
  });
});

describe("evolutionMeta", () => {
  const mk = (source: string, computed: string, frozen: boolean, closed = "2026-01-10") => ({
    source, computedAt: new Date(computed), frozenAt: frozen ? new Date("2026-02-01") : null, closedAt: new Date(closed),
  });
  it("takes the newest compute time among backfill rows only", () => {
    const m = evolutionMeta([mk("backfill", "2026-03-01", false), mk("backfill", "2026-04-01", false), mk("on_close", "2026-09-01", false)]);
    expect(m.reconstructedAt).toEqual(new Date("2026-04-01"));
  });
  it("is null when every row is on_close", () => {
    expect(evolutionMeta([mk("on_close", "2026-09-01", false)]).reconstructedAt).toBeNull();
  });
  it("keeps the note when all backfill rows are frozen, and reports frozenUntil separately", () => {
    const m = evolutionMeta([mk("backfill", "2026-03-01", true, "2026-01-10"), mk("backfill", "2026-03-02", true, "2026-01-24")]);
    expect(m.reconstructedAt).toEqual(new Date("2026-03-02"));
    expect(m.frozenUntil).toEqual(new Date("2026-01-24"));
  });
});

describe("dedupeDeliveries", () => {
  const d = (issueKey: string, leadDays: number): EvolutionDelivery => ({
    issueKey, issueType: "Story", deliveredAt: new Date("2026-01-05"), leadDays, cycleDays: null,
    storyPoints: 1, assigneeId: null, sprintId: 1,
  });
  it("keeps one entry per key, last occurrence wins", () => {
    const out = dedupeDeliveries([d("A-1", 1), d("B-1", 2), d("A-1", 3)]);
    expect(out.map((x) => x.issueKey).sort()).toEqual(["A-1", "B-1"]);
    expect(out.find((x) => x.issueKey === "A-1")!.leadDays).toBe(3);
  });
});

describe("freezeBoundary", () => {
  it("is midnight after the given Santiago day (summer, UTC-3)", () => {
    expect(freezeBoundary("2026-12-31").toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
  it("uses the winter offset (UTC-4)", () => {
    expect(freezeBoundary("2026-06-15").toISOString()).toBe("2026-06-16T04:00:00.000Z");
  });
  it("reads a Date as its Santiago calendar day", () => {
    // 2027-01-01T01:00Z is still 31-dic 22:00 in Santiago
    expect(freezeBoundary(new Date("2027-01-01T01:00:00Z")).toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
  it("handles the DST change day", () => {
    // Chile moves to summer time on the first Sunday of Sept; boundary after 2026-09-05 is still UTC-4
    expect(freezeBoundary("2026-09-05").toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(freezeBoundary("2026-09-06").toISOString()).toBe("2026-09-07T03:00:00.000Z");
  });
});
