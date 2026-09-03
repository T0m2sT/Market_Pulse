/**
 * KAP.L (Kazatomprom, LSE-listed) has no earnings coverage on any free data provider we could
 * find (Finnhub, FMP, API Ninjas, Twelve Data, Alpha Vantage all checked). As a fallback for this
 * one ticker, ask Claude (with the web_search tool) to look up its next earnings date and recent
 * history directly.
 *
 * Also holds `lookupEarningsResult` — the structured post-report results lookup used by the
 * earnings poll for ALL tickers (Finnhub's calendar entry carries only the pre-report estimate).
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

/** Structured post-report results for the earnings poll — revenue, EPS, guidance, highlights, YoY. */
export interface EarningsResultLookup {
  revenue: number | null;
  revenueEstimate: number | null;
  revenueYoyPct: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsYoyPct: number | null;
  guidanceText: string;
  highlightsText: string;
  beat: number | null;
  /** Fiscal period label as the company reports it, e.g. "Q2 FY2027" or "H1 2026". "" if unknown. */
  period: string;
}

const RESULT_SYSTEM_PROMPT = `You research a company's quarterly earnings using web search.
You are given a company and an APPROXIMATE date. Find that company's most recent quarterly earnings report announced within roughly 6 weeks of that date (the date may be the fiscal quarter-end rather than the announcement day). Report the figures from that specific quarter's release.
Respond with ONLY JSON, no prose:
{"period": string, "revenue": number|null, "revenueEstimate": number|null, "revenueYoyPct": number|null,
 "eps": number|null, "epsEstimate": number|null, "epsYoyPct": number|null,
 "guidanceText": string, "highlightsText": string, "beat": 1|0|null}
- period: the fiscal period the company reported, using its own labels (e.g. "Q2 FY2027" for NVIDIA, "H1 2026" for a half-year filer). "" if unclear.
- revenue / revenueEstimate: in USD, absolute dollars (e.g. 96200000000), converted if reported in another currency. null if not found.
- revenueYoyPct / epsYoyPct: percent change vs the same quarter one year earlier (e.g. 106 for +106%). null if not found.
- eps / epsEstimate: diluted EPS in USD. null if not found.
- guidanceText: one sentence on next-period or full-year guidance vs consensus; "" if none given.
- highlightsText: one sentence on margins or segment detail worth noting; "" if nothing notable.
- beat: 1 if the company beat consensus on its headline metric, 0 if it missed, null if unclear or nothing reported yet.
If no results have been published on or after that date yet, return all numeric fields null, beat null, and say so in guidanceText.`;

export async function lookupEarningsResult(
  apiKey: string,
  ticker: string,
  companyName: string,
  date: string,
): Promise<EarningsResultLookup | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 1500,
      system: RESULT_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Company: ${companyName} (${ticker}). Approximate report date: ${date}.` },
      ],
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
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Partial<EarningsResultLookup>;
    return {
      revenue: p.revenue ?? null,
      revenueEstimate: p.revenueEstimate ?? null,
      revenueYoyPct: p.revenueYoyPct ?? null,
      eps: p.eps ?? null,
      epsEstimate: p.epsEstimate ?? null,
      epsYoyPct: p.epsYoyPct ?? null,
      guidanceText: typeof p.guidanceText === "string" ? p.guidanceText : "",
      highlightsText: typeof p.highlightsText === "string" ? p.highlightsText : "",
      beat: p.beat === 1 || p.beat === 0 ? p.beat : null,
      period: typeof p.period === "string" ? p.period : "",
    };
  } catch {
    return null;
  }
}
