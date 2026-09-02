import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, Briefing as BriefingType } from "../api/types";

export default function Briefing() {
  const { ticker, weekStart } = useParams();
  const [briefing, setBriefing] = useState<BriefingType | null>(null);

  useEffect(() => {
    api.get<NewsDoc>("/api/news").then((doc) => {
      const b = doc.briefings.find((x) => x.ticker === ticker && x.weekStart === weekStart) ?? null;
      setBriefing(b);
      if (b && !b.seen) {
        api.patch("/api/news/seen", { ticker, weekStart }).catch(() => {});
      }
    });
  }, [ticker, weekStart]);

  if (!briefing) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const isPositive = briefing.sentiment >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>{briefing.ticker}</span>
        <span
          className={`num ${isPositive ? "positive" : "negative"}`}
          style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "var(--bg-elevated-2)" }}
        >
          {isPositive ? "+" : ""}
          {briefing.sentiment.toFixed(2)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          Week of{" "}
          {new Date(briefing.weekStart + "T00:00:00").toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}
          {" · "}
          {briefing.articleCount} {briefing.articleCount === 1 ? "article" : "articles"}
        </span>
      </div>

      <h1 style={{ fontSize: 20, lineHeight: 1.35 }}>{briefing.summary}</h1>

      {briefing.body
        .split(/\n+/)
        .filter(Boolean)
        .map((para, i) => (
          <p key={i} style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-primary)" }}>
            {para}
          </p>
        ))}
    </div>
  );
}
