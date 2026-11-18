import { describe, it, expect } from "vitest";
import { parseEvolutionQuery } from "../evolution";

describe("parseEvolutionQuery", () => {
  it("defaults to the 2026 calendar year by sprint", () => {
    expect(parseEvolutionQuery({})).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      by: "sprint",
      compare: null,
    });
  });

  it("accepts month and quarter and a numeric compare id", () => {
    expect(parseEvolutionQuery({ by: "month", compare: "7" })).toMatchObject({ by: "month", compare: 7 });
    expect(parseEvolutionQuery({ by: "quarter" }).by).toBe("quarter");
  });

  it("rejects an unknown grouping", () => {
    expect(() => parseEvolutionQuery({ by: "week" })).toThrow(/by/);
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => parseEvolutionQuery({ from: "2026/01/01" })).toThrow(/from/);
    expect(() => parseEvolutionQuery({ to: "2026-02-30" })).toThrow(/to/);
  });

  it("rejects from after to, accepts from equal to", () => {
    expect(() => parseEvolutionQuery({ from: "2026-06-02", to: "2026-06-01" })).toThrow(/from/);
    expect(() => parseEvolutionQuery({ from: "2026-06-01", to: "2026-06-01" })).not.toThrow();
  });

  it("rejects a non-integer compare", () => {
    expect(() => parseEvolutionQuery({ compare: "abc" })).toThrow(/compare/);
  });
});

describe("backfill jobs", () => {
  it("runs in the background, refuses a second one meanwhile, and records the result", async () => {
    const { createBackfillJobs } = await import("../admin/evolution");
    let release!: (r: import("../../lib/evolution-service").BackfillResult) => void;
    const jobs = createBackfillJobs(() => new Promise((res) => (release = res)));

    expect(jobs.start("10003", new Date())).toEqual({ started: true });
    expect(jobs.status("10003").running).toBe(true);
    expect(jobs.start("10004", new Date())).toMatchObject({ started: false });

    const result = { projectId: "10003", written: 2, frozen: 0, skipped: 0, failed: null };
    release(result);
    await new Promise((r) => setImmediate(r));
    expect(jobs.status("10003")).toMatchObject({ running: false, result, error: null });
    expect(jobs.status("10003").finishedAt).not.toBeNull();
    expect(jobs.start("10004", new Date())).toEqual({ started: true });
  });

  it("turns a thrown error into status instead of crashing, and frees the slot", async () => {
    const { createBackfillJobs } = await import("../admin/evolution");
    const jobs = createBackfillJobs(async () => {
      throw new Error("jira down");
    });
    jobs.start("10003", new Date());
    await new Promise((r) => setImmediate(r));
    expect(jobs.status("10003")).toMatchObject({ running: false, result: null, error: "jira down" });
    expect(jobs.start("10003", new Date())).toEqual({ started: true });
  });

  it("reports an idle status for a project never run", async () => {
    const { createBackfillJobs } = await import("../admin/evolution");
    expect(createBackfillJobs(async () => { throw new Error("x"); }).status("1")).toEqual({
      running: false, startedAt: null, finishedAt: null, result: null, error: null,
    });
  });
});
