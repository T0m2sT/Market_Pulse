import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, HoldingsDoc } from "../api/types";
import { Card, Freshness, FilterMenu } from "../components/Card";
import { carriedLabel } from "../format";
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
  const [seenMode, setSeenMode] = useState<"off" | "seen" | "unseen">("off");
  const [sentimentMode, setSentimentMode] = useState<"off" | "positive" | "negative">("off");
  const isAll = seenMode === "off" && sentimentMode === "off";
  const [sort, setSort] = useState<SortMode>("movers");
  const [weekIndex, setWeekIndex] = useState(0); // 0 = newest week

  useEffect(() => {
    api
      .get<NewsDoc>("/api/news")
      .then(setDoc)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));

  // Every week that has any briefing row at all, newest first.
  const weeks = useMemo(() => {
    if (!doc) return [];
    return [...new Set(doc.briefings.map((b) => b.weekStart))].sort((a, z) => z.localeCompare(a));
  }, [doc]);
  const activeWeek = weeks[weekIndex];

  const filtered = useMemo(() => {
    if (!doc || activeWeek === undefined) return [];
    const weightOf = (t: string) => holdingByTicker.get(t)?.weight ?? 0;
    const rows = doc.briefings.filter((b) => {
      if (b.weekStart !== activeWeek) return false;
      if (b.articleCount === 0 && !isAll) return false; // quiet rows have no sentiment/seen state to filter on
      if (tickerFilter && !b.ticker.toLowerCase().includes(tickerFilter.toLowerCase())) return false;
      if (sentimentMode === "positive" && b.sentiment < 0) return false;
      if (sentimentMode === "negative" && b.sentiment >= 0) return false;
      if (seenMode === "unseen" && b.seen) return false;
      if (seenMode === "seen" && !b.seen) return false;
      return true;
    });
    return rows.sort((a, z) => {
      // Fresh briefings first, then copies carried from earlier weeks, then quiet rows.
      const tier = (b: typeof a) => (b.articleCount === 0 ? 2 : b.carriedFrom ? 1 : 0);
      if (tier(a) !== tier(z)) return tier(a) - tier(z);
      if (tier(a) === 2) return a.ticker.localeCompare(z.ticker);
      if (sort === "ticker") return a.ticker.localeCompare(z.ticker);
      if (sort === "weight") return weightOf(z.ticker) - weightOf(a.ticker);
      return Math.abs(z.sentiment) - Math.abs(a.sentiment);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, holdings, activeWeek, tickerFilter, seenMode, sentimentMode, isAll, sort]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

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
        <Button
          onClick={() => {
            setSeenMode("off");
            setSentimentMode("off");
          }}
          style={{
            flex: 1,
            padding: "var(--space-2)",
            background: isAll ? "var(--accent-dim)" : "var(--bg-elevated-1)",
            textTransform: "capitalize",
            fontWeight: 400,
          }}
        >
          All
        </Button>
        <Button
          onClick={() => setSeenMode((m) => (m === "unseen" ? "seen" : "unseen"))}
          style={{
            flex: 1,
            padding: "var(--space-2)",
            background: seenMode !== "off" ? "var(--accent-dim)" : "var(--bg-elevated-1)",
            textTransform: "capitalize",
            fontWeight: 400,
          }}
        >
          {seenMode === "seen" ? "Seen" : "Unseen"}
        </Button>
        <Button
          onClick={() => setSentimentMode((m) => (m === "positive" ? "negative" : "positive"))}
          style={{
            flex: 1,
            padding: "var(--space-2)",
            background: sentimentMode !== "off" ? "var(--accent-dim)" : "var(--bg-elevated-1)",
            textTransform: "capitalize",
            fontWeight: 400,
          }}
        >
          {sentimentMode === "negative" ? "Negative" : "Positive"}
        </Button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setWeekIndex((i) => Math.min(i + 1, weeks.length - 1))}
          disabled={weekIndex >= weeks.length - 1}
          aria-label="Previous week"
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            background: "none",
            border: "none",
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
            cursor: weekIndex >= weeks.length - 1 ? "default" : "pointer",
            color: weekIndex >= weeks.length - 1 ? "var(--text-tertiary)" : "var(--text-primary)",
            opacity: weekIndex >= weeks.length - 1 ? 0.35 : 1,
          }}
        >
          &lt;
        </button>
        <h3 style={{ margin: 0, color: "var(--text-secondary)" }}>
          {activeWeek
            ? `Week of ${new Date(activeWeek + "T00:00:00").toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
              })}`
            : ""}
        </h3>
        <button
          onClick={() => setWeekIndex((i) => Math.max(i - 1, 0))}
          disabled={weekIndex <= 0}
          aria-label="Next week"
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            background: "none",
            border: "none",
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
            cursor: weekIndex <= 0 ? "default" : "pointer",
            color: weekIndex <= 0 ? "var(--text-tertiary)" : "var(--text-primary)",
            opacity: weekIndex <= 0 ? 0.35 : 1,
          }}
        >
          &gt;
        </button>
      </div>

      {filtered.length === 0 && <p style={{ color: "var(--text-tertiary)" }}>No briefings match.</p>}

      {filtered.map((b) => {
        if (b.articleCount === 0) {
          return (
            <div
              key={`${b.ticker}:${b.weekStart}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-2) var(--space-3)",
              }}
            >
              <TickerAvatar ticker={b.ticker} logo={holdingByTicker.get(b.ticker)?.logo} size={18} />
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-secondary)" }}>{b.ticker}</span>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: "auto" }}>No update</span>
            </div>
          );
        }
        const isPositive = b.sentiment >= 0;
        return (
          <Card key={`${b.ticker}:${b.weekStart}`}>
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
                {b.carriedFrom && (
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {carriedLabel(b.carriedFrom, b.weekStart)}
                  </span>
                )}
                {!b.seen && (
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
        );
      })}
    </div>
  );
}
