import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, HoldingsDoc } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { TickerAvatar } from "../components/TickerAvatar";

export default function News() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<NewsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "positive" | "negative">("all");

  useEffect(() => {
    api
      .get<NewsDoc>("/api/news")
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));

  const filtered = useMemo(() => {
    if (!doc) return [];
    return doc.articles.filter((a) => {
      if (tickerFilter && !a.ticker.toLowerCase().includes(tickerFilter.toLowerCase())) return false;
      if (sentimentFilter === "positive" && a.sentiment < 0) return false;
      if (sentimentFilter === "negative" && a.sentiment >= 0) return false;
      return true;
    });
  }, [doc, tickerFilter, sentimentFilter]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>News</h1>
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

      {filtered.length === 0 && (
        <p style={{ color: "var(--text-tertiary)" }}>No articles match.</p>
      )}

      {filtered.map((a) => {
        const isPositive = a.sentiment >= 0;
        return (
          <Card key={a.id}>
            <button
              onClick={() => navigate(`/article/${a.id}`)}
              style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                <TickerAvatar ticker={a.ticker} logo={holdingByTicker.get(a.ticker)?.logo} size={24} />
                <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>{a.ticker}</span>
                <span
                  className={`num ${isPositive ? "positive" : "negative"}`}
                  style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "var(--bg-elevated-2)" }}
                >
                  {isPositive ? "+" : ""}{a.sentiment.toFixed(2)}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: "auto" }}>
                  {new Date(a.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: "var(--space-1)" }}>{a.title}</p>
              {a.description && (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {a.description}
                </p>
              )}
            </button>
          </Card>
        );
      })}
    </div>
  );
}
