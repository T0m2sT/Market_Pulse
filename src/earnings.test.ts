import { describe, it, expect } from "vitest";
import { resultsAvailableAt, needsResultsPoll, periodLabel } from "./earnings";

describe("resultsAvailableAt", () => {
  it("bmo -> ~13:40 UTC on the report date", () => {
    expect(resultsAvailableAt("2026-08-28", "bmo")).toBe("2026-08-28T13:40:00.000Z");
  });
  it("amc -> ~20:40 UTC on the report date", () => {
    expect(resultsAvailableAt("2026-08-28", "amc")).toBe("2026-08-28T20:40:00.000Z");
  });
  it("unknown hour -> noon UTC on the report date", () => {
    expect(resultsAvailableAt("2026-08-28", "")).toBe("2026-08-28T12:00:00.000Z");
  });
});

describe("needsResultsPoll", () => {
  const now = new Date("2026-08-28T21:00:00Z");
  it("true when no result row and the report time has passed", () => {
    expect(needsResultsPoll({ date: "2026-08-28", hour: "amc" }, null, now)).toBe(true);
  });
  it("false when a complete result row exists", () => {
    expect(
      needsResultsPoll(
        { date: "2026-08-28", hour: "amc" },
        { beat: 1, checked_at: "2026-08-28T20:50:00Z" },
        now,
      ),
    ).toBe(false);
  });
  it("true when a stub row exists (beat null) and last check was >2h ago", () => {
    expect(
      needsResultsPoll(
        { date: "2026-08-28", hour: "bmo" },
        { beat: null, checked_at: "2026-08-28T14:00:00Z" },
        now,
      ),
    ).toBe(true);
  });
  it("false when the report time has not passed yet", () => {
    expect(
      needsResultsPoll({ date: "2026-08-28", hour: "amc" }, null, new Date("2026-08-28T19:00:00Z")),
    ).toBe(false);
  });
});

describe("periodLabel", () => {
  it("formats a calendar quarter from a date", () => {
    expect(periodLabel("2026-06-30")).toBe("Q2 2026");
    expect(periodLabel("2026-08-28")).toBe("Q3 2026");
  });
});
