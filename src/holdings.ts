import { fetchPortfolio, stripTickerSuffix, type T212Position } from "./trading212";
import { fetchCompanyProfile } from "./finnhub";

export const SECTORS = [
  "Energy",
  "Materials",
  "Industrials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Information Technology",
  "Communication Services",
  "Utilities",
  "Real Estate",
  "Unassigned",
] as const;

export type Sector = (typeof SECTORS)[number];

export interface Holding {
  ticker: string;
  /**
   * Optional display override — shown in the UI wherever the ticker chip appears. Used when
   * T212's own raw feed reports a stale symbol (e.g. still calls Howmet Aerospace "ARNC" after
   * its 2020 spinoff rename) but `ticker` itself must stay unchanged so the next portfolio sync
   * still recognises this as the same position.
   */
  displayTicker?: string;
  name: string;
  weight: number;
  sector: Sector;
  quantity: number;
  averagePrice: number;
  /** T212 positions: last-synced live price. Manual positions: hand-set, never fetched. */
  currentPrice: number;
  /**
   * T212's own unrealized P&L for this position, in account currency (already includes FX
   * effects T212 computes server-side — do NOT recompute this as (currentPrice - averagePrice)
   * * quantity, that formula silently drops the FX component and was confirmed wrong against
   * every live position). Manual positions have no T212 feed, so this is computed locally
   * instead — see returns.ts.
   */
  ppl?: number;
  /** Real company logo URL from Finnhub, fetched once on first sync — falls back to an initials avatar when absent. */
  logo?: string;
  /** True for a position with no T212 feed (private/unlisted shares, a manually-tracked ticker). */
  isManual: boolean;
  /**
   * Overrides for when T212's ticker doesn't match what a given provider indexes the company
   * under — and the two providers can disagree with each other, not just with T212. Confirmed
   * case: Oasis Petroleum renamed to Chord Energy in 2022. Finnhub only recognises the new
   * ticker (CHRD); Marketaux still indexes news under the old one (OAS) and returns nothing
   * for CHRD. A single override can't satisfy both, so each provider gets its own.
   */
  finnhubTicker?: string;
  marketauxTicker?: string;
}

/** The ticker to query Finnhub with — override if set, else the T212 ticker. */
export function finnhubLookupTicker(holding: Holding): string {
  return holding.finnhubTicker ?? holding.ticker;
}

/** The ticker to query Marketaux with — override if set, else the T212 ticker. */
export function marketauxLookupTicker(holding: Holding): string {
  return holding.marketauxTicker ?? holding.ticker;
}

export interface HoldingsDoc {
  updatedAt: string;
  positions: Holding[];
}

const KV_KEY = "holdings:current";

export async function getHoldings(kv: KVNamespace): Promise<HoldingsDoc> {
  const doc = await kv.get<HoldingsDoc>(KV_KEY, "json");
  return doc ?? { updatedAt: new Date(0).toISOString(), positions: [] };
}

export async function putHoldings(kv: KVNamespace, positions: Holding[]): Promise<HoldingsDoc> {
  const doc: HoldingsDoc = { updatedAt: new Date().toISOString(), positions };
  await kv.put(KV_KEY, JSON.stringify(doc));
  return doc;
}

export function isValidHoldingsInput(input: unknown): input is Holding[] {
  if (!Array.isArray(input)) return false;
  return input.every((raw) => {
    const p = raw as Holding;
    return (
      typeof p === "object" &&
      p !== null &&
      typeof p.ticker === "string" &&
      (p.displayTicker === undefined || typeof p.displayTicker === "string") &&
      typeof p.name === "string" &&
      typeof p.weight === "number" &&
      SECTORS.includes(p.sector) &&
      typeof p.quantity === "number" &&
      typeof p.averagePrice === "number" &&
      typeof p.currentPrice === "number" &&
      typeof p.isManual === "boolean" &&
      (p.ppl === undefined || typeof p.ppl === "number") &&
      (p.logo === undefined || typeof p.logo === "string") &&
      (p.finnhubTicker === undefined || typeof p.finnhubTicker === "string") &&
      (p.marketauxTicker === undefined || typeof p.marketauxTicker === "string")
    );
  });
}

export function normaliseInputWeights(positions: Holding[]): Holding[] {
  const total = positions.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return positions;
  return positions.map((p) => ({ ...p, weight: p.weight / total }));
}

function normaliseWeights(positions: Omit<Holding, "weight">[]): Holding[] {
  const total = positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
  return positions.map((p) => ({
    ...p,
    weight: total > 0 ? (p.quantity * p.currentPrice) / total : 0,
  }));
}

/**
 * Pulls live positions from T212 and merges them with existing holdings, WITHOUT writing to KV —
 * the caller decides whether this is a manual sync (writes) or just a price refresh for computing
 * returns (doesn't write, so the automated per-minute returns cron costs 1 KV write, not 2).
 * Manual positions (isManual: true) are untouched — T212 has no record of them.
 * T212 positions get fresh quantity/price; sector, name, logo, and ticker overrides are
 * preserved once resolved. Company name/logo are fetched from Finnhub only the first time a
 * ticker is seen (name still equals the raw ticker) — not re-fetched every cycle.
 */
export async function fetchMergedTrading212Positions(
  kv: KVNamespace,
  keyId: string,
  secret: string,
  finnhubToken: string,
): Promise<Holding[]> {
  const t212Positions: T212Position[] = await fetchPortfolio(keyId, secret);
  const existing = await getHoldings(kv);
  const existingByTicker = new Map(existing.positions.map((p) => [p.ticker, p]));
  const manualPositions = existing.positions.filter((p) => p.isManual);

  const synced = await Promise.all(
    t212Positions.map(async (pos) => {
      const ticker = stripTickerSuffix(pos.ticker);
      const prior = existingByTicker.get(ticker);
      const needsProfile = !prior || prior.name === prior.ticker;
      const profile = needsProfile ? await fetchCompanyProfile(finnhubToken, ticker) : null;

      return {
        ticker,
        displayTicker: prior?.displayTicker,
        name: profile?.name ?? prior?.name ?? ticker,
        logo: profile?.logo ?? prior?.logo,
        sector: prior?.sector ?? ("Unassigned" as Sector),
        finnhubTicker: prior?.finnhubTicker,
        marketauxTicker: prior?.marketauxTicker,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        currentPrice: pos.currentPrice,
        ppl: pos.ppl,
        isManual: false as const,
      };
    }),
  );

  return normaliseWeights([...synced, ...manualPositions]);
}

/** Manual-only: syncs holdings from T212 AND writes the result to KV. Call this from a user-triggered
 * action (PUT /api/holdings, a "sync now" button) — never from an automated cron, so holdings only
 * change when the user asks. For automated returns refreshes, use fetchMergedTrading212Positions instead. */
export async function syncFromTrading212(
  kv: KVNamespace,
  keyId: string,
  secret: string,
  finnhubToken: string,
): Promise<HoldingsDoc> {
  const positions = await fetchMergedTrading212Positions(kv, keyId, secret, finnhubToken);
  return putHoldings(kv, positions);
}
