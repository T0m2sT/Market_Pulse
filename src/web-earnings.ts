/**
 * KAP.L (Kazatomprom, LSE-listed) has no earnings coverage on any free data provider we could
 * find (Finnhub, FMP, API Ninjas, Twelve Data, Alpha Vantage all checked). As a fallback for this
 * one ticker, ask Claude (with the web_search tool) to look up its next earnings date and recent
 * EPS history directly. All other holdings use Finnhub /stock/earnings (see earnings.ts).
 */

const HAIKU = "claude-haiku-4-5-20251001";

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
      model: HAIKU,
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
 * Weekly by default; daily during the week the estimated/known next date falls in.
 */
export function shouldRefreshWebEarnings(prior: WebEarningsDoc | null): boolean {
  if (!prior) return true;

  const checkedAt = new Date(prior.checkedAt).getTime();
  const daysSinceCheck = (Date.now() - checkedAt) / (1000 * 60 * 60 * 24);

  if (prior.next) {
    const daysUntilNext =
      (new Date(prior.next.date + "T00:00:00Z").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntilNext <= 7 && daysUntilNext >= -1) {
      return daysSinceCheck >= 1; // earnings week — check daily
    }
  }

  return daysSinceCheck >= 7; // otherwise — check weekly
}
