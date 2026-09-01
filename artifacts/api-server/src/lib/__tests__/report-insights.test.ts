import { describe, it, expect } from "vitest";
import {
  detectCompletionDrop,
  detectThresholdCrossing,
  detectStructuralBottleneck,
  buildNextSteps,
  type CompletionDropInsight,
  type ThresholdCrossingInsight,
} from "../report-insights";

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

describe("buildNextSteps", () => {
  const baseInput = {
    activeSprint: null as { sprintName: string; completionRate: number; endDate: string | null } | null,
    insights: [] as (CompletionDropInsight | ThresholdCrossingInsight)[],
    releaseReadinessConfigured: false,
    releaseEpicsPendingCount: 0,
  };

  it("returns an empty list when there is nothing to report", () => {
    expect(buildNextSteps(baseInput)).toEqual([]);
  });

  it("adds one item per insight", () => {
    const drop: CompletionDropInsight = {
      type: "completionDrop",
      previousSprintName: "S111",
      previousCompletionRate: 92.2,
      currentSprintName: "S112",
      currentCompletionRate: 66.7,
      dropPoints: 25.5,
    };
    const result = buildNextSteps({ ...baseInput, insights: [drop] });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("completionDrop");
    expect(result[0].text).toContain("S111");
    expect(result[0].text).toContain("S112");
  });

  it("adds an active-sprint item with its completion rate", () => {
    const result = buildNextSteps({
      ...baseInput,
      activeSprint: { sprintName: "Tablero Sprint 113", completionRate: 15.2, endDate: "2026-09-04T00:00:00.000Z" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("activeSprint");
    expect(result[0].text).toContain("Tablero Sprint 113");
    expect(result[0].text).toContain("15.2");
  });

  it("adds a generic production item when release readiness is configured and something is pending, without inventing a date", () => {
    const result = buildNextSteps({
      ...baseInput,
      releaseReadinessConfigured: true,
      releaseEpicsPendingCount: 2,
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("productionReady");
    expect(result[0].text).not.toMatch(/\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i);
  });

  it("omits the production item when configured but nothing is pending", () => {
    const result = buildNextSteps({
      ...baseInput,
      releaseReadinessConfigured: true,
      releaseEpicsPendingCount: 0,
    });
    expect(result).toEqual([]);
  });

  it("combines all applicable items in a fixed order: insights, sprint, production", () => {
    const crossing: ThresholdCrossingInsight = {
      type: "thresholdCrossing",
      metric: "cycleTime",
      previousValue: 13.1,
      currentValue: 38.1,
      fromBand: "warning",
      toBand: "critical",
    };
    const result = buildNextSteps({
      activeSprint: { sprintName: "S113", completionRate: 10, endDate: null },
      insights: [crossing],
      releaseReadinessConfigured: true,
      releaseEpicsPendingCount: 1,
    });
    expect(result.map((r) => r.type)).toEqual(["thresholdCrossing", "activeSprint", "productionReady"]);
  });
});
