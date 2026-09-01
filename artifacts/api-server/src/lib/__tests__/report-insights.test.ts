import { describe, it, expect } from "vitest";
import { detectCompletionDrop, detectThresholdCrossing } from "../report-insights";

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
