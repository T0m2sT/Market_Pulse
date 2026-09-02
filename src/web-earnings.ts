/**
 * KAP.L (Kazatomprom, LSE-listed) has no earnings coverage on any free data provider we could
 * find (Finnhub, FMP, API Ninjas, Twelve Data, Alpha Vantage all checked — see conversation
 * history). As a fallback for this one ticker, ask Claude (with the web_search tool) to look up
 * its next earnings date and recent history directly, since a live web search finds what
 * structured financial-data APIs don't index for free.
 */

export interface WebEarningsEntry {
  date: string; // YYYY-MM-DD, next known/estimated reporting date
  isEstimate: boolean;
}

export interface WebEarningsHistoryEntry {
  period: string; // e.g. "H1 2026"
  date: string; // YYYY-MM-DD
  /** EPS in USD, converted if the company reports in another currency. Null if not found/inapplicable. */
  epsActual: number | null;
  epsEstimate: number | null;
}

export interface WebEarningsDoc {
  ticker: string;
  next: WebEarningsEntry | null;
  history: WebEarningsHistoryEntry[];
  checkedAt: string;
}

const SYSTEM_PROMPT = `You research stock earnings dates and results using web search. Given a company name and ticker, find:
1. Its next scheduled or estimated earnings/results announcement date.
2. Its 4 most recent past earnings/results announcements: date, period label (e.g. "H1 2026"), and earnings per share (EPS) actual vs analyst estimate, converted to USD if the company reports in another currency.
Respond with ONLY JSON, no prose: {"next": {"date": "YYYY-MM-DD", "isEstimate": true|false} | null, "history": [{"period": "...", "date": "YYYY-MM-DD", "epsActual": number|null, "epsEstimate": number|null}]}
Use isEstimate: true if the date is not yet officially confirmed by the company. Use null for "next" if no date could be found at all. Use null for epsActual/epsEstimate if EPS figures aren't available or don't apply (e.g. no analyst consensus).`;

interface ContentBlock {
  type: string;
  text?: string;
}

export async function lookupEarningsViaWebSearch(
  apiKey: string,
  ticker: string,
  companyName: string,
): Promise<WebEarningsDoc | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Company: ${companyName} (${ticker})` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  });

  if (!res.ok) return null;

  try {
    const data = (await res.json()) as { content: ContentBlock[] };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      next: WebEarningsEntry | null;
      history: WebEarningsHistoryEntry[];
    };
    return {
      ticker,
      next: parsed.next ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Weekly by default; daily during the week the estimated/known next date falls in, so a fuzzy
 * estimate tightens up right before it matters instead of going stale for up to 7 days.
 */
export function shouldRefreshWebEarnings(prior: WebEarningsDoc | null): boolean {
  if (!prior) return true;

  const checkedAt = new Date(prior.checkedAt).getTime();
  const daysSinceCheck = (Date.now() - checkedAt) / (1000 * 60 * 60 * 24);

  if (prior.next) {
    const daysUntilNext = (new Date(prior.next.date + "T00:00:00Z").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntilNext <= 7 && daysUntilNext >= -1) {
      return daysSinceCheck >= 1; // earnings week — check daily
    }
  }

  return daysSinceCheck >= 7; // otherwise — check weekly
}

/**
 * Recap for a holding that reported earnings on a given recent date (today or the last couple of
 * days) — pulled via web search since Finnhub's estimate-only calendar entry has no actual/
 * surprise data until it later backfills `stock/earnings`, and even then some tickers (e.g. LSE
 * listings) never get covered at all.
 */
export interface TodayEarningsRecap {
  ticker: string;
  date: string; // YYYY-MM-DD, the reporting date this recap is for
  epsActual: number | null;
  epsEstimate: number | null;
  takeaway: string; // 1-3 sentence plain-English summary of how it went
  checkedAt: string;
}

const RECAP_SYSTEM_PROMPT = `You research a stock's earnings results using web search. Given a company name, ticker, and the date it reported earnings, find the results announced on that date.
Respond with ONLY JSON, no prose: {"epsActual": number|null, "epsEstimate": number|null, "takeaway": "..."}
epsActual/epsEstimate: EPS in USD, converted if reported in another currency; null if not found or not applicable.
takeaway: 1-3 plain-English sentences on how the results went (beat/missed estimates, notable guidance or news) — written for someone glancing at their portfolio app, not a research note. If nothing has been reported on or after that date yet, say so plainly in the takeaway and use null for the EPS fields.`;

export async function lookupTodayEarningsRecap(
  apiKey: string,
  ticker: string,
  companyName: string,
  date: string,
): Promise<TodayEarningsRecap | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: RECAP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Company: ${companyName} (${ticker}). Reported earnings on: ${date}.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  });

  if (!res.ok) return null;

  try {
    const data = (await res.json()) as { content: ContentBlock[] };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      epsActual: number | null;
      epsEstimate: number | null;
      takeaway: string;
    };
    if (typeof parsed.takeaway !== "string") return null;
    return {
      ticker,
      date,
      epsActual: parsed.epsActual ?? null,
      epsEstimate: parsed.epsEstimate ?? null,
      takeaway: parsed.takeaway,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
