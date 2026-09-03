import { describe, it, expect } from "vitest";
import { periodLabel } from "./earnings";

describe("periodLabel", () => {
  it("formats a calendar quarter from a date", () => {
    expect(periodLabel("2026-06-30")).toBe("Q2 2026");
    expect(periodLabel("2026-08-28")).toBe("Q3 2026");
    expect(periodLabel("2025-12-31")).toBe("Q4 2025");
  });
});
