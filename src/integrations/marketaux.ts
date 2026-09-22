export interface MarketauxEntity {
  symbol: string;
  match_score: number;
  sentiment_score: number;
}

export interface MarketauxArticle {
  uuid: string;
  title: string;
  description: string;
  url: string;
  source: string;
  published_at: string;
  entities: MarketauxEntity[];
}

/**
 * Marketaux's free tier caps every response at 3 articles no matter what `limit` is set to
 * (confirmed empirically: x-usagelimit-limit is 100/day, x-ratelimit-limit is 30/min).
 * A single batched symbols= call for many tickers therefore returns only 3 articles
 * total, mostly missing whichever tickers aren't in that day's global top 3 — so this
 * fetches per ticker instead, one call each, to actually guarantee coverage.
 */
export async function fetchNewsForTicker(token: string, symbol: string): Promise<MarketauxArticle[]> {
  const url = `https://api.marketaux.com/v1/news/all?symbols=${symbol}&limit=3&language=en&api_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Marketaux error ${res.status} for ${symbol}`);
  }
  const data = (await res.json()) as { data?: MarketauxArticle[] };
  return data.data ?? [];
}
