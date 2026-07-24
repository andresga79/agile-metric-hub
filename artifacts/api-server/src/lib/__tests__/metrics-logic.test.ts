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
  type JiraIssue,
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
