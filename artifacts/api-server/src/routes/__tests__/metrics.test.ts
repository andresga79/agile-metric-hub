import { describe, it, expect } from "vitest";
import { calculateTrend } from "../metrics";

describe("calculateTrend", () => {
  it("returns a positive percentage when current is higher than previous", () => {
    expect(calculateTrend(120, 100)).toBe(20);
  });

  it("returns a negative percentage when current is lower than previous", () => {
    expect(calculateTrend(80, 100)).toBe(-20);
  });

  it("returns 0 when current equals previous", () => {
    expect(calculateTrend(50, 50)).toBe(0);
  });

  it("returns 100 when previous is 0 and current is positive", () => {
    expect(calculateTrend(10, 0)).toBe(100);
  });

  it("returns 0 when both current and previous are 0", () => {
    expect(calculateTrend(0, 0)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(calculateTrend(10, 3)).toBeCloseTo(233.3, 1);
  });
});
