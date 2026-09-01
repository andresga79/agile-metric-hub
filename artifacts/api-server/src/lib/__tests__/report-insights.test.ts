import { describe, it, expect } from "vitest";
import { detectCompletionDrop, detectThresholdCrossing, detectStructuralBottleneck } from "../report-insights";

describe("detectCompletionDrop", () => {
  it("flags a drop greater than 15 points between the two most recent closed sprints", () => {
    // Matches this session's real data: Sprint 111 92.2% -> Sprint 112 66.7%.
    const sprints = [
      { name: "Tablero Sprint 111", state: "closed" as const, completionRate: 92.2 },
      { name: "Tablero Sprint 112", state: "closed" as const, completionRate: 66.7 },
      { name: "Tablero Sprint 113", state: "active" as const, completionRate: 15.2 },
    ];
    const result = detectCompletionDrop(sprints);
    expect(result).not.toBeNull();
    expect(result?.previousSprintName).toBe("Tablero Sprint 111");
    expect(result?.currentSprintName).toBe("Tablero Sprint 112");
    expect(result?.dropPoints).toBeCloseTo(25.5, 1);
  });

  it("returns null when the drop is 15 points or less", () => {
    const sprints = [
      { name: "S1", state: "closed" as const, completionRate: 80 },
      { name: "S2", state: "closed" as const, completionRate: 66 },
    ];
    expect(detectCompletionDrop(sprints)).toBeNull();
  });

  it("returns null with fewer than two closed sprints", () => {
    const sprints = [{ name: "S1", state: "closed" as const, completionRate: 80 }];
    expect(detectCompletionDrop(sprints)).toBeNull();
  });

  it("ignores the active sprint when picking the two most recent closed ones", () => {
    const sprints = [
      { name: "S1", state: "closed" as const, completionRate: 90 },
      { name: "S2", state: "closed" as const, completionRate: 85 },
      { name: "S3", state: "active" as const, completionRate: 10 },
    ];
    expect(detectCompletionDrop(sprints)).toBeNull();
  });
});

describe("detectThresholdCrossing", () => {
  const cycleTimeThreshold = { goodValue: 15, warningValue: 25, isOverride: false };

  it("flags a metric that crossed from good/warning into critical", () => {
    const result = detectThresholdCrossing("cycleTime", 38.1, 13.1, cycleTimeThreshold);
    expect(result).not.toBeNull();
    expect(result?.metric).toBe("cycleTime");
    expect(result?.toBand).toBe("critical");
  });

  it("returns null when the metric was already critical (no crossing)", () => {
    const result = detectThresholdCrossing("cycleTime", 38.1, 30, cycleTimeThreshold);
    expect(result).toBeNull();
  });

  it("returns null when either value is missing", () => {
    expect(detectThresholdCrossing("cycleTime", null, 13.1, cycleTimeThreshold)).toBeNull();
    expect(detectThresholdCrossing("cycleTime", 38.1, null, cycleTimeThreshold)).toBeNull();
  });

  it("returns null when no threshold is configured", () => {
    expect(detectThresholdCrossing("cycleTime", 38.1, 13.1, undefined)).toBeNull();
  });
});

describe("detectStructuralBottleneck", () => {
  it("flags the status with the largest weighted share of flow time", () => {
    const timeInStatus = [
      { status: "TO DO", avgDays: 137.0, issueCount: 166 },
      { status: "Ready for DEV", avgDays: 24.6, issueCount: 87 },
      { status: "Ready for QA", avgDays: 14.1, issueCount: 35 },
    ];
    const result = detectStructuralBottleneck(timeInStatus);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("TO DO");
    expect(result?.sharePercent).toBeGreaterThan(50);
  });

  it("returns null when time is spread evenly across statuses (no clear bottleneck)", () => {
    const timeInStatus = [
      { status: "A", avgDays: 10, issueCount: 20 },
      { status: "B", avgDays: 10, issueCount: 20 },
      { status: "C", avgDays: 10, issueCount: 20 },
    ];
    expect(detectStructuralBottleneck(timeInStatus)).toBeNull();
  });

  it("returns null when the top status has too few issues to call it structural", () => {
    const timeInStatus = [
      { status: "Rare edge case", avgDays: 500, issueCount: 2 },
      { status: "TO DO", avgDays: 5, issueCount: 100 },
      { status: "DONE", avgDays: 3, issueCount: 100 },
    ];
    expect(detectStructuralBottleneck(timeInStatus)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(detectStructuralBottleneck([])).toBeNull();
  });
});
