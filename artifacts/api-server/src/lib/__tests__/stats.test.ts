import { describe, it, expect } from "vitest";
import { median } from "../stats";

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
