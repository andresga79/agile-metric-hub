import { describe, it, expect } from "vitest";
import { buildWip, flowByWeek, sustainableWip } from "../wip";

const now = new Date("2026-11-12T12:00:00Z"); // Thursday; ISO week starts Mon 2026-11-09

describe("buildWip", () => {
  it("lists in-progress work oldest first and groups it by status, active statuses first", () => {
    const base = { summary: "s", assignee: null, issueType: "Historia" };
    const { items, byStatus } = buildWip(
      [
        { ...base, key: "A-1", status: "DEV in Progress", active: true, startedAt: new Date("2026-11-10T12:00:00Z") },
        { ...base, key: "A-2", status: "Ready for QA", active: false, startedAt: new Date("2026-10-23T12:00:00Z") },
        { ...base, key: "A-3", status: "DEV in Progress", active: true, startedAt: new Date("2026-11-02T12:00:00Z") },
      ],
      now
    );
    expect(items.map((i) => [i.key, i.ageDays])).toEqual([["A-2", 20], ["A-3", 10], ["A-1", 2]]);
    expect(byStatus).toEqual([
      { status: "DEV in Progress", active: true, count: 2, oldestDays: 10 },
      { status: "Ready for QA", active: false, count: 1, oldestDays: 20 },
    ]);
  });
});

describe("flowByWeek", () => {
  it("counts started and delivered per ISO week, current week last", () => {
    const weeks = flowByWeek(
      [new Date("2026-11-10T10:00:00Z"), new Date("2026-11-03T10:00:00Z"), new Date("2026-11-04T10:00:00Z")],
      [new Date("2026-11-05T10:00:00Z"), new Date("2025-01-01T10:00:00Z")],
      now,
      3
    );
    expect(weeks).toEqual([
      { weekStart: "2026-10-26", started: 0, delivered: 0 },
      { weekStart: "2026-11-02", started: 2, delivered: 1 },
      { weekStart: "2026-11-09", started: 1, delivered: 0 },
    ]);
  });
});

describe("sustainableWip", () => {
  it("is throughput per day over the full weeks × mean cycle time (Little's law)", () => {
    const weeks = [
      { weekStart: "a", started: 0, delivered: 14 },
      { weekStart: "b", started: 0, delivered: 14 },
      { weekStart: "c", started: 0, delivered: 99 }, // current, partial: ignored
    ];
    // 28 delivered / 14 days = 2 per day × 6.5 days = 13
    expect(sustainableWip(weeks, 6.5)).toBe(13);
  });

  it("is null without deliveries or cycle time", () => {
    expect(sustainableWip([{ weekStart: "a", started: 1, delivered: 0 }, { weekStart: "b", started: 0, delivered: 0 }], 5)).toBeNull();
    expect(sustainableWip([{ weekStart: "a", started: 0, delivered: 3 }, { weekStart: "b", started: 0, delivered: 0 }], null)).toBeNull();
  });
});
