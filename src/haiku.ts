export interface RankInput {
  id: string;
  ticker: string;
  title: string;
  description: string;
}

export interface RankedItem {
  id: string;
  impact: number;
  reason: string;
}

const SYSTEM_PROMPT = `You rank news headlines by how much they matter to a specific stock portfolio.
For each article, assign an impact score from 0 to 1 (1 = highly market-moving for that ticker, 0 = irrelevant noise) and a one-sentence reason.
Respond with ONLY a JSON array, no prose: [{"id": "...", "impact": 0.0, "reason": "..."}]`;

export async function rankArticles(
  apiKey: string,
  articles: RankInput[],
  weights: Record<string, number>,
): Promise<RankedItem[] | null> {
  const userContent = articles
    .map(
      (a) =>
        `id: ${a.id}\nticker: ${a.ticker} (portfolio weight: ${((weights[a.ticker] ?? 0) * 100).toFixed(1)}%)\ntitle: ${a.title}\ndescription: ${a.description}`,
    )
    .join("\n---\n");

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
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    return null;
  }

  try {
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (item): item is RankedItem =>
        typeof item.id === "string" && typeof item.impact === "number" && typeof item.reason === "string",
    );
  } catch {
    return null;
  }
}
