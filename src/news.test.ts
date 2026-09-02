import { describe, it, expect } from "vitest";
import { briefingSentiment, shouldGenerateBriefings } from "./news";

describe("briefingSentiment", () => {
  it("is the arithmetic mean of article sentiments", () => {
    expect(briefingSentiment([0.5, -0.1, 0.2])).toBeCloseTo(0.2);
    expect(briefingSentiment([])).toBe(0);
  });
});

describe("shouldGenerateBriefings", () => {
  it("runs only when no briefing exists for the just-completed week", () => {
    expect(shouldGenerateBriefings("2026-08-24", null)).toBe(true);
    expect(shouldGenerateBriefings("2026-08-24", "2026-08-17")).toBe(true);
    expect(shouldGenerateBriefings("2026-08-24", "2026-08-24")).toBe(false);
  });
});
