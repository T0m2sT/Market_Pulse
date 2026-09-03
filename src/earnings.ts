import { db } from "./db";
import { fetchEarningsCalendar, fetchEarningsHistory } from "./finnhub";
import { finnhubLookupTicker, type Holding } from "./holdings";
import { lookupEarningsViaWebSearch, lookupEarningsResult } from "./web-earnings";

const CALENDAR_LOOKBACK_DAYS = 400;
const CALENDAR_FUTURE_DAYS = 30;
const KEEP_PAST_PER_TICKER = 4;
const WEB_SEARCH_FALLBACK_TICKERS = new Set(["KAP.L"]);
/** checked_at for EPS-only seed rows — marks "never enriched by lookupEarningsResult", so the
 *  backfill's "checked_at older than an hour" filter always picks them up on its first pass. */
const SEED_CHECKED_AT = "1970-01-01T00:00:00.000Z";

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
  revenue: number | null;
  revenueEstimate: number | null;
  revenueYoyPct: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsYoyPct: number | null;
  guidanceText: string;
  highlightsText: string;
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

/** ISO timestamp at which a report's actuals are plausibly published: bmo ~13:40 UTC, amc ~20:40 UTC, else noon UTC. */
export function resultsAvailableAt(date: string, hour: string): string {
  const time = hour === "bmo" ? "13:40:00.000Z" : hour === "amc" ? "20:40:00.000Z" : "12:00:00.000Z";
  return `${date}T${time}`;
}

/** Calendar-quarter label from a date (matches web/src/format.ts fiscalQuarterLabel intent). */
export function periodLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) return date;
  return `Q${Math.ceil(m / 3)} ${y}`;
}

export function needsResultsPoll(
  entry: { date: string; hour: string },
  priorResult: { revenue: number | null; checked_at: string } | null,
  now: Date,
): boolean {
  if (now.getTime() < new Date(resultsAvailableAt(entry.date, entry.hour)).getTime()) return false;
  if (!priorResult) return true;
  if (priorResult.revenue !== null) return false; // complete — the poll adds revenue/guidance/YoY
  const twoHours = 2 * 60 * 60 * 1000;
  return now.getTime() - new Date(priorResult.checked_at).getTime() >= twoHours;
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
    revenue: number | null;
    revenue_estimate: number | null;
    revenue_yoy_pct: number | null;
    eps: number | null;
    eps_estimate: number | null;
    eps_yoy_pct: number | null;
    guidance_text: string | null;
    highlights_text: string | null;
    beat: number | null;
  }>(d1, `SELECT * FROM earnings_results ORDER BY date DESC`);

  // The poll writes results onto the Finnhub-seeded (fiscal-quarter-end) row, so there's one row
  // per report. Belt-and-braces: if a stray same-quarter duplicate ever slips in, keep the more
  // complete one (revenue > eps-only > neither).
  const completeness = (r: { revenue: number | null; eps: number | null }) =>
    r.revenue !== null ? 2 : r.eps !== null ? 1 : 0;
  const byQuarter = new Map<string, EarningsResult>();
  for (const r of resRows) {
    const row: EarningsResult = {
      ticker: r.ticker,
      date: r.date,
      period: periodLabel(r.date),
      revenue: r.revenue,
      revenueEstimate: r.revenue_estimate,
      revenueYoyPct: r.revenue_yoy_pct,
      eps: r.eps,
      epsEstimate: r.eps_estimate,
      epsYoyPct: r.eps_yoy_pct,
      guidanceText: r.guidance_text ?? "",
      highlightsText: r.highlights_text ?? "",
      beat: r.beat,
    };
    const key = `${r.ticker}|${row.period}`;
    const cur = byQuarter.get(key);
    if (!cur || completeness(row) > completeness(cur) || (completeness(row) === completeness(cur) && row.date > cur.date)) {
      byQuarter.set(key, row);
    }
  }

  const results: Record<string, EarningsResult[]> = {};
  for (const row of byQuarter.values()) (results[row.ticker] ??= []).push(row);
  for (const k of Object.keys(results)) {
    results[k].sort((a, b) => b.date.localeCompare(a.date));
    results[k] = results[k].slice(0, 4);
  }

  return { updatedAt: new Date().toISOString(), calendar, results };
}

// ---- Calendar sync ----

export async function refreshEarningsCalendar(
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

  const from = new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const to = daysFromNow(CALENDAR_FUTURE_DAYS);
  let calendar: Awaited<ReturnType<typeof fetchEarningsCalendar>> = [];
  try {
    calendar = await fetchEarningsCalendar(finnhubToken, from, to);
  } catch {
    // Finnhub calendar unavailable — keep existing calendar rows, still run history seeding + KAP.L.
    calendar = [];
  }

  const statements: [string, unknown[]][] = [];
  for (const e of calendar) {
    const h = lookupToHolding.get(e.symbol);
    if (!h) continue;
    statements.push([
      `INSERT INTO earnings_calendar (ticker, date, hour, quarter, year, eps_estimate, revenue_estimate, is_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (ticker, date) DO UPDATE SET
         hour = excluded.hour, quarter = excluded.quarter, year = excluded.year,
         eps_estimate = COALESCE(excluded.eps_estimate, earnings_calendar.eps_estimate),
         revenue_estimate = COALESCE(excluded.revenue_estimate, earnings_calendar.revenue_estimate)`,
      [h.ticker, e.date, e.hour ?? "", e.quarter ?? 0, e.year ?? 0, e.epsEstimate, e.revenueEstimate],
    ]);
  }
  await db.batch(d1, statements);

  // Seed earnings_results (EPS only) from Finnhub history for past dates that have no result row yet.
  // Guard: skip the Finnhub call entirely for a ticker that already has a result row for every past
  // calendar date — on most daily runs this is all of them, saving ~23 Finnhub calls/day.
  for (const [lookup, h] of lookupToHolding) {
    const gap = await db.first<{ n: number }>(
      d1,
      `SELECT COUNT(*) AS n FROM earnings_calendar ec
        WHERE ec.ticker = ? AND ec.date < ?
          AND NOT EXISTS (SELECT 1 FROM earnings_results er WHERE er.ticker = ec.ticker AND er.date = ec.date)`,
      h.ticker,
      today(),
    );
    if ((gap?.n ?? 0) === 0) continue;

    const history = await fetchEarningsHistory(finnhubToken, lookup);
    for (const r of history.slice(0, 8)) {
      const rec = r as unknown as { period?: string; actual: number | null; estimate: number | null };
      const date = rec.period;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (date >= today()) continue;
      const exists = await db.first<{ ticker: string }>(
        d1,
        `SELECT ticker FROM earnings_results WHERE ticker = ? AND date = ?`,
        h.ticker,
        date,
      );
      if (exists) continue;
      const beat =
        rec.actual !== null && rec.estimate !== null ? (rec.actual >= rec.estimate ? 1 : 0) : null;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, '', '', ?, ?)
         ON CONFLICT (ticker, date) DO NOTHING`,
        h.ticker,
        date,
        periodLabel(date),
        rec.actual,
        rec.estimate,
        beat,
        SEED_CHECKED_AT,
      );
    }
  }

  // KAP.L web-search fallback.
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
      if (entry.date >= today()) continue;
      const beat =
        entry.epsActual !== null && entry.epsEstimate !== null
          ? entry.epsActual >= entry.epsEstimate
            ? 1
            : 0
          : null;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, '', '', ?, ?)
         ON CONFLICT (ticker, date) DO NOTHING`,
        h.ticker,
        entry.date,
        entry.period,
        entry.epsActual,
        entry.epsEstimate,
        beat,
        SEED_CHECKED_AT,
      );
    }
  }

  await retainCalendar(d1);
}

async function retainCalendar(d1: D1Database): Promise<void> {
  const t = today();
  // earnings_calendar and earnings_results use DIFFERENT date conventions — calendar rows carry
  // the announcement date (e.g. 2026-08-26), result rows carry the fiscal quarter-end date
  // (e.g. 2026-06-30). Prune each table by its OWN dates: keeping the 4 most recent past entries
  // per ticker in each. (Pruning results by calendar dates was deleting valid recent results.)
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

  const resTickers = await db.all<{ ticker: string }>(d1, `SELECT DISTINCT ticker FROM earnings_results`);
  for (const { ticker } of resTickers) {
    const past = await db.all<{ date: string }>(
      d1,
      `SELECT date FROM earnings_results WHERE ticker = ? AND date < ? ORDER BY date DESC`,
      ticker,
      t,
    );
    if (past.length > KEEP_PAST_PER_TICKER) {
      await db.run(
        d1,
        `DELETE FROM earnings_results WHERE ticker = ? AND date <= ?`,
        ticker,
        past[KEEP_PAST_PER_TICKER].date,
      );
    }
  }
}

// ---- Results poll ----

export async function pollEarningsResults(
  d1: D1Database,
  anthropicApiKey: string,
  holdings: Holding[],
): Promise<void> {
  const t = today();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  // Include yesterday so an AMC report (actuals ~20:40 UTC) whose poll window ran out the same
  // evening still gets picked up the next morning until it has a complete result row.
  // A calendar entry is "due" if no result row with REVENUE exists for its quarter yet (the poll's
  // job is to add revenue / guidance / YoY on top of the EPS-only Finnhub seed) — matched by
  // ticker + a result date within the 70 days before the announcement date.
  const due = await db.all<{ ticker: string; date: string; hour: string }>(
    d1,
    `SELECT ec.ticker, ec.date, ec.hour
       FROM earnings_calendar ec
      WHERE ec.date IN (?, ?)
        AND NOT EXISTS (
          SELECT 1 FROM earnings_results er
           WHERE er.ticker = ec.ticker
             AND er.revenue IS NOT NULL
             AND er.date <= ec.date
             AND er.date >= date(ec.date, '-70 days')
        )`,
    yesterday,
    t,
  );
  if (due.length === 0) return; // no-op on non-earnings days (and days where all results are in)

  const now = new Date();
  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));

  for (const cal of due) {
    // The Finnhub seed already created an EPS-only row for this quarter, keyed by the fiscal
    // quarter-end date (~1-8 weeks before the announcement date `cal.date`). Write the poll's
    // result to THAT row so a report is one row, not two. Fall back to the announcement date.
    const seed = await db.first<{ date: string }>(
      d1,
      `SELECT date FROM earnings_results
        WHERE ticker = ? AND date <= ? AND date >= date(?, '-70 days')
        ORDER BY date DESC LIMIT 1`,
      cal.ticker,
      cal.date,
      cal.date,
    );
    const entry = { ticker: cal.ticker, date: seed?.date ?? cal.date, hour: cal.hour };

    const prior = await db.first<{ revenue: number | null; checked_at: string }>(
      d1,
      `SELECT revenue, checked_at FROM earnings_results WHERE ticker = ? AND date = ?`,
      entry.ticker,
      entry.date,
    );
    if (!needsResultsPoll({ date: cal.date, hour: cal.hour }, prior, now)) continue;

    let result: Awaited<ReturnType<typeof lookupEarningsResult>> = null;
    try {
      result = await lookupEarningsResult(
        anthropicApiKey,
        entry.ticker,
        nameByTicker.get(entry.ticker) ?? entry.ticker,
        cal.date, // ask Claude about the announcement date — that's the reporting event it can search
      );
    } catch {
      result = null;
    }
    if (!result) {
      // Write a stub so the 2h backoff applies.
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, '', '', NULL, ?)
         ON CONFLICT (ticker, date) DO UPDATE SET checked_at = excluded.checked_at`,
        entry.ticker,
        entry.date,
        periodLabel(entry.date),
        new Date().toISOString(),
      );
      continue;
    }

    await db.run(
      d1,
      `INSERT INTO earnings_results
         (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ticker, date) DO UPDATE SET
         revenue = excluded.revenue, revenue_estimate = excluded.revenue_estimate, revenue_yoy_pct = excluded.revenue_yoy_pct,
         eps = excluded.eps, eps_estimate = excluded.eps_estimate, eps_yoy_pct = excluded.eps_yoy_pct,
         guidance_text = excluded.guidance_text, highlights_text = excluded.highlights_text,
         beat = excluded.beat, checked_at = excluded.checked_at`,
      entry.ticker,
      entry.date,
      periodLabel(entry.date),
      result.revenue,
      result.revenueEstimate,
      result.revenueYoyPct,
      result.eps,
      result.epsEstimate,
      result.epsYoyPct,
      result.guidanceText,
      result.highlightsText,
      result.beat,
      new Date().toISOString(),
    );
  }
}
