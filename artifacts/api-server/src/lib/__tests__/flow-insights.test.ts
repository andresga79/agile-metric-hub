import { describe, it, expect, vi } from "vitest";

vi.mock("../jira", async (orig) => {
  const actual = await orig<typeof import("../jira")>();
  return {
    ...actual,
    getStatusCategoryMap: vi.fn(async () => new Map([["dev in progress", "indeterminate"]])),
  };
});

import type { JiraIssue } from "../jira";
import type { EffectiveThreshold } from "../health-thresholds";
import { isWaitingStatus, computeWipAging } from "../flow-insights";

describe("isWaitingStatus", () => {
  it.each(["PO Accepted", "Ready for DEV", "Ready for QA"])("%s is waiting", (n) => {
    expect(isWaitingStatus(n)).toBe(true);
  });
  it.each(["DEV in Progress", "QA in Progress"])("%s is not waiting", (n) => {
    expect(isWaitingStatus(n)).toBe(false);
  });
});

describe("computeWipAging", () => {
  it("flags an issue 15 days in progress as critical with wipAging 3/14", async () => {
    const entered = new Date(Date.now() - 15 * 86400000).toISOString();
    const issue = {
      id: "1",
      key: "X-1",
      changelog: {
        histories: [
          { created: entered, items: [{ field: "status", fromString: "To Do", toString: "DEV in Progress", to: null }] },
        ],
      },
      fields: {
        summary: "s",
        created: new Date(Date.now() - 30 * 86400000).toISOString(),
        assignee: { displayName: "Ana" },
        issuetype: { name: "Story" },
        priority: { name: "High" },
      },
    } as unknown as JiraIssue;
    const out = await computeWipAging([issue], { goodValue: 3, warningValue: 14 } as EffectiveThreshold);
    expect(out).toHaveLength(1);
    expect(out[0]!.alertLevel).toBe("critical");
    expect(out[0]!.daysInProgress).toBeCloseTo(15, 0);
    expect(out[0]!.enteredDate).toBe(entered);
  });
});
