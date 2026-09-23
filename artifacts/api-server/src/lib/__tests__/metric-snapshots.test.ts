import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, metricSnapshotsTable: {} }));

import { snapshotsFullyInWindow } from "../metric-snapshots";

describe("snapshotsFullyInWindow", () => {
  const rows = [
    { weekStart: "2026-06-15", throughput: 0 },
    { weekStart: "2026-06-22", throughput: 3 },
    { weekStart: "2026-06-29", throughput: 24 },
    { weekStart: "2026-09-21", throughput: 5 },
  ];

  it("drops the week straddling the window start, keeps weeks fully inside it", () => {
    // 90 days before 2026-09-23 15:00Z -> 2026-06-25, mid-week of 2026-06-22.
    const windowStart = new Date("2026-06-25T15:00:00Z");
    expect(snapshotsFullyInWindow(rows, windowStart).map((r) => r.weekStart)).toEqual([
      "2026-06-29",
      "2026-09-21",
    ]);
  });

  it("keeps a week that starts exactly at the window start", () => {
    const windowStart = new Date("2026-06-22T00:00:00Z");
    expect(snapshotsFullyInWindow(rows, windowStart).map((r) => r.weekStart)).toEqual([
      "2026-06-22",
      "2026-06-29",
      "2026-09-21",
    ]);
  });
});
