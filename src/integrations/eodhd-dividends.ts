/**
 * Primary dividend source: EODHD /api/div. Free tier (20 req/day) covers US equities and many
 * international exchanges with real ex / payment / declaration dates.
 *
 * Field notes (confirmed against real data 2026-09):
 *  - `date` is the ex-dividend date; `paymentDate` and `declarationDate` are real (not estimated).
 *  - Use `value` (split-adjusted per share) — the correct cash-per-share figure. `unadjustedValue`
 *    carries a phantom 10x on some older rows and is unreliable.
 *  - `currency` is the stock's reporting currency (USD for US listings, KZT for KAP.LSE, ...).
 *    Callers must convert from THIS currency, not assume USD.
 *  - `period` is "Quarterly" / "SemiAnnual" / "Interim" / "Annual" / "Monthly".
 *
 * EODHD only carries dividends up to the most recent declared one (no speculative future rows),
 * but picks a new one up around its declaration date — so an upcoming dividend appears here
 * ~2-6 weeks before its ex-date.
 */

interface EodhdDividendRaw {
  date: string;
  declarationDate: string | null;
  recordDate: string | null;
  paymentDate: string | null;
  period: string | null;
  value: number;
  unadjustedValue: number;
  currency: string;
}

export interface DividendEvent {
  symbol: string;
  exDate: string;
  paymentDate: string;
  perShare: number;
  currency: string;
}

/** EODHD symbol suffix per T212 ticker. Default ".US"; a few holdings list elsewhere. */
function eodhdSymbol(ticker: string): string {
  if (ticker === "KAP.L") return "KAP.LSE";
  if (ticker.endsWith(".L")) return `${ticker.slice(0, -2)}.LSE`;
  return `${ticker}.US`;
}

export async function fetchEodhdDividends(apiToken: string, ticker: string): Promise<DividendEvent[]> {
  const sym = eodhdSymbol(ticker);
  const from = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await fetch(
    `https://eodhd.com/api/div/${encodeURIComponent(sym)}?from=${from}&to=${to}&fmt=json&api_token=${apiToken}`,
  );
  if (!res.ok) throw new Error(`EODHD error ${res.status} for ${sym}`);

  const data = (await res.json().catch(() => null)) as EodhdDividendRaw[] | { error?: string } | null;
  if (!Array.isArray(data)) return []; // "Symbol not found" etc.

  return data
    .filter((d) => typeof d.value === "number" && d.value > 0 && d.date)
    .map((d) => ({
      symbol: ticker,
      exDate: d.date,
      paymentDate:
        d.paymentDate ??
        new Date(new Date(d.date + "T00:00:00Z").getTime() + 21 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      perShare: d.value,
      currency: (d.currency || "USD").toUpperCase(),
    }));
}
