import type { Holding, Sector } from "./holdings";
import { usdToEurRate } from "./fx";

export interface PositionReturn {
  ticker: string;
  displayTicker?: string;
  name: string;
  logo?: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  isManual: boolean;
}

export interface SectorReturn {
  sector: Sector;
  value: number;
  pnl: number;
  pnlPercent: number;
  positions: PositionReturn[];
}

export interface ReturnsDoc {
  updatedAt: string;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  sectors: SectorReturn[];
}

const KV_KEY = "returns:current";

export async function getReturns(kv: KVNamespace): Promise<ReturnsDoc | null> {
  return kv.get<ReturnsDoc>(KV_KEY, "json");
}

/**
 * T212's /equity/portfolio returns currentPrice/averagePrice in each security's own trading
 * currency (USD for every US-listed holding here), NOT the account's EUR — confirmed against
 * T212's docs and by the fact our totals were ~6% higher than the real EUR total before this
 * fix (raw USD numbers being summed as if they were already euros). ppl is NOT affected: T212
 * computes that one server-side in account currency already (confirmed matching T212's own
 * total P&L in an earlier check), so only currentPrice/averagePrice-derived figures (value,
 * cost basis) need converting here.
 *
 * Manual positions (isManual) are skipped — MOUS's price was hand-converted to EUR at entry,
 * so it's already correct and re-converting would double-discount it.
 *
 * Not currency-exact for KAP.L (GBP-listed) — this applies one USD->EUR rate to every non-manual
 * position. Good enough per explicit call: the alternative (per-position currency detection)
 * was ruled out as more complexity than this portfolio's one GBP position justifies.
 */
export function computeReturns(holdings: Holding[], usdToEur: number): ReturnsDoc {
  const bySector = new Map<Sector, PositionReturn[]>();

  for (const h of holdings) {
    const fx = h.isManual ? 1 : usdToEur;
    const costBasis = h.averagePrice * h.quantity * fx;
    // T212 positions: use T212's own ppl (already in EUR, includes FX effects — do not convert
    // this one). Manual positions have no T212 feed, so compute directly instead.
    const pnl = h.isManual ? (h.currentPrice - h.averagePrice) * h.quantity : (h.ppl ?? 0);
    const position: PositionReturn = {
      ticker: h.ticker,
      displayTicker: h.displayTicker,
      name: h.name,
      logo: h.logo,
      quantity: h.quantity,
      averagePrice: h.averagePrice * fx,
      currentPrice: h.currentPrice * fx,
      pnl,
      pnlPercent: costBasis > 0 ? pnl / costBasis : 0,
      isManual: h.isManual,
    };
    const list = bySector.get(h.sector) ?? [];
    list.push(position);
    bySector.set(h.sector, list);
  }

  const sectors: SectorReturn[] = [...bySector.entries()].map(([sector, positions]) => {
    const value = positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0);
    const pnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    const costBasis = positions.reduce((sum, p) => sum + p.averagePrice * p.quantity, 0);
    return { sector, value, pnl, pnlPercent: costBasis > 0 ? pnl / costBasis : 0, positions };
  });

  const totalValue = sectors.reduce((sum, s) => sum + s.value, 0);
  const totalPnl = sectors.reduce((sum, s) => sum + s.pnl, 0);
  const totalCostBasis = sectors.reduce(
    (sum, s) => sum + s.positions.reduce((psum, p) => psum + p.averagePrice * p.quantity, 0),
    0,
  );

  return {
    updatedAt: new Date().toISOString(),
    totalValue,
    totalPnl,
    totalPnlPercent: totalCostBasis > 0 ? totalPnl / totalCostBasis : 0,
    sectors,
  };
}

export async function refreshReturns(kv: KVNamespace, holdings: Holding[]): Promise<ReturnsDoc> {
  let usdToEur = 1;
  try {
    usdToEur = await usdToEurRate();
  } catch {
    // FX provider hiccup — fall back to the last-known snapshot rather than showing wrong
    // (unconverted) numbers; the caller (index.ts) already has stale-fallback handling for this.
    const stale = await getReturns(kv);
    if (stale) return stale;
  }
  const doc = computeReturns(holdings, usdToEur);
  await kv.put(KV_KEY, JSON.stringify(doc));
  return doc;
}
