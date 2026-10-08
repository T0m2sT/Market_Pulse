import { db } from "../lib/db";
import { fetchEodhdDividends, type DividendEvent } from "../integrations/eodhd-dividends";
import { currencyToEurRate } from "../integrations/fx";
import { marketauxLookupTicker, type Holding } from "./holdings";

export interface DividendRow {
  ticker: string;
  exDate: string;
  paymentDate: string;
  /** Per share in the stock's reporting currency (USD for US listings). Column name is historical. */
  perShareUsd: number;
  perShareEur: number;
  qualifyingShares: number;
  amountEur: number;
  yieldPct: number | null;
  locked: boolean;
}

/** Serving shape — name/logo joined from KV holdings by the route. */
export interface Dividend extends DividendRow {
  name: string;
  logo?: string;
}

const EARLIEST_EX_DATE = "2026-08-01";
const RETENTION_DAYS = 60;
/** Holdings fetched per run; under EODHD's free 20/day with headroom for manual admin runs. */
const DAILY_FETCH_LIMIT = 15;

/** US/EU tax-treaty withholding rate on US-sourced dividends — brokers (T212 included) pay out
 * net of this, but EODHD's `value` is gross. Applied only to USD dividends; other currencies
 * (e.g. KAP.LSE's KZT) aren't known to withhold at this rate so are left untouched. */
const US_WITHHOLDING_RATE = 0.15;

function withholdingRate(currency: string): number {
  return currency === "USD" ? US_WITHHOLDING_RATE : 0;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Number of dividend payments in the trailing 365 days from the most recent ex-date; default 4, clamp 1..12. */
export function paymentsPerYear(history: { date: string }[]): number {
  if (history.length < 2) return 4;
  const sorted = [...history].map((h) => h.date).sort().reverse();
  const newest = new Date(sorted[0] + "T00:00:00Z").getTime();
  const cutoff = newest - 365 * 24 * 60 * 60 * 1000;
  // Strictly within the trailing year: a payment exactly 365 days before the newest is the
  // *prior* year's same-quarter dividend, not a 5th payment this year.
  const count = sorted.filter((d) => new Date(d + "T00:00:00Z").getTime() > cutoff).length;
  return Math.min(12, Math.max(1, count));
}

interface PriorRow {
  per_share_eur: number;
  qualifying_shares: number;
  yield_pct: number | null;
  locked: number;
}

interface ResolveInput {
  ticker: string;
  exDate: string;
  paymentDate: string;
  /** Per share in the dividend's reporting currency. */
  perShare: number;
  /** Conversion rate from that currency to EUR. */
  fxToEur: number;
  /** Fraction withheld at source (e.g. 0.15 for US dividends) — applied to the EUR-converted amount. */
  withholdingRate: number;
  quantity: number;
  /** Current share price in EUR (T212 account currency) — yield is computed entirely in EUR. */
  currentPriceEur: number;
  paymentsPerYear: number;
  today: string;
}

/** Pure: computes the row to upsert given the dividend event + this ticker's prior stored row (or null). */
export function resolveDividendRow(
  input: ResolveInput,
  prior: PriorRow | null,
): {
  ticker: string;
  ex_date: string;
  payment_date: string;
  per_share_usd: number;
  per_share_eur: number;
  qualifying_shares: number;
  amount_eur: number;
  yield_pct: number | null;
  locked: 0 | 1;
} {
  const wasLocked = prior?.locked === 1;
  const locked = wasLocked || input.exDate < input.today;

  // `locked && prior`: freeze the stored snapshot. `locked && !prior`: the ex-date passed before
  // this dividend was ever stored (D1 empty at first deploy, or holding added late) — no snapshot
  // to freeze, so fall back to today's FX + today's share count. Best effort.
  const perShareEur =
    locked && prior
      ? prior.per_share_eur
      : input.perShare * input.fxToEur * (1 - input.withholdingRate);
  const qualifyingShares = locked && prior ? prior.qualifying_shares : input.quantity;
  const yieldPct =
    locked && prior
      ? prior.yield_pct
      : input.currentPriceEur > 0
        ? ((perShareEur * input.paymentsPerYear) / input.currentPriceEur) * 100
        : null;

  return {
    ticker: input.ticker,
    ex_date: input.exDate,
    payment_date: input.paymentDate,
    per_share_usd: input.perShare,
    per_share_eur: perShareEur,
    qualifying_shares: qualifyingShares,
    amount_eur: perShareEur * qualifyingShares,
    yield_pct: yieldPct,
    locked: locked ? 1 : 0,
  };
}

export async function getDividends(d1: D1Database): Promise<DividendRow[]> {
  const rows = await db.all<{
    ticker: string;
    ex_date: string;
    payment_date: string;
    per_share_usd: number;
    per_share_eur: number;
    qualifying_shares: number;
    amount_eur: number;
    yield_pct: number | null;
    locked: number;
  }>(d1, `SELECT * FROM dividends ORDER BY ex_date ASC`);
  return rows.map((r) => ({
    ticker: r.ticker,
    exDate: r.ex_date,
    paymentDate: r.payment_date,
    perShareUsd: r.per_share_usd,
    perShareEur: r.per_share_eur,
    qualifyingShares: r.qualifying_shares,
    amountEur: r.amount_eur,
    yieldPct: r.yield_pct,
    locked: r.locked === 1,
  }));
}

export async function refreshDividends(
  d1: D1Database,
  eodhdKey: string,
  holdings: Holding[],
): Promise<DividendRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const paymentRetentionFloor = daysAgo(RETENTION_DAYS);

  // FX rates are cached per-currency in fx.ts; look each up lazily and skip a row if its
  // currency can't be converted (rather than writing a wrong EUR figure).
  const fxCache = new Map<string, number | null>();
  async function fx(currency: string): Promise<number | null> {
    if (!fxCache.has(currency)) {
      try {
        fxCache.set(currency, await currencyToEurRate(currency));
      } catch {
        fxCache.set(currency, null);
      }
    }
    return fxCache.get(currency) ?? null;
  }

  // One read for every stored row (instead of one SELECT per event) and one batched write at the
  // end keep this under the Workers free-tier 50-subrequest cap.
  const priors = new Map(
    (
      await db.all<PriorRow & { ticker: string; ex_date: string }>(
        d1,
        `SELECT ticker, ex_date, per_share_eur, qualifying_shares, yield_pct, locked FROM dividends`,
      )
    ).map((r) => [`${r.ticker}|${r.ex_date}`, r]),
  );
  const writes: [string, unknown[]][] = [];

  // EODHD free tier is 20 requests/day, so each daily run refreshes a rotating slice of holdings
  // (a different slice per day, wrapping) instead of all of them. Holdings with no stored dividend
  // (non-payers, or payers between retention expiry and their next declaration) are only checked
  // once a week, first in line that day, so a company that starts paying is still picked up.
  const day = Math.floor(Date.now() / 86_400_000);
  const payerTickers = new Set([...priors.values()].map((r) => r.ticker));
  const byTicker = holdings.filter((h) => !h.isManual).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const payers = byTicker.filter((h) => payerTickers.has(h.ticker));
  const others = day % 7 === 0 ? byTicker.filter((h) => !payerTickers.has(h.ticker)) : [];
  const start = (day * DAILY_FETCH_LIMIT) % Math.max(payers.length, 1);
  const rotated = payers.map((_, i) => payers[(start + i) % payers.length]);
  const todays = [...others, ...rotated].slice(0, DAILY_FETCH_LIMIT);

  for (const h of todays) {
    let events: DividendEvent[];
    try {
      events = await fetchEodhdDividends(eodhdKey, marketauxLookupTicker(h));
    } catch (err) {
      console.error(`EODHD dividends failed for ${h.ticker}:`, err);
      continue; // provider hiccup — keep this ticker's existing rows untouched
    }
    if (events.length === 0) continue;

    const ppy = paymentsPerYear(events.map((e) => ({ date: e.exDate })));

    for (const ev of events) {
      if (ev.exDate < EARLIEST_EX_DATE) continue;
      if (ev.paymentDate < paymentRetentionFloor) continue;

      const rate = await fx(ev.currency);
      if (rate === null) continue;

      const prior = priors.get(`${h.ticker}|${ev.exDate}`) ?? null;

      const row = resolveDividendRow(
        {
          ticker: h.ticker,
          exDate: ev.exDate,
          paymentDate: ev.paymentDate,
          perShare: ev.perShare,
          fxToEur: rate,
          withholdingRate: withholdingRate(ev.currency),
          quantity: h.quantity,
          currentPriceEur: h.currentPrice,
          paymentsPerYear: ppy,
          today,
        },
        prior,
      );

      writes.push([
        `INSERT INTO dividends
           (ticker, ex_date, payment_date, per_share_usd, per_share_eur, qualifying_shares, amount_eur, yield_pct, locked, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticker, ex_date) DO UPDATE SET
           payment_date = excluded.payment_date,
           per_share_usd = excluded.per_share_usd,
           per_share_eur = excluded.per_share_eur,
           qualifying_shares = excluded.qualifying_shares,
           amount_eur = excluded.amount_eur,
           yield_pct = excluded.yield_pct,
           locked = excluded.locked,
           updated_at = excluded.updated_at`,
        [
        row.ticker,
        row.ex_date,
        row.payment_date,
        row.per_share_usd,
        row.per_share_eur,
        row.qualifying_shares,
        row.amount_eur,
        row.yield_pct,
        row.locked,
        new Date().toISOString(),
        ],
      ]);
    }
  }

  // D1 caps a batch at 100 statements.
  for (let i = 0; i < writes.length; i += 50) await db.batch(d1, writes.slice(i, i + 50));

  await db.run(
    d1,
    `DELETE FROM dividends WHERE ex_date < ? OR payment_date < ?`,
    EARLIEST_EX_DATE,
    daysAgo(RETENTION_DAYS),
  );

  return getDividends(d1);
}
