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
  /** The report/announcement date (aligns with the calendar dot). */
  date: string;
  /** Fiscal-period label, e.g. "Q2 FY2027". */
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

/** Calendar-quarter label from a date (fallback when fiscal quarter/year unknown). */
export function periodLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) return date;
  return `Q${Math.ceil(m / 3)} ${y}`;
}

/**
 * Label a quarter using the company's OWN fiscal quarter+year when Finnhub provides them, else
 * fall back to the calendar quarter of the date. Companies with offset fiscal years (NVDA, MSFT,
 * AVGO, TJX, ...) report e.g. "Q2 FY2027" in mid-2026 — labelling that by calendar quarter
 * ("Q3 2026") is confusing and made the just-reported quarter look like the wrong one.
 */
export function fiscalLabel(quarter: number, year: number, periodDate: string): string {
  if (quarter >= 1 && quarter <= 4 && year > 2000) return `Q${quarter} FY${year}`;
  return periodLabel(periodDate);
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
    fiscal_quarter: number | null;
    fiscal_year: number | null;
    announced_date: string | null;
    eps: number | null;
    eps_estimate: number | null;
    surprise_pct: number | null;
    revenue: number | null;
    revenue_estimate: number | null;
    beat: number | null;
  }>(
    d1,
    `SELECT ticker, date, fiscal_quarter, fiscal_year, announced_date,
            eps, eps_estimate, surprise_pct, revenue, revenue_estimate, beat
       FROM earnings_results ORDER BY date DESC`,
  );

  const results: Record<string, EarningsResult[]> = {};
  for (const r of resRows) {
    (results[r.ticker] ??= []).push({
      ticker: r.ticker,
      date: r.announced_date ?? r.date,
      period: fiscalLabel(r.fiscal_quarter ?? 0, r.fiscal_year ?? 0, r.date),
      eps: r.eps,
      epsEstimate: r.eps_estimate,
      surprisePct: r.surprise_pct,
      revenue: r.revenue,
      revenueEstimate: r.revenue_estimate,
      beat: r.beat,
    });
  }
  for (const k of Object.keys(results)) {
    results[k].sort((a, b) => b.date.localeCompare(a.date));
    results[k] = results[k].slice(0, KEEP_RESULTS_PER_TICKER);
  }

  return { updatedAt: new Date().toISOString(), calendar, results };
}

// ---- Refresh (Finnhub-only, no Claude) ----

interface FinnhubHistoryRow {
  period?: string;
  quarter?: number;
  year?: number;
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

  // --- Results: Finnhub /stock/earnings gives ~4 clean quarters of EPS actual vs estimate.
  //     `period` is the fiscal quarter-END date and CAN be in the future for a quarter that was
  //     just reported (a company reports Q2 in the middle of Q3). Keep any row that has an
  //     `actual` — don't filter on date. ---
  const revFrom = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const revTo = today();

  for (const [lookup, h] of lookupToHolding) {
    let history: FinnhubHistoryRow[] = [];
    try {
      history = (await fetchEarningsHistory(finnhubToken, lookup)) as unknown as FinnhubHistoryRow[];
    } catch {
      history = [];
    }
    const reported = history
      .filter((r) => r.period && /^\d{4}-\d{2}-\d{2}$/.test(r.period) && r.actual != null)
      .slice(0, KEEP_RESULTS_PER_TICKER);
    if (reported.length === 0) continue;

    // calendar/earnings?symbol= carries the real announcement date + revenueActual, keyed by
    // fiscal quarter/year — join on that so the row's date aligns with its calendar dot and the
    // revenue lands on the right quarter.
    let byFiscal = new Map<
      string,
      { announced: string; revenue: number | null; revenueEstimate: number | null }
    >();
    try {
      const cal = await fetchRecentEarningsWithRevenue(finnhubToken, lookup, revFrom, revTo);
      byFiscal = new Map(
        cal.map((e) => [
          `${e.quarter}-${e.year}`,
          { announced: e.date, revenue: e.revenueActual, revenueEstimate: e.revenueEstimate },
        ]),
      );
    } catch {
      byFiscal = new Map();
    }

    for (const r of reported) {
      const periodDate = r.period!;
      const fq = r.quarter ?? 0;
      const fy = r.year ?? 0;
      const cal = byFiscal.get(`${fq}-${fy}`);
      const announced = cal?.announced ?? periodDate;
      const beat = r.actual != null && r.estimate != null ? (r.actual >= r.estimate ? 1 : 0) : null;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, fiscal_quarter, fiscal_year, announced_date,
            eps, eps_estimate, surprise_pct, revenue, revenue_estimate, beat, checked_at,
            revenue_yoy_pct, eps_yoy_pct, guidance_text, highlights_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', '')
         ON CONFLICT (ticker, date) DO UPDATE SET
           period = excluded.period, fiscal_quarter = excluded.fiscal_quarter,
           fiscal_year = excluded.fiscal_year, announced_date = excluded.announced_date,
           eps = excluded.eps, eps_estimate = excluded.eps_estimate, surprise_pct = excluded.surprise_pct,
           revenue = COALESCE(excluded.revenue, earnings_results.revenue),
           revenue_estimate = COALESCE(excluded.revenue_estimate, earnings_results.revenue_estimate),
           beat = excluded.beat, checked_at = excluded.checked_at`,
        h.ticker,
        periodDate,
        fiscalLabel(fq, fy, periodDate),
        fq || null,
        fy || null,
        announced,
        r.actual,
        r.estimate,
        r.surprisePercent,
        cal?.revenue ?? null,
        cal?.revenueEstimate ?? null,
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

async function retain(d1: D1Database): Promise<void> {
  const t = today();

  // Calendar: keep the 4 most recent PAST dots + all upcoming.
  const calTickers = await db.all<{ ticker: string }>(d1, `SELECT DISTINCT ticker FROM earnings_calendar`);
  for (const { ticker } of calTickers) {
    const past = await db.all<{ date: string }>(
      d1,
      `SELECT date FROM earnings_calendar WHERE ticker = ? AND date < ? ORDER BY date DESC`,
      ticker,
      t,
    );
    if (past.length > KEEP_PAST_PER_TICKER) {
      await db.run(
        d1,
        `DELETE FROM earnings_calendar WHERE ticker = ? AND date <= ?`,
        ticker,
        past[KEEP_PAST_PER_TICKER].date,
      );
    }
  }

  // Results: keep the 4 most recent reported quarters, ranked by announced_date (falls back to
  // the fiscal-end `date`). Never filter on date < today — a just-reported quarter's fiscal-end
  // date is still in the future.
  const resTickers = await db.all<{ ticker: string }>(d1, `SELECT DISTINCT ticker FROM earnings_results`);
  for (const { ticker } of resTickers) {
    const rows = await db.all<{ date: string }>(
      d1,
      `SELECT date FROM earnings_results WHERE ticker = ?
        ORDER BY COALESCE(announced_date, date) DESC`,
      ticker,
    );
    if (rows.length > KEEP_RESULTS_PER_TICKER) {
      const drop = rows.slice(KEEP_RESULTS_PER_TICKER).map((r) => r.date);
      for (const d of drop) {
        await db.run(d1, `DELETE FROM earnings_results WHERE ticker = ? AND date = ?`, ticker, d);
      }
    }
  }
}
