import { describe, it, expect } from "vitest";
import { buildFlowBlock } from "../v2/flow-block";
import { isWaitingStatus, type TimeInStatusEntry } from "../flow-insights";

const row = (status: string, category: string, avgDays: number): TimeInStatusEntry =>
  ({ status, category, totalDays: avgDays, avgDays, medianDays: avgDays, issueCount: 1 }) as TimeInStatusEntry;

describe("buildFlowBlock timeInStatus", () => {
  const block = buildFlowBlock([], [], null, [
    row("To Do", "new", 20),
    row("Backlog", "new", 19),
    row("Por hacer", "new", 18),
    row("Open", "new", 17),
    row("Nuevo", "new", 16),
    row("Ready for DEV", "new", 5),
    row("Ready for QA", "new", 3),
    row("DEV in Progress", "indeterminate", 4),
    row("Done", "done", 9),
  ], []);

  it("keeps mid-flow waiting statuses even when Jira files them as To Do", () => {
    expect(block.timeInStatus.map((r) => r.status)).toEqual(["Ready for DEV", "DEV in Progress", "Ready for QA"]);
    expect(block.timeInStatus.find((r) => r.status === "Ready for DEV")?.waiting).toBe(true);
  });
  it("keeps in-progress statuses as not waiting", () => {
    expect(block.timeInStatus.find((r) => r.status === "DEV in Progress")?.waiting).toBe(false);
  });
  it("drops the backlog", () => {
    for (const s of ["To Do", "Backlog", "Por hacer", "Open", "Nuevo"]) {
      expect(isWaitingStatus(s)).toBe(false);
      expect(block.timeInStatus.map((r) => r.status)).not.toContain(s);
    }
  });
});
