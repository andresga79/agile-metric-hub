import { describe, it, expect } from "vitest";
import { median, percentile } from "../stats";

describe("median", () => {
  it("returns null for an empty sample", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle value of an odd sample regardless of input order", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("interpolates between the two middle values of an even sample", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("ignores a single extreme outlier that would drag the mean", () => {
    // A backlog cleanup closing one 584-day ticket among normal ones: mean ≈ 129d, median stays put.
    expect(median([10, 12, 14, 16, 584])).toBe(14);
  });
});

describe("percentile", () => {
  it("returns null for an empty sample", () => {
    expect(percentile([], 0.25)).toBeNull();
  });

  it("interpolates linearly between ranks", () => {
    // ranks 0..3 → p25 at index 0.75 → 1 + 0.75 * (2 - 1)
    expect(percentile([4, 1, 3, 2], 0.25)).toBeCloseTo(1.75);
    expect(percentile([4, 1, 3, 2], 0.75)).toBeCloseTo(3.25);
  });

  it("does not round (rates per person-day are small decimals)", () => {
    expect(percentile([0.41, 0.43], 0.5)).toBeCloseTo(0.42);
  });
});
