import { db } from "./db";
import { refreshDividends } from "./dividends";
import { refreshEarningsCalendar, periodLabel } from "./earnings";
import { lookupEarningsResult } from "./web-earnings";
import type { Holding } from "./holdings";

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

  // Rows still lacking revenue AND not attempted in the last hour. Every attempt (found or not)
  // bumps checked_at to now, so a row Claude can't resolve is retried at most once per hour —
  // the runbook loop, running back-to-back, sees it once then it drops out and the loop ends.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  // The row date is the fiscal-quarter-end (e.g. 2026-06-30); the company actually REPORTED weeks
  // later. Join to earnings_calendar to get the announcement date within 70 days after the row
  // date and ask Claude about THAT — searching "earnings on 2026-06-30" finds nothing.
  const thin = await db.all<{ ticker: string; date: string; announced: string | null }>(
    d1,
    `SELECT er.ticker, er.date,
            (SELECT ec.date FROM earnings_calendar ec
              WHERE ec.ticker = er.ticker
                AND ec.date >= er.date
                AND ec.date <= date(er.date, '+70 days')
              ORDER BY ec.date ASC LIMIT 1) AS announced
       FROM earnings_results er
      WHERE er.revenue IS NULL AND er.checked_at < ?
      ORDER BY er.date DESC LIMIT 15`,
    oneHourAgo,
  );

  let enriched = 0;
  for (const { ticker, date, announced } of thin) {
    // No calendar row for old quarters (pruned) — approximate the report date as quarter-end + 30d.
    const askDate =
      announced ??
      new Date(new Date(date + "T00:00:00Z").getTime() + 30 * 86400000).toISOString().slice(0, 10);
    let r: Awaited<ReturnType<typeof lookupEarningsResult>> = null;
    try {
      r = await lookupEarningsResult(
        env.ANTHROPIC_API_KEY,
        ticker,
        nameByTicker.get(ticker) ?? ticker,
        askDate,
      );
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
  return { dividends: divCount?.n ?? 0, earningsResultsEnriched: enriched, seeded: true };
}
