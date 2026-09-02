import { db } from "./db";
import { fetchNewsForTicker, type MarketauxArticle } from "./marketaux";
import { isoWeekBounds } from "./iso-week";
import { marketauxLookupTicker, type Holding } from "./holdings";

const HAIKU = "claude-haiku-4-5-20251001";
const ARTICLE_RETENTION_DAYS = 30;
const BRIEFING_RETENTION_WEEKS = 5;
const MIN_MATCH_SCORE = 0.1;
const PAYWALLED_SOURCES = new Set(["seekingalpha.com"]);
const BATCH_SIZE = 4;

export interface Briefing {
  ticker: string;
  weekStart: string;
  summary: string;
  body: string;
  sentiment: number;
  articleCount: number;
  seen: boolean;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function weeksAgo(n: number): string {
  return daysAgo(n * 7);
}

export function briefingSentiment(sentiments: number[]): number {
  if (sentiments.length === 0) return 0;
  return sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
}

/** True when we should generate briefings for `justCompletedWeekStart` (no briefing row exists for it yet). */
export function shouldGenerateBriefings(
  justCompletedWeekStart: string,
  latestBriefingWeekStart: string | null,
): boolean {
  return latestBriefingWeekStart !== justCompletedWeekStart;
}

// ---- Reads ----

export interface NewsDoc {
  updatedAt: string;
  briefings: Briefing[];
}

export async function getBriefings(d1: D1Database): Promise<NewsDoc> {
  const rows = await db.all<{
    ticker: string;
    week_start: string;
    summary: string;
    body: string;
    sentiment: number;
    article_count: number;
    seen: number;
    created_at: string;
  }>(d1, `SELECT * FROM news_briefings ORDER BY week_start DESC, ABS(sentiment) DESC`);
  const updatedAt = rows[0]?.created_at ?? new Date(0).toISOString();
  return {
    updatedAt,
    briefings: rows.map((r) => ({
      ticker: r.ticker,
      weekStart: r.week_start,
      summary: r.summary,
      body: r.body,
      sentiment: r.sentiment,
      articleCount: r.article_count,
      seen: r.seen === 1,
    })),
  };
}

export async function markBriefingSeen(d1: D1Database, ticker: string, weekStart: string): Promise<void> {
  await db.run(
    d1,
    `UPDATE news_briefings SET seen = 1 WHERE ticker = ? AND week_start = ?`,
    ticker,
    weekStart,
  );
}

// ---- Article ingest ----

export async function refreshArticles(
  d1: D1Database,
  marketauxToken: string,
  holdings: Holding[],
): Promise<void> {
  const lookupToDisplay = new Map(holdings.map((h) => [marketauxLookupTicker(h), h.ticker]));
  const entries = [...lookupToDisplay.entries()];
  const now = new Date().toISOString();

  const perTicker: { display: string; articles: MarketauxArticle[] }[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const res = await Promise.all(
      batch.map(async ([lookup, display]) => {
        try {
          return { display, articles: await fetchNewsForTicker(marketauxToken, lookup) };
        } catch {
          return { display, articles: [] as MarketauxArticle[] };
        }
      }),
    );
    perTicker.push(...res);
  }

  // D1 caps a batch at 100 bound statements; ~25 tickers x 3 articles = <=75, safe. If holdings
  // ever exceed ~30, chunk this loop into batches of 50.
  const statements: [string, unknown[]][] = [];
  for (const { display, articles } of perTicker) {
    for (const a of articles) {
      if (PAYWALLED_SOURCES.has(a.source)) continue;
      const entity = a.entities.find((e) => lookupToDisplay.get(e.symbol) === display);
      const matchScore = entity?.match_score ?? 0;
      if (matchScore < MIN_MATCH_SCORE) continue;
      statements.push([
        `INSERT INTO news_articles (url, ticker, title, description, source, published_at, sentiment, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET
           sentiment = excluded.sentiment, fetched_at = excluded.fetched_at`,
        [a.url, display, a.title, a.description ?? "", a.source, a.published_at, entity?.sentiment_score ?? 0, now],
      ]);
    }
  }
  await db.batch(d1, statements);

  await db.run(d1, `DELETE FROM news_articles WHERE published_at < ?`, daysAgo(ARTICLE_RETENTION_DAYS));
}

// ---- Weekly briefing generation ----

const BRIEFING_SYSTEM_PROMPT = `You write a weekly briefing on what is going on with a single company, for someone who holds its stock and wants the picture without reading every article.
You are given that week's news articles for the company (titles, descriptions, sources, sentiment scores).
Write from ONLY those articles — do not invent facts not present in them.
Respond with ONLY JSON, no prose: {"summary": "...", "body": "..."}
summary: 1-2 sentences, the single most important thing that happened this week.
body: 3-6 short paragraphs of plain prose covering the week's developments, why they matter to a shareholder, and the overall tone. No markdown, no headings, no bullet lists.`;

interface BriefingResult {
  summary: string;
  body: string;
}

async function generateBriefing(
  anthropicKey: string,
  ticker: string,
  name: string,
  weekLabel: string,
  articles: { title: string; description: string; source: string; sentiment: number }[],
): Promise<BriefingResult | null> {
  const userContent =
    `Company: ${name} (${ticker}). Week: ${weekLabel}.\n\nArticles:\n` +
    articles
      .map(
        (a, i) =>
          `${i + 1}. [${a.source}] (sentiment ${a.sentiment.toFixed(2)})\n${a.title}\n${a.description}`,
      )
      .join("\n---\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 2048,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as BriefingResult;
    if (typeof parsed.summary !== "string" || typeof parsed.body !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function refreshBriefings(
  d1: D1Database,
  anthropicKey: string,
  holdings: Holding[],
): Promise<void> {
  // Runs from a Monday-only cron. "3 days ago" lands in the just-completed Mon-Sun week
  // regardless of the exact run hour.
  const { weekStart, weekEnd } = isoWeekBounds(daysAgo(3));

  const latest = await db.first<{ week_start: string }>(
    d1,
    `SELECT week_start FROM news_briefings ORDER BY week_start DESC LIMIT 1`,
  );
  if (!shouldGenerateBriefings(weekStart, latest?.week_start ?? null)) return;

  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));

  const grouped = await db.all<{ ticker: string }>(
    d1,
    `SELECT DISTINCT ticker FROM news_articles WHERE published_at >= ? AND published_at <= ?`,
    weekStart,
    weekEnd + "T23:59:59Z",
  );

  for (const { ticker } of grouped) {
    const articles = await db.all<{
      title: string;
      description: string;
      source: string;
      sentiment: number;
    }>(
      d1,
      `SELECT title, description, source, sentiment FROM news_articles
       WHERE ticker = ? AND published_at >= ? AND published_at <= ?
       ORDER BY published_at ASC`,
      ticker,
      weekStart,
      weekEnd + "T23:59:59Z",
    );
    if (articles.length === 0) continue;

    const briefing = await generateBriefing(
      anthropicKey,
      ticker,
      nameByTicker.get(ticker) ?? ticker,
      `${weekStart} to ${weekEnd}`,
      articles.map((a) => ({
        title: a.title,
        description: a.description,
        source: a.source,
        sentiment: a.sentiment,
      })),
    );
    if (!briefing) continue;

    await db.run(
      d1,
      `INSERT INTO news_briefings
         (ticker, week_start, summary, body, sentiment, article_count, seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (ticker, week_start) DO UPDATE SET
         summary = excluded.summary, body = excluded.body,
         sentiment = excluded.sentiment, article_count = excluded.article_count,
         created_at = excluded.created_at`,
      ticker,
      weekStart,
      briefing.summary,
      briefing.body,
      briefingSentiment(articles.map((a) => a.sentiment)),
      articles.length,
      new Date().toISOString(),
    );
  }

  await db.run(d1, `DELETE FROM news_briefings WHERE week_start < ?`, weeksAgo(BRIEFING_RETENTION_WEEKS));
}

export async function refreshNews(
  d1: D1Database,
  marketauxToken: string,
  _anthropicKey: string,
  holdings: Holding[],
): Promise<NewsDoc> {
  await refreshArticles(d1, marketauxToken, holdings);
  return getBriefings(d1);
}
