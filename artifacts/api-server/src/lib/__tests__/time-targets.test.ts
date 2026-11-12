import { describe, it, expect } from "vitest";
import { pickTimeTarget } from "../time-targets";

describe("pickTimeTarget (same rule Evolution used)", () => {
  it("prefers the project's 3m target", () => {
    const targets = [
      { metric: "leadTime", period: "1m", targetValue: "9" },
      { metric: "leadTime", period: "3m", targetValue: "12" },
    ];
    expect(pickTimeTarget(targets, {}, "leadTime")).toBe(12);
  });

  it("falls back to any project target", () => {
    expect(pickTimeTarget([{ metric: "leadTime", period: "1m", targetValue: "9" }], {}, "leadTime")).toBe(9);
  });

  it("falls back to the admin good threshold", () => {
    expect(pickTimeTarget([], { leadTime: { goodValue: 25 } }, "leadTime")).toBe(25);
  });

  it("null when there is neither", () => {
    expect(pickTimeTarget([], {}, "cycleTime")).toBeNull();
  });
});
