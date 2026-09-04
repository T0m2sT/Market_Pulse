import { describe, it, expect } from "vitest";
import { periodLabel } from "./earnings";

describe("periodLabel", () => {
  it("formats a calendar quarter from a date", () => {
    expect(periodLabel("2026-06-30")).toBe("Q2 2026");
    expect(periodLabel("2026-08-28")).toBe("Q3 2026");
    expect(periodLabel("2025-12-31")).toBe("Q4 2025");
  });

  it("steps back a quarter when the period-end date is in the future", () => {
    // Q4 reported in Nov, Finnhub period-end is next Jan → label the quarter that reported, not ahead
    expect(periodLabel("2027-01-31", "2026-11-20")).toBe("Q4 2026");
    expect(periodLabel("2027-04-30", "2027-02-15")).toBe("Q1 2027");
  });
});
