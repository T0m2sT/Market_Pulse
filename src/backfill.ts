import { db } from "./db";
import { refreshDividends } from "./dividends";
import { refreshEarningsCalendar, periodLabel } from "./earnings";
import { lookupEarningsResult, lookupEarningsViaWebSearch } from "./web-earnings";
import type { Holding } from "./holdings";

const KEEP_PAST = 4;

/** For tickers that have fewer than KEEP_PAST past result rows (Finnhub's free tier only returns
 *  ~3 past quarters), ask Claude for older quarters and insert them. One web_search call per
 *  under-filled ticker; capped per invocation. */
async function fillMissingQuarters(
  d1: D1Database,
  anthropicKey: string,
  nameByTicker: Map<string, string>,
  limit: number,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const counts = await db.all<{ ticker: string; n: number }>(
    d1,
    `SELECT ticker, COUNT(*) AS n FROM earnings_results WHERE date < ? GROUP BY ticker`,
    today,
  );
  const short = counts.filter((c) => c.n < KEEP_PAST).slice(0, limit);
  let added = 0;
  for (const { ticker } of short) {
    let doc: Awaited<ReturnType<typeof lookupEarningsViaWebSearch>> = null;
    try {
      doc = await lookupEarningsViaWebSearch(anthropicKey, ticker, nameByTicker.get(ticker) ?? ticker);
    } catch {
      doc = null;
    }
    for (const h of doc?.history ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date) || h.date >= today) continue;
      const beat =
        h.epsActual !== null && h.epsEstimate !== null ? (h.epsActual >= h.epsEstimate ? 1 : 0) : null;
      const before = await db.first<{ n: number }>(
        d1,
        `SELECT COUNT(*) AS n FROM earnings_results WHERE ticker = ? AND date = ?`,
        ticker,
        h.date,
      );
      if ((before?.n ?? 0) > 0) continue;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, '', '', ?, '1970-01-01T00:00:00.000Z')
         ON CONFLICT (ticker, date) DO NOTHING`,
        ticker,
        h.date,
        periodLabel(h.date),
        h.epsActual,
        h.epsEstimate,
        beat,
      );
      added++;
    }
  }
  return added;
}

/**
 * One-time, idempotent. Safe to re-run — every write is an upsert.
 *  - dividends: refreshDividends pulls from EODHD (all holdings) on its own.
 *  - earnings: refreshEarningsCalendar seeds calendar + EPS history; this then fills
 *    revenue/guidance/highlights/YoY for past result rows that only have EPS.
 *
 * Chunked to 15 enrichment calls per invocation to stay under the Worker CPU/wall-time and
 * subrequest limits — the runbook calls this endpoint repeatedly until enriched hits 0.
 */
export async function runBackfill(
  d1: D1Database,
  env: {
    EODHD_API_KEY: string;
    FINNHUB_API_KEY: string;
    ANTHROPIC_API_KEY: string;
  },
  holdings: Holding[],
): Promise<{ dividends: number; earningsResultsEnriched: number; seeded: boolean }> {
  // First call seeds dividends + earnings calendar/history; subsequent calls skip straight to
  // enrichment. Keeps any single invocation under the Workers Free 50-subrequest cap
  // (seed ≈ 25 EODHD/Finnhub calls; enrichment ≈ 15 Claude calls — doing both in one call would
  // blow the limit).
  const seededRow = await db.first<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM earnings_calendar`);
  const seeded = (seededRow?.n ?? 0) > 0;
  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));

  if (!seeded) {
    await refreshDividends(d1, env.EODHD_API_KEY, holdings);
    await refreshEarningsCalendar(d1, env.FINNHUB_API_KEY, holdings, env.ANTHROPIC_API_KEY);
    const divCount0 = await db.first<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM dividends`);
    return { dividends: divCount0?.n ?? 0, earningsResultsEnriched: 0, seeded: true };
  }

  // One-time: fill older quarters for tickers Finnhub only gave ~3 of. Bounded to 5 tickers/call;
  // the runbook loop drains this over a few calls, then it's a no-op (every ticker at KEEP_PAST).
  const quartersAdded = await fillMissingQuarters(d1, env.ANTHROPIC_API_KEY, nameByTicker, 5);

  // Rows still lacking revenue AND not attempted in the last hour. Every attempt (found or not)
  // bumps checked_at to now, so a row Claude can't resolve is retried at most once per hour —
  // the runbook loop, running back-to-back, sees it once then it drops out and the loop ends.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const thin = await db.all<{ ticker: string; date: string }>(
    d1,
    `SELECT ticker, date FROM earnings_results
      WHERE revenue IS NULL AND checked_at < ?
      ORDER BY date DESC LIMIT 15`,
    oneHourAgo,
  );

  let enriched = 0;
  for (const { ticker, date } of thin) {
    let r: Awaited<ReturnType<typeof lookupEarningsResult>> = null;
    try {
      r = await lookupEarningsResult(env.ANTHROPIC_API_KEY, ticker, nameByTicker.get(ticker) ?? ticker, date);
    } catch {
      r = null;
    }
    if (!r) {
      await db.run(
        d1,
        `UPDATE earnings_results SET checked_at = ? WHERE ticker = ? AND date = ?`,
        new Date().toISOString(),
        ticker,
        date,
      );
      continue;
    }
    await db.run(
      d1,
      `UPDATE earnings_results SET
         revenue = ?, revenue_estimate = ?, revenue_yoy_pct = ?,
         eps = COALESCE(?, eps), eps_estimate = COALESCE(?, eps_estimate), eps_yoy_pct = ?,
         guidance_text = ?, highlights_text = ?,
         beat = COALESCE(?, beat), period = ?, checked_at = ?
       WHERE ticker = ? AND date = ?`,
      r.revenue,
      r.revenueEstimate,
      r.revenueYoyPct,
      r.eps,
      r.epsEstimate,
      r.epsYoyPct,
      r.guidanceText,
      r.highlightsText,
      r.beat,
      periodLabel(date),
      new Date().toISOString(),
      ticker,
      date,
    );
    enriched++;
  }

  const divCount = await db.first<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM dividends`);
  return {
    dividends: divCount?.n ?? 0,
    earningsResultsEnriched: enriched + quartersAdded,
    seeded: true,
  };
}
