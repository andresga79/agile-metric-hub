import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<Record<string, unknown>>("../../../../../lib/db/src/schema/evolution");
  return { db: {}, ...schema };
});

import { backfillProject, snapshotClosedSprints, type EvolutionDeps } from "../evolution-service";
import type { EvolutionDelivery, EvolutionSprintRow } from "../evolution";
import type { JiraIssue, JiraSprint } from "../jira";
import type { SprintMetric } from "../../routes/sprint-metrics";

const BOARD = 15;
const FROM = new Date("2026-01-01T00:00:00Z");

// Listed out of order on purpose: processing must follow the close date, not the list or the name.
const s2: JiraSprint = { id: 2, name: "Sprint 2", state: "closed", originBoardId: BOARD,
  startDate: "2026-01-19T12:00:00Z", completeDate: "2026-02-02T20:00:00Z" };
const s1: JiraSprint = { id: 1, name: "Sprint 1", state: "closed", originBoardId: BOARD,
  startDate: "2026-01-05T12:00:00Z", completeDate: "2026-01-19T10:00:00Z" };
const s3: JiraSprint = { id: 3, name: "Sprint 3", state: "closed",
  startDate: "2026-02-02T12:00:00Z", endDate: "2026-02-16T20:00:00Z" };
const foreign: JiraSprint = { id: 90, name: "Otro equipo 7", state: "closed", originBoardId: 99,
  startDate: "2026-01-05T12:00:00Z", completeDate: "2026-01-19T10:00:00Z" };
const old: JiraSprint = { id: 0, name: "Sprint 0", state: "closed", originBoardId: BOARD,
  startDate: "2025-12-08T12:00:00Z", completeDate: "2025-12-22T20:00:00Z" };
const active: JiraSprint = { id: 4, name: "Sprint 4", state: "active", originBoardId: BOARD,
  startDate: "2026-02-16T21:00:00Z", endDate: "2026-03-02T20:00:00Z" };
const noStart: JiraSprint = { id: 5, name: "Sprint raro", state: "closed", originBoardId: BOARD,
  completeDate: "2026-01-25T20:00:00Z" };

function metric(sprint: JiraSprint): SprintMetric {
  return {
    sprintId: sprint.id, sprintName: sprint.name, state: sprint.state,
    startDate: sprint.startDate ?? null, endDate: sprint.endDate ?? null,
    totalIssues: 4, totalStoryPoints: 10, completedIssues: 4, completedStoryPoints: 10,
    completionRate: 100, completionBasis: "storyPoints", velocity: 10, reopenedCount: 0,
    avgCycleTimeDays: null, medianCycleTimeDays: null, cycleSampleSize: 0,
    carryoverCount: 0, carryoverStoryPoints: 0, carryoverRate: 0,
    addedAfterPlanningCount: 0, addedAfterPlanningStoryPoints: 0, addedAfterPlanningKeys: [],
    plannedIssues: 4, plannedStoryPoints: 10, plannedCompletionRate: 100,
    closedAtSprintEndIssues: 3, closedAtSprintEndStoryPoints: 8, closedAtSprintEndRate: 80,
    closedAtSprintEndPlannedIssues: 3, closedAtSprintEndPlannedStoryPoints: 8, closedAtSprintEndPlannedRate: 80,
    goal: null,
  };
}

const delivery = (key: string, at: string): EvolutionDelivery => ({
  issueKey: key, issueType: "Story", deliveredAt: new Date(at), leadDays: 5, cycleDays: 2,
  storyPoints: 3, assigneeId: "a1", sprintId: null,
});

// Every delivery the fake Jira knows about; fetches return the ones inside the asked range.
const allDeliveries = [
  delivery("P-1", "2026-01-02T10:00:00Z"), // gap before sprint 1
  delivery("P-2", "2026-01-06T10:00:00Z"), // sprint 1
  delivery("P-3", "2026-01-19T11:00:00Z"), // gap between 1 and 2
  delivery("P-4", "2026-01-20T10:00:00Z"), // sprint 2
  delivery("P-5", "2026-02-03T10:00:00Z"), // sprint 3
  delivery("P-6", "2026-02-20T10:00:00Z"), // after the last close: next run's business
];

interface Harness {
  deps: EvolutionDeps;
  rows: { row: EvolutionSprintRow; source: string }[];
  deliveries: EvolutionDelivery[];
  issueFetches: number[];
  ranges: [string, string][];
}

function harness(opts: {
  sprints: JiraSprint[];
  failSprint?: number;
  stored?: { ids: number[]; latest: Date | null };
}): Harness {
  const h: Harness = { rows: [], deliveries: [], issueFetches: [], ranges: [], deps: undefined as never };
  h.deps = {
    getBoardId: async () => BOARD,
    getSprints: async () => opts.sprints,
    getSprintIssues: async (sprintId) => {
      h.issueFetches.push(sprintId);
      if (sprintId === opts.failSprint) throw new Error("Jira 503");
      return [{ key: `I-${sprintId}` } as JiraIssue];
    },
    getAllowedIssueTypes: async () => ["Story"],
    computeSprintMetrics: async (sprint) => metric(sprint),
    getDeliveries: async (_p, from, toExclusive) => {
      h.ranges.push([from.toISOString(), toExclusive.toISOString()]);
      // A real fetch is day-granular and over-fetches; the service must cut to the exact window.
      const lo = from.getTime() - 86_400_000;
      const hi = toExclusive.getTime() + 86_400_000;
      return allDeliveries
        .filter((d) => d.deliveredAt.getTime() >= lo && d.deliveredAt.getTime() < hi)
        .map((d) => ({ ...d }));
    },
    upsertSprintRow: async (row, source) => {
      h.rows.push({ row, source });
      return "written";
    },
    upsertDeliveries: async (_p, ds) => {
      h.deliveries.push(...ds);
      return { written: ds.length, frozen: 0 };
    },
    storedSprintIds: async () => new Set(opts.stored?.ids ?? []),
    latestStoredClose: async () => opts.stored?.latest ?? null,
  };
  return h;
}

const sprintOf = (h: Harness) => Object.fromEntries(h.deliveries.map((d) => [d.issueKey, d.sprintId]));

describe("backfillProject", () => {
  it("writes one row per own closed sprint since `from`, in close order, tagging deliveries with their window", async () => {
    const h = harness({ sprints: [active, s2, foreign, s1, old] });
    const res = await backfillProject("10001", FROM, h.deps);

    expect(res).toEqual({ projectId: "10001", written: 2, frozen: 0, skipped: 0, failed: null });
    expect(h.rows.map((r) => [r.row.sprintId, r.source])).toEqual([[1, "backfill"], [2, "backfill"]]);
    expect(h.issueFetches).toEqual([1, 2]);
    expect(h.rows[0]!.row.delivered).toBe(1);
    expect(h.rows[1]!.row.delivered).toBe(1);
    // Gap deliveries (outside every sprint window) are kept with sprintId null; nothing past the last close.
    expect(sprintOf(h)).toEqual({ "P-1": null, "P-2": 1, "P-3": null, "P-4": 2 });
  });

  it("fetches gap deliveries per gap window, never one year-long range", async () => {
    const h = harness({ sprints: [s1, s2] });
    await backfillProject("10001", FROM, h.deps);
    expect(h.ranges).toEqual([
      ["2026-01-01T00:00:00.000Z", "2026-01-05T12:00:00.000Z"],
      ["2026-01-05T12:00:00.000Z", "2026-01-19T10:00:00.000Z"],
      ["2026-01-19T10:00:00.000Z", "2026-01-19T12:00:00.000Z"],
      ["2026-01-19T12:00:00.000Z", "2026-02-02T20:00:00.000Z"],
    ]);
  });

  it("stops at the first failing sprint: earlier rows stay, the failing one writes nothing, later ones are not tried", async () => {
    const h = harness({ sprints: [s1, s2, s3], failSprint: 2 });
    const res = await backfillProject("10001", FROM, h.deps);

    expect(res.written).toBe(1);
    expect(res.failed).toEqual({ sprintId: 2, sprintName: "Sprint 2", error: "Jira 503" });
    expect(h.issueFetches).toEqual([1, 2]);
    expect(h.rows.map((r) => r.row.sprintId)).toEqual([1]);
    expect(h.deliveries.every((d) => d.sprintId !== 2)).toBe(true);
    expect(h.deliveries.map((d) => d.issueKey)).toEqual(expect.not.arrayContaining(["P-3", "P-4"]));
  });

  it("a failed delivery write stops the run before that sprint's row exists", async () => {
    const h = harness({ sprints: [s1, s2, s3] });
    const write = h.deps.upsertDeliveries;
    h.deps.upsertDeliveries = async (p, ds) => {
      if (ds.some((d) => d.sprintId === 2)) throw new Error("db down");
      return write(p, ds);
    };
    const res = await backfillProject("10001", FROM, h.deps);

    expect(res.written).toBe(1);
    expect(res.failed).toEqual({ sprintId: 2, sprintName: "Sprint 2", error: "db down" });
    expect(h.rows.map((r) => r.row.sprintId)).toEqual([1]);
    expect(h.issueFetches).toEqual([1, 2]);
  });

  it("a failed row write is reported in `failed`, not thrown", async () => {
    const h = harness({ sprints: [s1, s2] });
    h.deps.upsertSprintRow = async () => {
      throw new Error("constraint");
    };
    const res = await backfillProject("10001", FROM, h.deps);
    expect(res.failed).toEqual({ sprintId: 1, sprintName: "Sprint 1", error: "constraint" });
    expect(h.issueFetches).toEqual([1]);
  });

  it("skips sprints without a start or a close instead of building an Invalid Date row", async () => {
    const noClose: JiraSprint = { id: 6, name: "Sin cierre", state: "closed", originBoardId: BOARD,
      startDate: "2026-01-05T12:00:00Z" };
    const h = harness({ sprints: [s1, noStart, noClose] });
    const res = await backfillProject("10001", FROM, h.deps);
    expect(res.skipped).toBe(2);
    expect(res.written).toBe(1);
    expect(h.issueFetches).toEqual([1]);
  });

  it("does not process a sprint that closed before `from`", async () => {
    const h = harness({ sprints: [old, s1] });
    await backfillProject("10001", FROM, h.deps);
    expect(h.issueFetches).toEqual([1]);
  });

  it("counts frozen rows apart from written ones", async () => {
    const h = harness({ sprints: [s1, s2] });
    h.deps.upsertSprintRow = async (row) => (row.sprintId === 1 ? "frozen" : "written");
    const res = await backfillProject("10001", FROM, h.deps);
    expect([res.written, res.frozen]).toEqual([1, 1]);
  });
});

describe("snapshotClosedSprints", () => {
  it("computes only the sprints closed after the latest stored one, as on_close", async () => {
    const h = harness({ sprints: [s1, s2, active], stored: { ids: [1], latest: new Date(s1.completeDate!) } });
    const res = await snapshotClosedSprints("10001", h.deps);

    expect(res.written).toBe(1);
    expect(h.issueFetches).toEqual([2]);
    expect(h.rows.map((r) => [r.row.sprintId, r.source])).toEqual([[2, "on_close"]]);
    // The gap since the last stored close is filled too.
    expect(sprintOf(h)).toEqual({ "P-3": null, "P-4": 2 });
  });

  it("does nothing for a project that was never backfilled", async () => {
    const h = harness({ sprints: [s1, s2] });
    const res = await snapshotClosedSprints("10001", h.deps);
    expect(res).toEqual({ projectId: "10001", written: 0, frozen: 0, skipped: 0, failed: null });
    expect(h.issueFetches).toEqual([]);
  });

  it("ignores sprints closed before 2026 even when the stored history is older", async () => {
    const h = harness({ sprints: [old, s1], stored: { ids: [], latest: new Date("2025-11-01T00:00:00Z") } });
    await snapshotClosedSprints("10001", h.deps);
    expect(h.issueFetches).toEqual([1]);
  });
});
