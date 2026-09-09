import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, HoldingsDoc } from "../api/types";
import { Card, Freshness, FilterMenu } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { TickerAvatar } from "../components/TickerAvatar";

type SortMode = "movers" | "weight" | "ticker";
const SORT_LABELS: Record<SortMode, string> = {
  movers: "Movers first",
  weight: "By weight",
  ticker: "By ticker",
};

export default function News() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<NewsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "positive" | "negative">("all");
  const [seenFilter, setSeenFilter] = useState<"all" | "unseen">("all");
  const [sort, setSort] = useState<SortMode>("movers");

  useEffect(() => {
    api
      .get<NewsDoc>("/api/news")
      .then(setDoc)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));

  const filtered = useMemo(() => {
    if (!doc) return [];
    const weightOf = (t: string) => holdingByTicker.get(t)?.weight ?? 0;
    const rows = doc.briefings.filter((b) => {
      if (tickerFilter && !b.ticker.toLowerCase().includes(tickerFilter.toLowerCase())) return false;
      if (sentimentFilter === "positive" && b.sentiment < 0) return false;
      if (sentimentFilter === "negative" && b.sentiment >= 0) return false;
      if (seenFilter === "unseen" && b.seen) return false;
      return true;
    });
    // Always newest week first; sort within a week by the chosen mode.
    return rows.sort((a, z) => {
      if (a.weekStart !== z.weekStart) return z.weekStart.localeCompare(a.weekStart);
      if (sort === "ticker") return a.ticker.localeCompare(z.ticker);
      if (sort === "weight") return weightOf(z.ticker) - weightOf(a.ticker);
      // movers: real briefings by |sentiment| desc, quiet ("no news") rows sink to the bottom
      const aq = a.articleCount === 0 ? 1 : 0;
      const zq = z.articleCount === 0 ? 1 : 0;
      if (aq !== zq) return aq - zq;
      return Math.abs(z.sentiment) - Math.abs(a.sentiment);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, holdings, tickerFilter, sentimentFilter, seenFilter, sort]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  // First briefing of each week gets the "Week of …" header above it.
  const weekHeaderFor = new Set<string>();
  const seenWeeks = new Set<string>();
  for (const b of filtered) {
    if (!seenWeeks.has(b.weekStart)) {
      seenWeeks.add(b.weekStart);
      weekHeaderFor.add(`${b.ticker}:${b.weekStart}`);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h1>News</h1>
        <FilterMenu mode={sort} onChange={setSort} labels={SORT_LABELS} />
      </div>
      <Freshness updatedAt={doc.updatedAt} />

      <Input
        value={tickerFilter}
        onChange={(e) => setTickerFilter(e.target.value)}
        placeholder="Filter by ticker"
      />

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {(["all", "positive", "negative"] as const).map((s) => (
          <Button
            key={s}
            onClick={() => setSentimentFilter(s)}
            style={{
              flex: 1,
              padding: "var(--space-2)",
              background: sentimentFilter === s ? "var(--accent-dim)" : "var(--bg-elevated-1)",
              textTransform: "capitalize",
              fontWeight: 400,
            }}
          >
            {s}
          </Button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {(["all", "unseen"] as const).map((s) => (
          <Button
            key={s}
            onClick={() => setSeenFilter(s)}
            style={{
              flex: 1,
              padding: "var(--space-2)",
              background: seenFilter === s ? "var(--accent-dim)" : "var(--bg-elevated-1)",
              textTransform: "capitalize",
              fontWeight: 400,
            }}
          >
            {s}
          </Button>
        ))}
      </div>

      {filtered.length === 0 && <p style={{ color: "var(--text-tertiary)" }}>No briefings match.</p>}

      {filtered.map((b) => {
        const isPositive = b.sentiment >= 0;
        const isQuiet = b.articleCount === 0;
        const showWeekHeader = weekHeaderFor.has(`${b.ticker}:${b.weekStart}`);
        return (
          <div key={`${b.ticker}:${b.weekStart}`}>
            {showWeekHeader && (
              <h3 style={{ margin: "var(--space-2) 0", color: "var(--text-secondary)" }}>
                Week of{" "}
                {new Date(b.weekStart + "T00:00:00").toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                })}
              </h3>
            )}
            <Card>
              <button
                onClick={() => navigate(`/briefing/${b.ticker}/${b.weekStart}`)}
                style={{
                  display: "block",
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  opacity: isQuiet ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    marginBottom: "var(--space-2)",
                  }}
                >
                  <TickerAvatar ticker={b.ticker} logo={holdingByTicker.get(b.ticker)?.logo} size={24} />
                  <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>{b.ticker}</span>
                  {isQuiet ? (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "var(--bg-elevated-2)",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      no news
                    </span>
                  ) : (
                    <span
                      className={`num ${isPositive ? "positive" : "negative"}`}
                      style={{
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "var(--bg-elevated-2)",
                      }}
                    >
                      {isPositive ? "+" : ""}
                      {b.sentiment.toFixed(2)}
                    </span>
                  )}
                  {!b.seen && !isQuiet && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: "var(--accent)",
                        marginLeft: "auto",
                      }}
                    />
                  )}
                </div>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{b.summary}</p>
              </button>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
