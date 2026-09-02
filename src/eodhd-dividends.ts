import type { FmpDividend } from "./fmp";

/**
 * Fallback dividend source for tickers FMP's free tier gates behind HTTP 402 (KLAC, AVGO, LLY,
 * PM, TJX, SCHW, CEG, ...). EODHD's /api/div endpoint is on their free tier (US equities, EOD).
 *
 * Field notes (confirmed against real data 2026-09):
 *  - `date` is the ex-dividend date; `paymentDate` and `declarationDate` are real (not estimated).
 *  - Use `value` (split-adjusted per share) — it's the correct cash-per-share figure. EODHD's
 *    `unadjustedValue` carries a phantom 10x on some older rows and is unreliable.
 *  - `period` is "Quarterly" / "SemiAnnual" / "Annual" / "Monthly" — maps to payments/year.
 *
 * EODHD only carries dividends up to the most recent declared one (no purely-speculative future
 * rows), but it picks a new one up around its declaration date, so an upcoming dividend appears
 * here 2-6 weeks before its ex-date — which is the forward visibility FMP-402 tickers were missing.
 */
export interface EodhdDividend {
  date: string;
  declarationDate: string | null;
  recordDate: string | null;
  paymentDate: string | null;
  period: string | null;
  value: number;
  unadjustedValue: number;
  currency: string;
}

export async function fetchEodhdDividends(apiToken: string, symbol: string): Promise<FmpDividend[]> {
  const from = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await fetch(
    `https://eodhd.com/api/div/${encodeURIComponent(symbol)}.US?from=${from}&to=${to}&fmt=json&api_token=${apiToken}`,
  );
  if (!res.ok) throw new Error(`EODHD error ${res.status} for ${symbol}`);

  const data = (await res.json().catch(() => null)) as EodhdDividend[] | null;
  if (!Array.isArray(data)) return [];

  return data
    .filter((d) => typeof d.value === "number" && d.value > 0 && d.date)
    .map((d) => ({
      symbol,
      date: d.date, // ex-date
      // Fall back to ex + 21d only if EODHD genuinely lacks a payment date (rare).
      paymentDate:
        d.paymentDate ??
        new Date(new Date(d.date + "T00:00:00Z").getTime() + 21 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      dividend: d.value,
    }));
}
