import { describe, it, expect } from "vitest";
import { isoWeekBounds } from "./iso-week";

describe("isoWeekBounds", () => {
  it("returns Monday..Sunday for a mid-week date", () => {
    // 2026-09-02 is a Wednesday
    expect(isoWeekBounds("2026-09-02")).toEqual({
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
    });
  });

  it("treats Monday as the start of its own week", () => {
    expect(isoWeekBounds("2026-08-31")).toEqual({
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
    });
  });

  it("treats Sunday as the end of the week that started the prior Monday", () => {
    expect(isoWeekBounds("2026-09-06")).toEqual({
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
    });
  });

  it("handles month/year boundaries", () => {
    // 2027-01-01 is a Friday
    expect(isoWeekBounds("2027-01-01")).toEqual({
      weekStart: "2026-12-28",
      weekEnd: "2027-01-03",
    });
  });
});
