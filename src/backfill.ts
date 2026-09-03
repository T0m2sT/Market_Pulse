import { db } from "./db";
import { refreshDividends } from "./dividends";
import { refreshEarnings } from "./earnings";
import type { Holding } from "./holdings";

/**
 * One-time, idempotent. Safe to re-run — every write is an upsert.
 * Both dividends (EODHD) and earnings (Finnhub /stock/earnings, 4 quarters) come from a single
 * refresh call each — no chunking, no Claude enrichment loop needed any more.
 */
export async function runBackfill(
  d1: D1Database,
  env: {
    EODHD_API_KEY: string;
    FINNHUB_API_KEY: string;
    ANTHROPIC_API_KEY: string;
  },
  holdings: Holding[],
): Promise<{ dividends: number; earningsRows: number }> {
  await refreshDividends(d1, env.EODHD_API_KEY, holdings);
  await refreshEarnings(d1, env.FINNHUB_API_KEY, holdings, env.ANTHROPIC_API_KEY);

  const div = await db.first<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM dividends`);
  const ern = await db.first<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM earnings_results`);
  return { dividends: div?.n ?? 0, earningsRows: ern?.n ?? 0 };
}
