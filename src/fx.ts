/** Free, no-key FX rates, refreshed daily by the provider. refreshReturns calls usdToEurRate
 * every minute during market hours, so rates are cached in-memory for the Worker instance's
 * lifetime — without this, hammering the free API every minute gets rate-limited, which silently
 * skips the returns write (refreshReturns falls back to the stale doc on fetch failure). */
const cache = new Map<string, { rate: number; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — plenty fresh for a daily-updated rate

/** <currency> -> EUR conversion rate (e.g. currencyToEurRate("USD") ~= 0.92). */
export async function currencyToEurRate(currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return 1;

  const hit = cache.get(cur);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.rate;
  }
  const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${cur}`);
  if (!res.ok) {
    throw new Error(`FX rate fetch failed for ${cur}: ${res.status}`);
  }
  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data.rates?.EUR;
  if (typeof rate !== "number") {
    throw new Error(`FX response missing EUR rate for ${cur}`);
  }
  cache.set(cur, { rate, fetchedAt: Date.now() });
  return rate;
}

export function usdToEurRate(): Promise<number> {
  return currencyToEurRate("USD");
}
