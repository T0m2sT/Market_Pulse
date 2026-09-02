import { fetchDividends } from "./fmp";
import { usdToEurRate } from "./fx";
import { marketauxLookupTicker, type Holding } from "./holdings";

export interface UpcomingDividend {
  ticker: string;
  name: string;
  logo?: string;
  exDate: string;
  paymentDate: string;
  perShare: number;
  qualifyingShares: number;
  estimatedPayment: number;
  locked: boolean;
}

const KV_KEY = "dividends:upcoming";
const FUTURE_WINDOW_DAYS = 90;
const PAST_WINDOW_DAYS = 14; // keep recently-passed ex-dates visible for a bit, not just future ones

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getUpcomingDividends(kv: KVNamespace): Promise<UpcomingDividend[]> {
  return (await kv.get<UpcomingDividend[]>(KV_KEY, "json")) ?? [];
}

/**
 * Qualification tracking: while a dividend's ex-date is still in the future (locked: false),
 * qualifyingShares is overwritten with the holding's current quantity every refresh — it
 * tracks your live position. The moment the ex-date has passed (locked: true), the PRIOR
 * stored record's qualifyingShares is carried forward unchanged, because that's the real
 * number that mattered at the deadline and today's quantity may have already moved on.
 * No transaction history needed — this piggybacks on the existing holdings-sync cron.
 */
export async function refreshDividends(
  kv: KVNamespace,
  fmpKey: string,
  holdings: Holding[],
): Promise<UpcomingDividend[]> {
  const today = todayUTC();
  const windowStart = new Date(Date.now() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEnd = new Date(Date.now() + FUTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // FMP's dividend field has no currency marker; every holding here is US-listed except KAP.L
  // (which has no dividend coverage on any provider we use), so USD->EUR covers the real
  // portfolio. If a EUR- or GBP-listed dividend payer is ever added, this assumption breaks
  // and needs per-ticker currency detection — not built, since no such holding exists today.
  //
  // On an FX fetch failure, abort rather than silently showing unconverted USD as if it were
  // EUR — that's a worse failure mode than serving the prior, still-correct stored snapshot.
  let usdToEur: number;
  try {
    usdToEur = await usdToEurRate();
  } catch {
    return getUpcomingDividends(kv);
  }

  const priorByKey = new Map(
    (await getUpcomingDividends(kv)).map((d) => [`${d.ticker}:${d.exDate}`, d]),
  );

  const results: UpcomingDividend[] = [];

  for (const h of holdings) {
    if (h.isManual) continue; // no public ticker — nothing to fetch, nothing to estimate

    let dividends;
    try {
      dividends = await fetchDividends(fmpKey, marketauxLookupTicker(h));
    } catch {
      // Provider hiccup on this ticker — keep whatever was already stored for it rather than dropping it.
      for (const [key, prior] of priorByKey) {
        if (prior.ticker === h.ticker) results.push(prior);
        priorByKey.delete(key);
      }
      continue;
    }

    for (const div of dividends) {
      if (div.date < windowStart || div.date > windowEnd) continue;

      const key = `${h.ticker}:${div.date}`;
      const prior = priorByKey.get(key);
      const wasLocked = prior?.locked ?? false;
      const locked = wasLocked || div.date < today;

      // Once locked, freeze both the share count AND the already-converted EUR amount at
      // whatever was already stored — a "locked in" number that still drifts with today's
      // exchange rate isn't actually locked. Never locked yet — keep tracking current
      // quantity and re-converting at today's rate.
      const qualifyingShares = locked ? (prior?.qualifyingShares ?? h.quantity) : h.quantity;
      const perShareEur = locked && prior ? prior.perShare : div.dividend * usdToEur;

      results.push({
        ticker: h.ticker,
        name: h.name,
        logo: h.logo,
        exDate: div.date,
        paymentDate: div.paymentDate,
        perShare: perShareEur,
        qualifyingShares,
        estimatedPayment: perShareEur * qualifyingShares,
        locked,
      });
    }
  }

  results.sort((a, b) => a.exDate.localeCompare(b.exDate));
  await kv.put(KV_KEY, JSON.stringify(results));
  return results;
}
