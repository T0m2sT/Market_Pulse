import { fetchNewsForTicker, type MarketauxArticle } from "./marketaux";
import { rankArticles } from "./haiku";
import { marketauxLookupTicker, type Holding } from "./holdings";

export interface RankedArticle {
  id: string;
  ticker: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: number;
  impact: number;
  reason: string;
}

const RANKED_KEY = "news:ranked";
const SEEN_KEY = "news:seen";
const SEEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_N = 60;

/** Below this, Marketaux's entity match is a passing/incidental mention, not the article's real
 * subject — confirmed case: a Tesla robotaxi story tagged NVDA as an entity purely in passing, and
 * without this filter Claude still scored it as if NVDA were the subject (a big, wrong sentiment
 * swing on an unrelated ticker). Drop these before they ever reach Claude for impact scoring. */
const MIN_MATCH_SCORE = 0.1;

/** Hard-paywalled sources — a portfolio card linking to a story the user can't actually read past
 * the first paragraph isn't useful. Extend this list as more paywalled sources show up. */
const PAYWALLED_SOURCES = new Set(["seekingalpha.com"]);

interface SeenDoc {
  ids: { id: string; seenAt: number }[];
}

async function getSeen(kv: KVNamespace): Promise<SeenDoc> {
  return (await kv.get<SeenDoc>(SEEN_KEY, "json")) ?? { ids: [] };
}

async function markSeen(kv: KVNamespace, newIds: string[]): Promise<void> {
  const now = Date.now();
  const existing = await getSeen(kv);
  const cutoff = now - SEEN_WINDOW_MS;
  const kept = existing.ids.filter((e) => e.seenAt > cutoff);
  const merged = [...kept, ...newIds.map((id) => ({ id, seenAt: now }))];
  await kv.put(SEEN_KEY, JSON.stringify({ ids: merged }));
}

function recencyDecay(publishedAt: string): number {
  const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
  return Math.exp(-hoursOld / 48);
}

export interface NewsDoc {
  updatedAt: string;
  articles: RankedArticle[];
}

export async function getRankedNews(kv: KVNamespace): Promise<NewsDoc> {
  return (await kv.get<NewsDoc>(RANKED_KEY, "json")) ?? { updatedAt: new Date(0).toISOString(), articles: [] };
}

export async function refreshNews(
  kv: KVNamespace,
  marketauxToken: string,
  anthropicKey: string,
  holdings: Holding[],
): Promise<NewsDoc> {
  const lookupToDisplay = new Map(holdings.map((h) => [marketauxLookupTicker(h), h.ticker]));
  const weights = Object.fromEntries(holdings.map((h) => [h.ticker, h.weight]));

  const seen = await getSeen(kv);
  const seenIds = new Set(seen.ids.map((e) => e.id));

  // One call per ticker (see fetchNewsForTicker for why) — a failure on one ticker
  // shouldn't drop the whole cycle, so each call is caught independently.
  //
  // Fired in small batches, not all 25 at once: Cloudflare Workers caps concurrent
  // in-flight subrequests, and exceeding it force-cancels the oldest unread response to
  // avoid deadlock — confirmed via wrangler tail ("stalled HTTP response was canceled"),
  // which was silently dropping articles (and sometimes the later Haiku call) before this fix.
  const BATCH_SIZE = 4;
  const entries = [...lookupToDisplay.entries()];
  const perTickerResults: { display: string; articles: MarketauxArticle[] }[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ([lookup, display]) => {
        try {
          return { display, articles: await fetchNewsForTicker(marketauxToken, lookup) };
        } catch {
          return { display, articles: [] as MarketauxArticle[] };
        }
      }),
    );
    perTickerResults.push(...batchResults);
  }

  const rawArticles: MarketauxArticle[] = [];
  const seenUuids = new Set<string>();

  // One row per (article, matched holding) — an article can mention several of our tickers,
  // but we only score it against the ticker(s) both queried-for AND present in its entities.
  const candidates: {
    article: MarketauxArticle;
    ticker: string;
    matchScore: number;
    sentimentScore: number;
  }[] = [];

  for (const { display, articles } of perTickerResults) {
    for (const article of articles) {
      if (PAYWALLED_SOURCES.has(article.source)) continue;
      if (!seenUuids.has(article.uuid)) {
        seenUuids.add(article.uuid);
        rawArticles.push(article);
      }
      if (seenIds.has(article.uuid)) continue;
      const entity = article.entities.find((e) => lookupToDisplay.get(e.symbol) === display);
      const matchScore = entity?.match_score ?? 0;
      if (matchScore < MIN_MATCH_SCORE) continue; // passing mention, not the article's real subject
      candidates.push({
        article,
        ticker: display,
        matchScore,
        sentimentScore: entity?.sentiment_score ?? 0,
      });
    }
  }

  const preScored = candidates
    .map((c) => ({
      ...c,
      preScore: Math.abs(c.sentimentScore) * c.matchScore * recencyDecay(c.article.published_at),
    }))
    .sort((a, b) => b.preScore - a.preScore);

  const ranked = await rankArticles(
    anthropicKey,
    preScored.map((c) => ({
      id: c.article.uuid,
      ticker: c.ticker,
      title: c.article.title,
      description: c.article.description,
    })),
    weights,
  );

  const rankedById = new Map(ranked?.map((r) => [r.id, r]) ?? []);

  const scored: RankedArticle[] = preScored.map((c) => {
    const haikuResult = rankedById.get(c.article.uuid);
    const weight = weights[c.ticker] ?? 0;
    const impact = haikuResult
      ? haikuResult.impact * Math.sqrt(weight)
      : c.preScore * Math.sqrt(weight);
    return {
      id: c.article.uuid,
      ticker: c.ticker,
      title: c.article.title,
      description: c.article.description,
      url: c.article.url,
      source: c.article.source,
      publishedAt: c.article.published_at,
      sentiment: c.sentimentScore,
      impact,
      reason: haikuResult?.reason ?? "",
    };
  });

  scored.sort((a, b) => b.impact - a.impact);
  const articles = scored.slice(0, KEEP_N);

  const doc: NewsDoc = { updatedAt: new Date().toISOString(), articles };
  await kv.put(RANKED_KEY, JSON.stringify(doc));
  await markSeen(kv, rawArticles.map((a) => a.uuid));

  return doc;
}
