import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, RankedArticle } from "../api/types";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

export default function Article() {
  const { id } = useParams();
  const [article, setArticle] = useState<RankedArticle | null>(null);

  useEffect(() => {
    api.get<NewsDoc>("/api/news").then((doc) => {
      setArticle(doc.articles.find((a) => a.id === id) ?? null);
    });
  }, [id]);

  if (!article) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const isPositive = article.sentiment >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>{article.ticker}</span>
        <span
          className={`num ${isPositive ? "positive" : "negative"}`}
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--bg-elevated-2)",
          }}
        >
          {isPositive ? "+" : ""}{article.sentiment.toFixed(2)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {new Date(article.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {article.source}
        </span>
      </div>

      <h1 style={{ fontSize: 22, lineHeight: 1.3 }}>{article.title}</h1>

      {article.reason && (
        <Card elevated>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{article.reason}</p>
        </Card>
      )}

      <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-primary)" }}>{article.description}</p>

      {/* Same-window navigation, not a new tab — stays inside the installed PWA's own window. */}
      <a href={article.url}>
        <Button variant="secondary">Read full article ↗</Button>
      </a>
    </div>
  );
}
