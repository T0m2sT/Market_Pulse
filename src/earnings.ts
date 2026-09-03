import { db } from "./db";
import { fetchEarningsCalendar, fetchEarningsHistory, fetchRecentEarningsWithRevenue } from "./finnhub";
import { finnhubLookupTicker, type Holding } from "./holdings";
import { lookupEarningsViaWebSearch } from "./web-earnings";

const CALENDAR_LOOKBACK_DAYS = 400;
const CALENDAR_FUTURE_DAYS = 30;
const KEEP_PAST_PER_TICKER = 4;
const KEEP_RESULTS_PER_TICKER = 4;
const WEB_SEARCH_FALLBACK_TICKERS = new Set(["KAP.L"]);

export interface CalendarRowEntry {
  ticker: string;
  name: string;
  logo?: string;
  date: string;
  hour: string;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  isEstimate: boolean;
  isPast: boolean;
}

export interface EarningsResult {
  ticker: string;
  date: string;
  period: string;
  eps: number | null;
  epsEstimate: number | null;
  surprisePct: number | null;
  /** Revenue is only available for the most recently reported quarter (Finnhub free tier). */
  revenue: number | null;
  revenueEstimate: number | null;
  beat: number | null;
}

export interface EarningsDoc {
  updatedAt: string;
  calendar: CalendarRowEntry[];
  results: Record<string, EarningsResult[]>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Calendar-quarter label from a date. */
export function periodLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) return date;
  return `Q${Math.ceil(m / 3)} ${y}`;
}

// ---- Reads ----

export async function getEarnings(d1: D1Database, holdings: Holding[]): Promise<EarningsDoc> {
  const byTicker = new Map(holdings.map((h) => [h.ticker, h]));
  const t = today();

  const calRows = await db.all<{
    ticker: string;
    date: string;
    hour: string;
    quarter: number;
    year: number;
    eps_estimate: number | null;
    revenue_estimate: number | null;
    is_estimate: number;
  }>(d1, `SELECT * FROM earnings_calendar ORDER BY date ASC`);

  const calendar: CalendarRowEntry[] = calRows.map((r) => {
    const h = byTicker.get(r.ticker);
    return {
      ticker: r.ticker,
      name: h?.name ?? r.ticker,
      logo: h?.logo,
      date: r.date,
      hour: r.hour,
      quarter: r.quarter,
      year: r.year,
      epsEstimate: r.eps_estimate,
      revenueEstimate: r.revenue_estimate,
      isEstimate: r.is_estimate === 1,
      isPast: r.date < t,
    };
  });

  const resRows = await db.all<{
    ticker: string;
    date: string;
    period: string;
    eps: number | null;
    eps_estimate: number | null;
    surprise_pct: number | null;
    revenue: number | null;
    revenue_estimate: number | null;
    beat: number | null;
  }>(d1, `SELECT ticker, date, period, eps, eps_estimate, surprise_pct, revenue, revenue_estimate, beat
            FROM earnings_results ORDER BY date DESC`);

  const results: Record<string, EarningsResult[]> = {};
  for (const r of resRows) {
    (results[r.ticker] ??= []).push({
      ticker: r.ticker,
      date: r.date,
      period: periodLabel(r.date),
      eps: r.eps,
      epsEstimate: r.eps_estimate,
      surprisePct: r.surprise_pct,
      revenue: r.revenue,
      revenueEstimate: r.revenue_estimate,
      beat: r.beat,
    });
  }
  for (const k of Object.keys(results)) results[k] = results[k].slice(0, KEEP_RESULTS_PER_TICKER);

  return { updatedAt: new Date().toISOString(), calendar, results };
}

// ---- Refresh (Finnhub-only, no Claude) ----

interface FinnhubHistoryRow {
  period?: string;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
}

export async function refreshEarnings(
  d1: D1Database,
  finnhubToken: string,
  holdings: Holding[],
  anthropicApiKey: string,
): Promise<void> {
  const lookupToHolding = new Map(
    holdings
      .filter((h) => !WEB_SEARCH_FALLBACK_TICKERS.has(h.ticker))
      .map((h) => [finnhubLookupTicker(h), h]),
  );

  // --- Calendar (upcoming + recent past dots) ---
  const from = new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const to = daysFromNow(CALENDAR_FUTURE_DAYS);
  let calendar: Awaited<ReturnType<typeof fetchEarningsCalendar>> = [];
  try {
    calendar = await fetchEarningsCalendar(finnhubToken, from, to);
  } catch {
    calendar = [];
  }
  const calStatements: [string, unknown[]][] = [];
  for (const e of calendar) {
    const h = lookupToHolding.get(e.symbol);
    if (!h) continue;
    calStatements.push([
      `INSERT INTO earnings_calendar (ticker, date, hour, quarter, year, eps_estimate, revenue_estimate, is_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (ticker, date) DO UPDATE SET
         hour = excluded.hour, quarter = excluded.quarter, year = excluded.year,
         eps_estimate = COALESCE(excluded.eps_estimate, earnings_calendar.eps_estimate),
         revenue_estimate = COALESCE(excluded.revenue_estimate, earnings_calendar.revenue_estimate)`,
      [h.ticker, e.date, e.hour ?? "", e.quarter ?? 0, e.year ?? 0, e.epsEstimate, e.revenueEstimate],
    ]);
  }
  await db.batch(d1, calStatements);

  // --- Results: Finnhub /stock/earnings gives 4 clean quarters of EPS actual vs estimate ---
  const recentFrom = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
  const recentTo = daysFromNow(5);

  for (const [lookup, h] of lookupToHolding) {
    let history: FinnhubHistoryRow[] = [];
    try {
      history = (await fetchEarningsHistory(finnhubToken, lookup)) as unknown as FinnhubHistoryRow[];
    } catch {
      history = [];
    }
    const past = history
      .filter((r) => r.period && /^\d{4}-\d{2}-\d{2}$/.test(r.period) && r.period! < today())
      .slice(0, KEEP_RESULTS_PER_TICKER);
    if (past.length === 0) continue;

    // Revenue for the most recent reported quarter, from calendar/earnings?symbol=
    let revByDate = new Map<string, { revenue: number | null; revenueEstimate: number | null }>();
    try {
      const withRev = await fetchRecentEarningsWithRevenue(finnhubToken, lookup, recentFrom, recentTo);
      revByDate = new Map(
        withRev
          .filter((e) => e.revenueActual != null)
          .map((e) => [
            // calendar/earnings date is the announcement date; map it to the nearest history
            // period (fiscal quarter-end) so the revenue lands on the right quarter row.
            nearestPeriod(e.date, past.map((p) => p.period!)),
            { revenue: e.revenueActual, revenueEstimate: e.revenueEstimate },
          ]),
      );
    } catch {
      revByDate = new Map();
    }

    for (const r of past) {
      const date = r.period!;
      const rev = revByDate.get(date);
      const beat = r.actual != null && r.estimate != null ? (r.actual >= r.estimate ? 1 : 0) : null;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, eps, eps_estimate, surprise_pct, revenue, revenue_estimate, beat, checked_at,
            revenue_yoy_pct, eps_yoy_pct, guidance_text, highlights_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', '')
         ON CONFLICT (ticker, date) DO UPDATE SET
           eps = excluded.eps, eps_estimate = excluded.eps_estimate, surprise_pct = excluded.surprise_pct,
           revenue = COALESCE(excluded.revenue, earnings_results.revenue),
           revenue_estimate = COALESCE(excluded.revenue_estimate, earnings_results.revenue_estimate),
           beat = excluded.beat, checked_at = excluded.checked_at`,
        h.ticker,
        date,
        periodLabel(date),
        r.actual,
        r.estimate,
        r.surprisePercent,
        rev?.revenue ?? null,
        rev?.revenueEstimate ?? null,
        beat,
        new Date().toISOString(),
      );
    }
  }

  // --- KAP.L (no Finnhub coverage) via web search ---
  if (anthropicApiKey) {
    for (const h of holdings) {
      if (!WEB_SEARCH_FALLBACK_TICKERS.has(h.ticker)) continue;
      let doc: Awaited<ReturnType<typeof lookupEarningsViaWebSearch>> = null;
      try {
        doc = await lookupEarningsViaWebSearch(anthropicApiKey, h.ticker, h.name);
      } catch {
        doc = null;
      }
      if (doc?.next) {
        await db.run(
          d1,
          `INSERT INTO earnings_calendar (ticker, date, hour, quarter, year, eps_estimate, revenue_estimate, is_estimate)
           VALUES (?, ?, '', 0, ?, NULL, NULL, 1)
           ON CONFLICT (ticker, date) DO UPDATE SET is_estimate = 1`,
          h.ticker,
          doc.next.date,
          new Date(doc.next.date + "T00:00:00Z").getUTCFullYear(),
        );
      }
      for (const entry of doc?.history ?? []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date >= today()) continue;
        const beat =
          entry.epsActual != null && entry.epsEstimate != null
            ? entry.epsActual >= entry.epsEstimate
              ? 1
              : 0
            : null;
        await db.run(
          d1,
          `INSERT INTO earnings_results
             (ticker, date, period, eps, eps_estimate, surprise_pct, revenue, revenue_estimate, beat, checked_at,
              revenue_yoy_pct, eps_yoy_pct, guidance_text, highlights_text)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, '', '')
           ON CONFLICT (ticker, date) DO UPDATE SET
             eps = excluded.eps, eps_estimate = excluded.eps_estimate, beat = excluded.beat, checked_at = excluded.checked_at`,
          h.ticker,
          entry.date,
          periodLabel(entry.date),
          entry.epsActual,
          entry.epsEstimate,
          beat,
          new Date().toISOString(),
        );
      }
    }
  }

  await retain(d1);
}

/** Nearest period-end date (from `periods`) to an announcement date. */
function nearestPeriod(announced: string, periods: string[]): string {
  const a = new Date(announced + "T00:00:00Z").getTime();
  let best = periods[0] ?? announced;
  let bestGap = Infinity;
  for (const p of periods) {
    const gap = Math.abs(new Date(p + "T00:00:00Z").getTime() - a);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best;
}

async function retain(d1: D1Database): Promise<void> {
  const t = today();
  for (const table of ["earnings_calendar", "earnings_results"] as const) {
    const keep = table === "earnings_calendar" ? KEEP_PAST_PER_TICKER : KEEP_RESULTS_PER_TICKER;
    const tickers = await db.all<{ ticker: string }>(d1, `SELECT DISTINCT ticker FROM ${table}`);
    for (const { ticker } of tickers) {
      const past = await db.all<{ date: string }>(
        d1,
        `SELECT date FROM ${table} WHERE ticker = ? AND date < ? ORDER BY date DESC`,
        ticker,
        t,
      );
      if (past.length > keep) {
        await db.run(d1, `DELETE FROM ${table} WHERE ticker = ? AND date <= ?`, ticker, past[keep].date);
      }
    }
  }
}
