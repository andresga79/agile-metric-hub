import { describe, it, expect } from "vitest";
import { freshness } from "../freshness";

const now = new Date("2026-11-12T12:00:00.000Z");

describe("freshness", () => {
  it("never cached → no date, not stale", () => {
    expect(freshness(null, now)).toEqual({ fetchedAt: null, stale: false });
  });

  it("23 h old is fresh", () => {
    expect(freshness(new Date("2026-11-11T13:00:00.000Z"), now)).toEqual({ fetchedAt: "2026-11-11T13:00:00.000Z", stale: false });
  });

  it("25 h old is stale", () => {
    expect(freshness(new Date("2026-11-11T11:00:00.000Z"), now)).toEqual({ fetchedAt: "2026-11-11T11:00:00.000Z", stale: true });
  });
});
