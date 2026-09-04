import { describe, it, expect } from "vitest";
import { periodLabel } from "./earnings";

describe("periodLabel", () => {
  it("formats a past calendar quarter from a date", () => {
    const now = "2026-09-15";
    expect(periodLabel("2026-06-30", now)).toBe("Q2 2026");
    expect(periodLabel("2025-12-31", now)).toBe("Q4 2025");
  });

  it("clamps a current or future date to the last fully-completed quarter", () => {
    const now = "2026-09-15"; // in Q3 2026 → last completed quarter is Q2 2026
    expect(periodLabel("2026-08-28", now)).toBe("Q2 2026"); // still inside current quarter
    expect(periodLabel("2027-01-31", now)).toBe("Q2 2026"); // far-future fiscal period-end
    expect(periodLabel("2027-04-30", now)).toBe("Q2 2026");
  });

  it("handles a January now (quarter/year wrap)", () => {
    expect(periodLabel("2027-02-01", "2027-01-10")).toBe("Q4 2026");
  });
});
