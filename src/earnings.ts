import { fetchEarningsCalendar, fetchEarningsHistory, type EarningsResult } from "./finnhub";
import { finnhubLookupTicker, type Holding } from "./holdings";
import {
  lookupEarningsViaWebSearch,
  lookupTodayEarningsRecap,
  shouldRefreshWebEarnings,
  type TodayEarningsRecap,
  type WebEarningsDoc,
} from "./web-earnings";

export interface UpcomingEarning {
  ticker: string;
  name: string;
  logo?: string;
  date: string;
  hour: string;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  /** True when `date` comes from a web-search fallback (no Finnhub coverage) rather than Finnhub's calendar. */
  isEstimate?: boolean;
}

const UPCOMING_KEY = "earnings:upcoming";
const RESULTS_KEY = "earnings:results";
const TODAY_RECAPS_KEY = "earnings:today-recaps";
const WINDOW_DAYS = 30;
const LOOKBACK_DAYS = 2;
const RECAP_WINDOW_DAYS = 2; // how many days back a reported earning still gets a same-day-style recap

/**
 * Tickers with no coverage on any free structured-data provider (checked: Finnhub, FMP, API
 * Ninjas, Twelve Data, Alpha Vantage — all gate LSE/international earnings behind paid plans).
 * For these, fall back to asking Claude to look the date up via web search instead.
 */
const WEB_SEARCH_FALLBACK_TICKERS = new Set(["KAP.L"]);

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function webEarningsKey(ticker: string): string {
  return `earnings:web:${ticker}`;
}

export async function getUpcomingEarnings(kv: KVNamespace): Promise<UpcomingEarning[]> {
  return (await kv.get<UpcomingEarning[]>(UPCOMING_KEY, "json")) ?? [];
}

export async function getEarningsResults(kv: KVNamespace): Promise<Record<string, EarningsResult[]>> {
  return (await kv.get<Record<string, EarningsResult[]>>(RESULTS_KEY, "json")) ?? {};
}

export async function getTodayEarningsRecaps(kv: KVNamespace): Promise<TodayEarningsRecap[]> {
  return (await kv.get<TodayEarningsRecap[]>(TODAY_RECAPS_KEY, "json")) ?? [];
}

/**
 * For any holding whose upcoming-earnings date is today or within the last couple of days, look
 * up how it actually went via web search (Finnhub's calendar only carries the estimate, not the
 * actual result) and cache a short recap for the Today view. Recaps older than the window are
 * dropped each run so the card doesn't accumulate stale entries indefinitely.
 */
export async function refreshTodayEarningsRecaps(
  kv: KVNamespace,
  anthropicApiKey: string,
  holdings: Holding[],
): Promise<TodayEarningsRecap[]> {
  const today = toDateString(new Date());
  const earliestKey = toDateString(new Date(Date.now() - RECAP_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const upcoming = await getUpcomingEarnings(kv);
  const recentlyReporting = upcoming.filter((e) => e.date <= today && e.date >= earliestKey);

  const holdingByTicker = new Map(holdings.map((h) => [h.ticker, h]));
  const prior = await getTodayEarningsRecaps(kv);
  const priorByTicker = new Map(prior.filter((r) => r.date >= earliestKey).map((r) => [r.ticker, r]));

  const recaps: TodayEarningsRecap[] = [];
  for (const e of recentlyReporting) {
    const existing = priorByTicker.get(e.ticker);
    if (existing) {
      recaps.push(existing);
      continue;
    }
    const h = holdingByTicker.get(e.ticker);
    const recap = await lookupTodayEarningsRecap(anthropicApiKey, e.ticker, h?.name ?? e.name, e.date);
    if (recap) recaps.push(recap);
  }

  await kv.put(TODAY_RECAPS_KEY, JSON.stringify(recaps));
  return recaps;
}

async function refreshWebSearchFallback(
  kv: KVNamespace,
  anthropicApiKey: string,
  holdings: Holding[],
): Promise<{ upcoming: UpcomingEarning[]; results: Record<string, EarningsResult[]> }> {
  const upcoming: UpcomingEarning[] = [];
  const results: Record<string, EarningsResult[]> = {};

  for (const h of holdings) {
    if (!WEB_SEARCH_FALLBACK_TICKERS.has(h.ticker)) continue;

    const key = webEarningsKey(h.ticker);
    const prior = await kv.get<WebEarningsDoc>(key, "json");

    let doc = prior;
    if (shouldRefreshWebEarnings(prior)) {
      const fresh = await lookupEarningsViaWebSearch(anthropicApiKey, h.ticker, h.name);
      if (fresh) {
        doc = fresh;
        await kv.put(key, JSON.stringify(fresh));
      }
    }

    if (doc?.next) {
      upcoming.push({
        ticker: h.ticker,
        name: h.name,
        logo: h.logo,
        date: doc.next.date,
        hour: "",
        quarter: 0,
        year: new Date(doc.next.date + "T00:00:00Z").getUTCFullYear(),
        epsEstimate: null,
        revenueEstimate: null,
        isEstimate: doc.next.isEstimate,
      });
    }

    if (doc?.history.length) {
      results[h.ticker] = doc.history.map((entry) => {
        const surprise =
          entry.epsActual !== null && entry.epsEstimate !== null ? entry.epsActual - entry.epsEstimate : null;
        return {
          symbol: h.ticker,
          // Use the date (not entry.period, e.g. "H1 2026") so the card matches Finnhub-sourced
          // tickers, which show a date string here — see EarningsResult.period doc comment.
          period: entry.date,
          quarter: 0,
          year: new Date(entry.date + "T00:00:00Z").getUTCFullYear(),
          estimate: entry.epsEstimate,
          actual: entry.epsActual,
          surprise,
          surprisePercent:
            surprise !== null && entry.epsEstimate ? (surprise / Math.abs(entry.epsEstimate)) * 100 : null,
        };
      });
    }
  }

  return { upcoming, results };
}

export async function refreshEarnings(
  kv: KVNamespace,
  finnhubToken: string,
  holdings: Holding[],
  anthropicApiKey?: string,
): Promise<void> {
  // Map lookup ticker (what Finnhub knows, e.g. CHRD) back to the full holding (display ticker e.g. OAS, name, logo).
  const lookupToHolding = new Map(
    holdings.filter((h) => !WEB_SEARCH_FALLBACK_TICKERS.has(h.ticker)).map((h) => [finnhubLookupTicker(h), h]),
  );

  // Includes a couple of already-passed days so a stock that just reported stays visible in
  // `upcoming` long enough for refreshTodayEarningsRecaps to catch and recap it (Finnhub's
  // calendar entries don't carry the actual result, only the pre-report estimate).
  const from = toDateString(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const to = toDateString(new Date(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const calendar = await fetchEarningsCalendar(finnhubToken, from, to);

  const upcoming: UpcomingEarning[] = calendar
    .filter((e) => lookupToHolding.has(e.symbol))
    .map((e) => {
      const h = lookupToHolding.get(e.symbol)!;
      return {
        ticker: h.ticker,
        name: h.name,
        logo: h.logo,
        date: e.date,
        hour: e.hour,
        quarter: e.quarter,
        year: e.year,
        epsEstimate: e.epsEstimate,
        revenueEstimate: e.revenueEstimate,
      };
    });

  const results: Record<string, EarningsResult[]> = {};
  for (const [lookup, h] of lookupToHolding) {
    results[h.ticker] = await fetchEarningsHistory(finnhubToken, lookup);
  }

  if (anthropicApiKey) {
    const fallback = await refreshWebSearchFallback(kv, anthropicApiKey, holdings);
    upcoming.push(...fallback.upcoming);
    Object.assign(results, fallback.results);
  }

  await kv.put(UPCOMING_KEY, JSON.stringify(upcoming));
  await kv.put(RESULTS_KEY, JSON.stringify(results));
}
