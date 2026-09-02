import { describe, it, expect } from "vitest";
import { paymentsPerYear, resolveDividendRow } from "./dividends";

describe("paymentsPerYear", () => {
  it("counts dividends in the trailing 365 days from the newest ex-date", () => {
    const history = [
      { date: "2026-08-15" },
      { date: "2026-05-15" },
      { date: "2026-02-15" },
      { date: "2025-11-15" },
      { date: "2025-08-15" }, // exactly 365d before newest — the prior year's Q, excluded
      { date: "2025-05-15" }, // older, excluded
    ];
    expect(paymentsPerYear(history)).toBe(4);
  });

  it("defaults to 4 when history is too thin", () => {
    expect(paymentsPerYear([{ date: "2026-08-15" }])).toBe(4);
    expect(paymentsPerYear([])).toBe(4);
  });

  it("clamps to 1..12", () => {
    const monthly = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
    }));
    expect(paymentsPerYear(monthly)).toBeLessThanOrEqual(12);
  });
});

describe("resolveDividendRow", () => {
  const base = {
    ticker: "KLAC",
    exDate: "2026-08-15",
    paymentDate: "2026-09-01",
    perShare: 1.7,
    fxToEur: 0.92,
    quantity: 3.42,
    currentPriceEur: 110,
    paymentsPerYear: 4,
    today: "2026-09-02",
  };

  it("locks once the ex-date has passed and freezes prior EUR + shares", () => {
    const prior = {
      per_share_eur: 1.55,
      qualifying_shares: 3.0,
      yield_pct: 6.0,
      locked: 0,
    };
    const row = resolveDividendRow(base, prior);
    expect(row.locked).toBe(1);
    expect(row.per_share_eur).toBe(1.55); // frozen, not 1.7 * 0.92
    expect(row.qualifying_shares).toBe(3.0); // frozen, not 3.42
    expect(row.yield_pct).toBe(6.0); // frozen
    expect(row.amount_eur).toBeCloseTo(1.55 * 3.0);
  });

  it("tracks live values while unlocked (ex-date still in the future)", () => {
    const future = { ...base, exDate: "2026-09-20", today: "2026-09-02" };
    const row = resolveDividendRow(future, null);
    expect(row.locked).toBe(0);
    expect(row.per_share_eur).toBeCloseTo(1.7 * 0.92);
    expect(row.qualifying_shares).toBe(3.42);
    // yield is computed in EUR: (perShareEur * ppy) / priceEur * 100
    expect(row.yield_pct).toBeCloseTo(((1.7 * 0.92 * 4) / 110) * 100);
    expect(row.amount_eur).toBeCloseTo(1.7 * 0.92 * 3.42);
  });

  it("stays locked if the prior row was already locked even with a future date", () => {
    const row = resolveDividendRow(
      { ...base, exDate: "2026-09-20", today: "2026-09-02" },
      { per_share_eur: 1.4, qualifying_shares: 2.0, yield_pct: 5.0, locked: 1 },
    );
    expect(row.locked).toBe(1);
    expect(row.per_share_eur).toBe(1.4);
  });

  it("locked with no prior row (ex-date passed before first sync) falls back to today's rate and qty — best effort", () => {
    const row = resolveDividendRow(base, null); // ex 2026-08-15, today 2026-09-02, no prior
    expect(row.locked).toBe(1);
    // Known limitation: a dividend whose ex-date passed before D1 ever stored it has no frozen
    // snapshot to carry forward, so it's valued at today's FX + today's share count.
    expect(row.per_share_eur).toBeCloseTo(1.7 * 0.92);
    expect(row.qualifying_shares).toBe(3.42);
  });
});
