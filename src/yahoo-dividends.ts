import type { FmpDividend } from "./fmp";

/**
 * Fallback dividend source for tickers FMP's free tier gates behind HTTP 402 (KLAC, AVGO, LLY,
 * PM, ... — roughly half the portfolio). Yahoo's chart API exposes historical dividend events
 * with no key.
 *
 * Two gaps vs FMP: Yahoo gives only the EX-date (not the payment date) and only PAST dividends
 * (nothing declared-but-unpaid). We estimate paymentDate as ex + 21 days (typical US lag) —
 * `refreshDividends` locks the row the moment the ex-date is in the past anyway, so the estimate
 * only ever shows for the ~3 weeks between ex and pay, and the amount/shares are already frozen.
 */
export async function fetchYahooDividends(symbol: string): Promise<FmpDividend[]> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&events=div`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) throw new Error(`Yahoo error ${res.status} for ${symbol}`);

  const data = (await res.json()) as {
    chart?: { result?: { events?: { dividends?: Record<string, { amount: number; date: number }> } }[] };
  };
  const events = data.chart?.result?.[0]?.events?.dividends;
  if (!events) return [];

  return Object.values(events).map((ev) => {
    const exDate = new Date(ev.date * 1000).toISOString().slice(0, 10);
    const pay = new Date(ev.date * 1000 + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { symbol, date: exDate, paymentDate: pay, dividend: ev.amount };
  });
}
