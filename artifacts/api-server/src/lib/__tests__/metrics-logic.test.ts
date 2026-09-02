import { describe, it, expect } from "vitest";
import {
  mapIssueType,
  getEffectiveIssueType,
  isIssueDone,
  isIssueInProgress,
  isQaStatus,
  getStoryPoints,
  findQaRejections,
  computeQaRejectionRate,
  isCarryoverIssue,
  resolveSprintWindowDays,
  buildSprintVelocityBuckets,
  type JiraIssue,
  type JiraSprint,
} from "../jira";
import { normalize } from "../health-thresholds";

// --- Minimal JiraIssue factory ---------------------------------------------
// Fills the required shape so each test only specifies the fields it exercises.
function makeIssue(overrides?: {
  id?: string;
  key?: string;
  fields?: Partial<JiraIssue["fields"]>;
  changelog?: JiraIssue["changelog"];
}): JiraIssue {
  const baseFields: JiraIssue["fields"] = {
    summary: "Test issue",
    status: { name: "To Do", statusCategory: { key: "new" } },
    issuetype: { name: "Story" },
    priority: { name: "Medium" },
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-02T00:00:00.000Z",
  };
  return {
    id: overrides?.id ?? "1",
    key: overrides?.key ?? "TEST-1",
    fields: { ...baseFields, ...(overrides?.fields ?? {}) },
    changelog: overrides?.changelog,
  };
}

/** Build a changelog with one status transition per [from,to,when] tuple. */
function withStatusHistory(
  issue: JiraIssue,
  transitions: Array<{ from: string; to: string; at: string }>
): JiraIssue {
  return {
    ...issue,
    changelog: {
      histories: transitions.map((t) => ({
        created: t.at,
        items: [{ field: "status", fromString: t.from, toString: t.to }],
      })),
    },
  };
}

/** Build a changelog with one "Sprint" field transition per [from,to,when] tuple. Mirrors Jira's
 * real shape: from/toString are comma-separated lists of every sprint name tagged so far. */
function withSprintHistory(
  issue: JiraIssue,
  transitions: Array<{ from: string; to: string; at: string }>
): JiraIssue {
  return {
    ...issue,
    changelog: {
      histories: transitions.map((t) => ({
        created: t.at,
        items: [{ field: "Sprint", fromString: t.from, toString: t.to }],
      })),
    },
  };
}

function makeSprint(overrides: Partial<JiraSprint> & { id: number; name: string }): JiraSprint {
  return { state: "closed", ...overrides };
}

// --- normalize() (regression guard for the sign bug) ------------------------
describe("normalize", () => {
  it("maps a higher-is-better metric across the band", () => {
    // worst=5, best=10 (throughput-style)
    expect(normalize(5, 5, 10)).toBe(0);
    expect(normalize(10, 5, 10)).toBe(100);
    expect(normalize(7.5, 5, 10)).toBe(50);
  });

  it("maps a lower-is-better metric (worst > best) without wrapping", () => {
    // worst=25, best=15 (cycle-time-style). Lower value = better.
    expect(normalize(15, 25, 15)).toBe(100);
    expect(normalize(25, 25, 15)).toBe(0);
    expect(normalize(20, 25, 15)).toBe(50);
  });

  it("clamps a value worse than the worst anchor to 0 (the sign-bug regression)", () => {
    // A cycle time of 40 (far worse than the 25 warning anchor) must score 0, NOT 100.
    expect(normalize(40, 25, 15)).toBe(0);
  });

  it("clamps a value better than the best anchor to 100", () => {
    expect(normalize(3, 25, 15)).toBe(100);
    expect(normalize(50, 5, 10)).toBe(100);
  });

  it("returns 100 when worst === best (degenerate band)", () => {
    expect(normalize(7, 10, 10)).toBe(100);
  });
});

// --- mapIssueType / getEffectiveIssueType (Spanish support) -----------------
describe("mapIssueType", () => {
  it("maps English and Spanish type names", () => {
    expect(mapIssueType("Story")).toBe("Story");
    expect(mapIssueType("Historia")).toBe("Story");
    expect(mapIssueType("Bug")).toBe("Bug");
    expect(mapIssueType("Error")).toBe("Bug");
    expect(mapIssueType("Problema")).toBe("Bug");
    expect(mapIssueType("Tarea Técnica")).toBe("Task");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapIssueType("  hISTORIA ")).toBe("Story");
  });

  it("falls back to Other for unknown types", () => {
    expect(mapIssueType("Spike")).toBe("Other");
  });
});

describe("getEffectiveIssueType", () => {
  it("classifies a Jira subtask as Subtask regardless of its type name", () => {
    const issue = makeIssue({ fields: { issuetype: { name: "Tarea", subtask: true } } });
    expect(getEffectiveIssueType(issue)).toBe("Subtask");
  });

  it("maps the type name when not a subtask", () => {
    const issue = makeIssue({ fields: { issuetype: { name: "Historia" } } });
    expect(getEffectiveIssueType(issue)).toBe("Story");
  });
});

// --- isIssueDone / isIssueInProgress ----------------------------------------
describe("isIssueDone", () => {
  it("uses statusCategory when present", () => {
    expect(isIssueDone(makeIssue({ fields: { status: { name: "Whatever", statusCategory: { key: "done" } } } }))).toBe(true);
    expect(isIssueDone(makeIssue({ fields: { status: { name: "QA", statusCategory: { key: "indeterminate" } } } }))).toBe(false);
  });

  it("falls back to a Spanish/English name regex when no category", () => {
    expect(isIssueDone(makeIssue({ fields: { status: { name: "Cerrado" } } }))).toBe(true);
    expect(isIssueDone(makeIssue({ fields: { status: { name: "Resuelto" } } }))).toBe(true);
    expect(isIssueDone(makeIssue({ fields: { status: { name: "En curso" } } }))).toBe(false);
  });
});

describe("isIssueInProgress", () => {
  it("is true only for the indeterminate category", () => {
    expect(isIssueInProgress(makeIssue({ fields: { status: { name: "X", statusCategory: { key: "indeterminate" } } } }))).toBe(true);
    expect(isIssueInProgress(makeIssue({ fields: { status: { name: "X", statusCategory: { key: "new" } } } }))).toBe(false);
    expect(isIssueInProgress(makeIssue({ fields: { status: { name: "X", statusCategory: { key: "done" } } } }))).toBe(false);
  });
});

// --- isQaStatus -------------------------------------------------------------
describe("isQaStatus", () => {
  it("matches QA / testing / quality patterns", () => {
    expect(isQaStatus("QA in Progress")).toBe(true);
    expect(isQaStatus("Ready for QA")).toBe(true);
    expect(isQaStatus("Testing")).toBe(true);
    expect(isQaStatus("Quality Review")).toBe(true);
  });

  it("does not match unrelated statuses", () => {
    expect(isQaStatus("Backlog")).toBe(false);
    expect(isQaStatus("In Progress")).toBe(false);
    expect(isQaStatus("Done")).toBe(false);
  });
});

// --- getStoryPoints (custom-field fallback) ---------------------------------
describe("getStoryPoints", () => {
  it("prefers customfield_10016, then falls back", () => {
    expect(getStoryPoints(makeIssue({ fields: { customfield_10016: 5 } }))).toBe(5);
    expect(getStoryPoints(makeIssue({ fields: { customfield_10028: 8 } }))).toBe(8);
    expect(getStoryPoints(makeIssue({ fields: { customfield_10072: 3 } }))).toBe(3);
  });

  it("returns 0 when no story-point field is set", () => {
    expect(getStoryPoints(makeIssue())).toBe(0);
  });
});

// --- findQaRejections -------------------------------------------------------
describe("findQaRejections", () => {
  const qa = new Set(["qa in progress", "ready for qa"]);
  const dev = new Set(["to do", "ready for dev"]);

  it("detects a QA -> dev-status transition as a rejection", () => {
    const issue = withStatusHistory(makeIssue({ key: "TEST-9" }), [
      { from: "QA in Progress", to: "To Do", at: "2026-03-01T10:00:00.000Z" },
    ]);
    const r = findQaRejections(issue, qa, dev);
    expect(r).toHaveLength(1);
    expect(r[0]!.issueKey).toBe("TEST-9");
    expect(r[0]!.fromStatus).toBe("QA in Progress");
    expect(r[0]!.toStatus).toBe("To Do");
  });

  it("ignores QA -> non-dev transitions and non-status changelog items", () => {
    const issue = withStatusHistory(makeIssue(), [
      { from: "QA in Progress", to: "Done", at: "2026-03-01T10:00:00.000Z" }, // QA -> done, not a dev return
    ]);
    expect(findQaRejections(issue, qa, dev)).toHaveLength(0);

    const noStatus = makeIssue({
      changelog: {
        histories: [{ created: "2026-03-01T10:00:00.000Z", items: [{ field: "assignee", fromString: "a", toString: "b" }] }],
      },
    });
    expect(findQaRejections(noStatus, qa, dev)).toHaveLength(0);
  });
});

// --- computeQaRejectionRate (rate + window bounding) ------------------------
describe("computeQaRejectionRate", () => {
  const qa = new Set(["qa in progress"]);
  const dev = new Set(["to do"]);
  const since = new Date("2026-03-01T00:00:00.000Z");
  const until = new Date("2026-04-01T00:00:00.000Z");

  it("counts unique issues entered vs rejected and rounds the rate", () => {
    const entered = withStatusHistory(makeIssue({ id: "1", key: "A" }), [
      { from: "In Progress", to: "QA in Progress", at: "2026-03-05T00:00:00.000Z" },
    ]);
    const rejected = withStatusHistory(makeIssue({ id: "2", key: "B" }), [
      { from: "In Progress", to: "QA in Progress", at: "2026-03-06T00:00:00.000Z" },
      { from: "QA in Progress", to: "To Do", at: "2026-03-07T00:00:00.000Z" },
    ]);
    const r = computeQaRejectionRate([entered, rejected], qa, dev, since, until);
    expect(r.totalIssuesThatEnteredQa).toBe(2);
    expect(r.totalIssuesRejected).toBe(1);
    expect(r.overallRejectionRate).toBe(50);
  });

  it("excludes transitions outside the [since, until) window", () => {
    const stale = withStatusHistory(makeIssue({ id: "3", key: "C" }), [
      { from: "In Progress", to: "QA in Progress", at: "2026-01-10T00:00:00.000Z" }, // before since
      { from: "QA in Progress", to: "To Do", at: "2026-01-11T00:00:00.000Z" },
    ]);
    const r = computeQaRejectionRate([stale], qa, dev, since, until);
    expect(r.totalIssuesThatEnteredQa).toBe(0);
    expect(r.totalIssuesRejected).toBe(0);
    expect(r.overallRejectionRate).toBe(0);
  });

  it("returns 0 rate when nothing entered QA", () => {
    const none = makeIssue({ id: "4", key: "D" });
    const r = computeQaRejectionRate([none], qa, dev, since, until);
    expect(r.overallRejectionRate).toBe(0);
  });
});

// --- isCarryoverIssue --------------------------------------------------------
describe("isCarryoverIssue", () => {
  const sprint109 = makeSprint({ id: 109, name: "Sprint 109", endDate: "2026-06-01T00:00:00.000Z" });
  const sprint110 = makeSprint({ id: 110, name: "Sprint 110", endDate: "2026-06-15T00:00:00.000Z" });
  const sprint111 = makeSprint({ id: 111, name: "Sprint 111", state: "active", startDate: "2026-06-16T00:00:00.000Z" });
  const sprint112Future = makeSprint({ id: 112, name: "Sprint 112", startDate: "2026-07-01T00:00:00.000Z" });
  const allSprints = [sprint109, sprint110, sprint111, sprint112Future];

  it("returns false for an issue with no changelog at all", () => {
    const issue = makeIssue({ id: "1", key: "A" });
    expect(isCarryoverIssue(issue, allSprints, sprint111)).toBe(false);
  });

  it("returns false for an issue only ever tagged with the current sprint", () => {
    const issue = withSprintHistory(makeIssue({ id: "2", key: "B" }), [
      { from: "", to: "Sprint 111", at: "2026-06-16T00:00:00.000Z" },
    ]);
    expect(isCarryoverIssue(issue, allSprints, sprint111)).toBe(false);
  });

  it("returns true for an issue tagged with an earlier sprint that already ended before this one started", () => {
    const issue = withSprintHistory(makeIssue({ id: "3", key: "C" }), [
      { from: "", to: "Sprint 110", at: "2026-06-05T00:00:00.000Z" },
      { from: "Sprint 110", to: "Sprint 110, Sprint 111", at: "2026-06-16T00:00:00.000Z" },
    ]);
    expect(isCarryoverIssue(issue, allSprints, sprint111)).toBe(true);
  });

  it("returns true when the earlier sprint appears several sprints back, not just the immediately preceding one", () => {
    const issue = withSprintHistory(makeIssue({ id: "4", key: "D" }), [
      { from: "", to: "Sprint 109, Sprint 110, Sprint 111", at: "2026-06-16T00:00:00.000Z" },
    ]);
    expect(isCarryoverIssue(issue, allSprints, sprint111)).toBe(true);
  });

  it("does not count a future/planning sprint tag as carryover", () => {
    // Tagged with Sprint 112, which starts AFTER Sprint 111 — pre-planning, not carryover.
    const issue = withSprintHistory(makeIssue({ id: "5", key: "E" }), [
      { from: "", to: "Sprint 111, Sprint 112", at: "2026-06-16T00:00:00.000Z" },
    ]);
    expect(isCarryoverIssue(issue, allSprints, sprint111)).toBe(false);
  });

  it("ignores a sprint name in history that isn't in the known sprints list", () => {
    const issue = withSprintHistory(makeIssue({ id: "6", key: "F" }), [
      { from: "", to: "Some Deleted Sprint, Sprint 111", at: "2026-06-16T00:00:00.000Z" },
    ]);
    expect(isCarryoverIssue(issue, allSprints, sprint111)).toBe(false);
  });
});

// --- resolveSprintWindowDays ------------------------------------------------
describe("resolveSprintWindowDays", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY).toISOString();

  it("returns null when there are no closed sprints", () => {
    const sprints = [
      makeSprint({ id: 1, name: "Sprint 1", state: "active", startDate: daysAgo(5) }),
    ];
    expect(resolveSprintWindowDays(sprints, 2)).toBeNull();
  });

  it("computes days back to the start of the earliest of the last N closed sprints, and returns the exact sprints selected", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", state: "closed", startDate: daysAgo(60), endDate: daysAgo(46) });
    const sprint2 = makeSprint({ id: 2, name: "Sprint 2", state: "closed", startDate: daysAgo(45), endDate: daysAgo(31) });
    const sprint3 = makeSprint({ id: 3, name: "Sprint 3", state: "closed", startDate: daysAgo(30), endDate: daysAgo(16) });
    const sprint4 = makeSprint({ id: 4, name: "Sprint 4", state: "active", startDate: daysAgo(15) });
    const sprints = [sprint1, sprint2, sprint3, sprint4];
    // Last 2 CLOSED sprints by end date = Sprint 3 (ends 16d ago) and Sprint 2 (ends 31d ago).
    // Earliest start among those two = Sprint 2's start, 45 days ago.
    const result = resolveSprintWindowDays(sprints, 2);
    expect(result).not.toBeNull();
    expect(result!.days).toBeGreaterThanOrEqual(44);
    expect(result!.days).toBeLessThanOrEqual(46);
    expect(result!.sprintsIncluded).toHaveLength(2);
    expect(result!.sprintsIncluded).toEqual(expect.arrayContaining([sprint2, sprint3]));
  });

  it("bounds windowEnd to the most recently closed sprint, not now — so work resolved in a still-active later sprint doesn't leak in", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", state: "closed", startDate: daysAgo(60), endDate: daysAgo(46) });
    const sprint2 = makeSprint({ id: 2, name: "Sprint 2", state: "closed", startDate: daysAgo(45), endDate: daysAgo(31), completeDate: daysAgo(30) });
    const sprint3 = makeSprint({ id: 3, name: "Sprint 3", state: "active", startDate: daysAgo(29) });
    const sprints = [sprint1, sprint2, sprint3];
    const result = resolveSprintWindowDays(sprints, 2);
    expect(result).not.toBeNull();
    // completeDate takes precedence over the merely-planned endDate.
    expect(result!.windowEnd?.toISOString()).toBe(sprint2.completeDate);
  });

  it("falls back to endDate for windowEnd when the most recently closed sprint has no completeDate", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", state: "closed", startDate: daysAgo(30), endDate: daysAgo(16) });
    const result = resolveSprintWindowDays([sprint1], 1);
    expect(result).not.toBeNull();
    expect(result!.windowEnd?.toISOString()).toBe(new Date(sprint1.endDate!).toISOString());
  });

  it("caps the returned days at the shared Jira lookback ceiling", () => {
    const sprints = [
      makeSprint({ id: 1, name: "Sprint 1", state: "closed", startDate: daysAgo(200), endDate: daysAgo(186) }),
    ];
    const result = resolveSprintWindowDays(sprints, 1);
    expect(result).not.toBeNull();
    expect(result!.days).toBeLessThanOrEqual(90);
  });

  it("ignores sprints without a startDate when picking the earliest", () => {
    const sprints = [
      makeSprint({ id: 1, name: "Sprint 1", state: "closed", endDate: daysAgo(40) }), // no startDate
    ];
    expect(resolveSprintWindowDays(sprints, 1)).toBeNull();
  });
});

describe("buildSprintVelocityBuckets", () => {
  it("buckets resolved issues by sprint window, oldest sprint first", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z" });
    const sprint2 = makeSprint({ id: 2, name: "Sprint 2", startDate: "2026-06-15T00:00:00.000Z", endDate: "2026-06-28T00:00:00.000Z" });

    const issueA = makeIssue({ id: "1", key: "A", fields: { customfield_10016: 3 } });
    const issueB = makeIssue({ id: "2", key: "B", fields: { customfield_10016: 5 } });
    const issueC = makeIssue({ id: "3", key: "C", fields: { customfield_10016: 2 } });

    const resolvedMap = new Map<string, Date>([
      ["1", new Date("2026-06-10T00:00:00.000Z")], // falls in sprint1
      ["2", new Date("2026-06-20T00:00:00.000Z")], // falls in sprint2
      ["3", new Date("2026-06-22T00:00:00.000Z")], // falls in sprint2
    ]);

    // Pass sprints out of chronological order to confirm the function re-sorts them.
    const buckets = buildSprintVelocityBuckets([issueA, issueB, issueC], resolvedMap, [sprint2, sprint1], new Map());

    expect(buckets).toEqual([
      { label: "Sprint 1", value: 3, avgCycleTime: null, avgLeadTime: null },
      { label: "Sprint 2", value: 7, avgCycleTime: null, avgLeadTime: null },
    ]);
  });

  it("gives a sprint with no resolved issues a value of 0", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z" });
    const buckets = buildSprintVelocityBuckets([], new Map(), [sprint1], new Map());
    expect(buckets).toEqual([{ label: "Sprint 1", value: 0, avgCycleTime: null, avgLeadTime: null }]);
  });

  it("computes per-sprint avgCycleTime/avgLeadTime from the lead/cycle map", () => {
    const sprint1 = makeSprint({ id: 1, name: "Sprint 1", startDate: "2026-06-01T00:00:00.000Z", endDate: "2026-06-14T00:00:00.000Z" });
    const issueA = makeIssue({ id: "1", key: "A" });
    const issueB = makeIssue({ id: "2", key: "B" });
    const resolvedMap = new Map<string, Date>([
      ["1", new Date("2026-06-10T00:00:00.000Z")],
      ["2", new Date("2026-06-11T00:00:00.000Z")],
    ]);
    const leadCycleByIssueId = new Map([
      ["1", { lead: 4, cycle: 2 }],
      ["2", { lead: 6, cycle: 4 }],
    ]);

    const buckets = buildSprintVelocityBuckets([issueA, issueB], resolvedMap, [sprint1], leadCycleByIssueId);

    expect(buckets).toEqual([{ label: "Sprint 1", value: 0, avgCycleTime: 3, avgLeadTime: 5 }]);
  });
});
