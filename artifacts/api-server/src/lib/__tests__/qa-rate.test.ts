import { describe, it, expect } from "vitest";
import { qaRateByWeek } from "../qa-rate";

const mon = (d: string) => new Date(`${d}T10:00:00Z`);

describe("qaRateByWeek", () => {
  it("distinct issues per ISO week", () => {
    const out = qaRateByWeek(
      [{ key: "A", at: mon("2026-11-02") }, { key: "A", at: mon("2026-11-03") }, { key: "B", at: mon("2026-11-04") }],
      [{ key: "A", at: mon("2026-11-03") }, { key: "A", at: mon("2026-11-05") }]
    );
    expect(out).toEqual([{ weekStart: "2026-11-02", totalEnteredQa: 2, rejectedCount: 1, rate: 50 }]);
  });

  it("a week with entries and no rejections is 0, not NaN", () => {
    expect(qaRateByWeek([{ key: "A", at: mon("2026-11-09") }], [])).toEqual([
      { weekStart: "2026-11-09", totalEnteredQa: 1, rejectedCount: 0, rate: 0 },
    ]);
  });

  it("a week with rejections but no entries never passes 100 %", () => {
    const out = qaRateByWeek([], [{ key: "A", at: mon("2026-11-09") }]);
    expect(out).toEqual([{ weekStart: "2026-11-09", totalEnteredQa: 0, rejectedCount: 1, rate: 0 }]);
  });

  it("no data gives []", () => {
    expect(qaRateByWeek([], [])).toEqual([]);
  });
});
