import { db } from "./db";
import { fetchDividends, type FmpDividend } from "./fmp";
import { fetchYahooDividends } from "./yahoo-dividends";
import { usdToEurRate } from "./fx";
import { marketauxLookupTicker, type Holding } from "./holdings";

export interface DividendRow {
  ticker: string;
  exDate: string;
  paymentDate: string;
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
  perShareUsd: number;
  usdToEur: number;
  quantity: number;
  currentPrice: number;
  paymentsPerYear: number;
  today: string;
}

/** Pure: computes the row to upsert given the FMP dividend + this ticker's prior stored row (or null). */
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
  // to freeze, so fall back to today's FX + today's share count. Best effort; the backfill covers
  // every realistic pre-deploy case since FMP still returns August dividends on first run.
  const perShareEur = locked && prior ? prior.per_share_eur : input.perShareUsd * input.usdToEur;
  const qualifyingShares = locked && prior ? prior.qualifying_shares : input.quantity;
  const yieldPct =
    locked && prior
      ? prior.yield_pct
      : input.currentPrice > 0
        ? ((input.perShareUsd * input.paymentsPerYear) / input.currentPrice) * 100
        : null;

  return {
    ticker: input.ticker,
    ex_date: input.exDate,
    payment_date: input.paymentDate,
    per_share_usd: input.perShareUsd,
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
  fmpKey: string,
  holdings: Holding[],
): Promise<DividendRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  let usdToEur: number;
  try {
    usdToEur = await usdToEurRate();
  } catch {
    return getDividends(d1); // don't write unconverted USD as EUR
  }

  const paymentRetentionFloor = daysAgo(RETENTION_DAYS);

  for (const h of holdings) {
    if (h.isManual) continue;

    const lookupSym = marketauxLookupTicker(h);
    let fmpDividends: FmpDividend[];
    try {
      fmpDividends = await fetchDividends(fmpKey, lookupSym);
    } catch {
      // FMP free tier gates ~half the holdings (HTTP 402). Fall back to Yahoo (ex-date + amount,
      // payment date estimated). If that also fails, keep this ticker's existing rows untouched.
      try {
        fmpDividends = await fetchYahooDividends(lookupSym);
      } catch {
        continue;
      }
    }

    const ppy = paymentsPerYear(fmpDividends.map((d) => ({ date: d.date })));

    for (const div of fmpDividends) {
      if (div.date < EARLIEST_EX_DATE) continue;
      if (div.paymentDate < paymentRetentionFloor) continue;

      const prior = await db.first<PriorRow>(
        d1,
        `SELECT per_share_eur, qualifying_shares, yield_pct, locked FROM dividends WHERE ticker = ? AND ex_date = ?`,
        h.ticker,
        div.date,
      );

      const row = resolveDividendRow(
        {
          ticker: h.ticker,
          exDate: div.date,
          paymentDate: div.paymentDate,
          perShareUsd: div.dividend,
          usdToEur,
          quantity: h.quantity,
          currentPrice: h.currentPrice,
          paymentsPerYear: ppy,
          today,
        },
        prior,
      );

      await db.run(
        d1,
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
      );
    }
  }

  await db.run(
    d1,
    `DELETE FROM dividends WHERE ex_date < ? OR payment_date < ?`,
    EARLIEST_EX_DATE,
    daysAgo(RETENTION_DAYS),
  );

  return getDividends(d1);
}
