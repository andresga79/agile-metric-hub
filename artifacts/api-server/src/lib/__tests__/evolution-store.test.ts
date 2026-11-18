import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<Record<string, unknown>>("../../../../../lib/db/src/schema/evolution");
  return { db: {}, ...schema };
});

import { toSprintRecord, fromSprintRecord } from "../evolution-store";
import { FORMULA_VERSION, type EvolutionSprintRow } from "../evolution";

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
