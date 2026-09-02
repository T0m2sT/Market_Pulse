/** Free, no-key USD->EUR rate, refreshed daily by the provider. refreshReturns now calls this
 * every minute during market hours, so cache it in-memory for the Worker instance's lifetime —
 * without this, hammering the free API every minute gets rate-limited, which silently skips the
 * returns write (refreshReturns falls back to the stale doc on fetch failure). */
let cached: { rate: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — plenty fresh for a daily-updated rate

export async function usdToEurRate(): Promise<number> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
  if (!res.ok) {
    throw new Error(`FX rate fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { rates: Record<string, number> };
  const rate = data.rates.EUR;
  if (typeof rate !== "number") {
    throw new Error("FX response missing EUR rate");
  }
  cached = { rate, fetchedAt: Date.now() };
  return rate;
}
