import { describe, it, expect } from "vitest";
import { computeSprintFacts } from "../v2/sprint-facts";
import type { JiraIssue, JiraSprint } from "../jira";

const closed: JiraSprint = {
  id: 47, name: "Sprint 47", state: "closed",
  startDate: "2026-09-14T00:00:00.000Z", endDate: "2026-09-25T00:00:00.000Z", completeDate: "2026-09-25T00:00:00.000Z",
};
const prev: JiraSprint = {
  id: 46, name: "Sprint 46", state: "closed",
  startDate: "2026-08-31T00:00:00.000Z", endDate: "2026-09-11T00:00:00.000Z", completeDate: "2026-09-11T00:00:00.000Z",
};

function issue(key: string, opts: {
  sp?: number; done: boolean; type?: string;
  transitions?: Array<[string, string, string]>;
  sprintChange?: { from: string; to: string; at: string };
}): JiraIssue {
  const histories = (opts.transitions ?? []).map(([from, to, at]) => ({
    created: at, items: [{ field: "status", fromString: from, toString: to }],
  }));
  if (opts.sprintChange) {
    histories.push({
      created: opts.sprintChange.at,
      items: [{ field: "Sprint", fromString: opts.sprintChange.from, toString: opts.sprintChange.to }],
    } as never);
  }
  return {
    id: key, key,
    fields: {
      summary: key,
      status: { name: opts.done ? "Listo" : "En progreso", statusCategory: { key: opts.done ? "done" : "indeterminate" } },
      issuetype: { name: opts.type ?? "Story" },
      priority: { name: "Medium" },
      created: "2026-09-01T00:00:00.000Z",
      updated: "2026-10-14T00:00:00.000Z",
      assignee: { displayName: "Dev", accountId: "dev-1" },
      ...(opts.sp !== undefined ? { customfield_10016: opts.sp } : {}),
    },
    changelog: { histories },
  } as unknown as JiraIssue;
}

const doneAt = (at: string): Array<[string, string, string]> => [
  ["To Do", "En progreso", "2026-09-15T00:00:00.000Z"], ["En progreso", "Listo", at],
];

describe("computeSprintFacts", () => {
  const issues = [
    issue("A-1", { sp: 5, done: true, transitions: doneAt("2026-09-20T00:00:00.000Z") }),
    issue("A-2", { sp: 3, done: true, transitions: doneAt("2026-09-30T00:00:00.000Z") }),
    issue("A-3", {
      sp: 2, done: false, transitions: [["To Do", "En progreso", "2026-09-18T00:00:00.000Z"]],
      sprintChange: { from: "", to: "Sprint 47", at: "2026-09-18T00:00:00.000Z" },
    }),
    issue("A-4", {
      done: false, transitions: [["To Do", "En progreso", "2026-09-16T00:00:00.000Z"]],
      sprintChange: { from: "Sprint 46", to: "Sprint 46, Sprint 47", at: "2026-09-14T01:00:00.000Z" },
    }),
  ];

  it("closed sprint: Rovo (done today) vs real (done at close)", async () => {
    const f = await computeSprintFacts(closed, issues, ["Story"], [prev, closed], new Map());
    expect(f.basis).toBe("storyPoints");
    expect(f.committedSp).toBe(10);
    expect(f.committedIssues).toBe(4);
    expect(f.rovoDoneSp).toBe(8);
    expect(f.rovoRate).toBeCloseTo(80);
    expect(f.realDoneSp).toBe(5);
    expect(f.realDoneIssues).toBe(1);
    expect(f.realRate).toBeCloseTo(50);
    expect(f.addedSp).toBe(2);
    expect(f.addedIssues).toBe(1);
    expect(f.addedRate).toBeCloseTo(20);
    expect(f.carryoverSp).toBe(0);
    expect(f.deliveredByType).toEqual({ historia: 1, tecnico: 0, bug: 0 });
    expect(f.cycleTimes).toHaveLength(1);
    expect(f.cycleTimes[0]).toBeCloseTo(5);
    expect(f.leadTimes[0]).toBeCloseTo(19);
    expect(f.closeDate).toBe("2026-09-25T00:00:00.000Z");
  });

  it("carryover counts SP of issues tagged with an earlier sprint", async () => {
    const carried = issue("C-1", {
      sp: 4, done: false,
      sprintChange: { from: "Sprint 46", to: "Sprint 46, Sprint 47", at: "2026-09-14T01:00:00.000Z" },
    });
    const f = await computeSprintFacts(closed, [issues[0], carried], ["Story"], [prev, closed], new Map());
    expect(f.carryoverSp).toBe(4);
    expect(f.carryoverRate).toBeCloseTo((4 / 9) * 100);
  });

  it("active sprint: real values null, delivered counts done now", async () => {
    const active: JiraSprint = { ...closed, state: "active", completeDate: undefined };
    const f = await computeSprintFacts(active, issues, ["Story"], [prev, active], new Map());
    expect(f.state).toBe("active");
    expect(f.realRate).toBeNull();
    expect(f.realDoneSp).toBeNull();
    expect(f.realDoneIssues).toBeNull();
    expect(f.closeDate).toBeNull();
    expect(f.deliveredByType.historia).toBe(2);
  });

  it("maps Bug and other types", async () => {
    const mix = [
      issue("B-1", { sp: 1, done: true, type: "Bug", transitions: doneAt("2026-09-20T00:00:00.000Z") }),
      issue("B-2", { sp: 1, done: true, type: "Task", transitions: doneAt("2026-09-20T00:00:00.000Z") }),
    ];
    const f = await computeSprintFacts(closed, mix, ["Bug", "Task"], [closed], new Map());
    expect(f.deliveredByType).toEqual({ historia: 0, tecnico: 1, bug: 1 });
  });

  it("no story points: basis issueCount, rates by count", async () => {
    const noSp = [
      issue("N-1", { done: true, transitions: doneAt("2026-09-20T00:00:00.000Z") }),
      issue("N-2", { done: true, transitions: doneAt("2026-09-30T00:00:00.000Z") }),
      issue("N-3", { done: false }),
      issue("N-4", { done: false }),
    ];
    const f = await computeSprintFacts(closed, noSp, ["Story"], [closed], new Map());
    expect(f.basis).toBe("issueCount");
    expect(f.committedSp).toBe(0);
    expect(f.rovoRate).toBeCloseTo(50);
    expect(f.realRate).toBeCloseTo(25);
  });
});
