import { describe, it, expect } from "vitest";
import { isWaitingStatus } from "../flow-insights";

describe("isWaitingStatus", () => {
  it.each(["PO Accepted", "Ready for DEV", "Ready for QA"])("%s is waiting", (n) => {
    expect(isWaitingStatus(n)).toBe(true);
  });
  it.each(["DEV in Progress", "QA in Progress"])("%s is not waiting", (n) => {
    expect(isWaitingStatus(n)).toBe(false);
  });
});
