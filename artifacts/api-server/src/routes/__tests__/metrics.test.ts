import { describe, it, expect } from "vitest";
import { calculateTrend, csvField } from "../metrics";

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

describe("csvField", () => {
  it("leaves plain values unquoted", () => {
    expect(csvField("OLI-123")).toBe("OLI-123");
    expect(csvField(3.5)).toBe("3.5");
  });

  it("renders null as an empty field", () => {
    expect(csvField(null)).toBe("");
  });

  it("quotes any field with a comma, quote or newline, not just the summary", () => {
    // An assignee or status with a comma used to shift every following column.
    expect(csvField("Gonzalez, Andres")).toBe('"Gonzalez, Andres"');
    expect(csvField('Fix "login"')).toBe('"Fix ""login"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});
