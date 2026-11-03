import type { Briefing } from "../api/types";
import { carriedLabel } from "../format";
import { TickerAvatar } from "./TickerAvatar";

/**
 * One briefing as a compact full-width tile: ticker on the left, signed score on the right, two lines of
 * summary underneath. The tint carries the sentiment, so a stack of tiles reads as a heat map at a glance.
 */
export function BriefingTile({ b, logo, onOpen }: { b: Briefing; logo?: string; onOpen: () => void }) {
  const up = b.sentiment >= 0;
  const tint = up ? "var(--positive)" : "var(--negative)";
  const strength = 8 + Math.min(1, Math.abs(b.sentiment)) * 20;
  return (
    <button
      onClick={onOpen}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        width: "100%",
        textAlign: "left",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--hairline)",
        background: `linear-gradient(120deg, color-mix(in srgb, ${tint} ${strength}%, transparent), transparent 65%), var(--card-bg)`,
        color: "var(--text-primary)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <TickerAvatar ticker={b.ticker} logo={logo} size={24} />
        <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
          {b.ticker}
        </span>
        {!b.seen && (
          <span
            aria-label="Unseen"
            style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent-fill)" }}
          />
        )}
        <span className={`display num ${up ? "positive" : "negative"}`} style={{ marginLeft: "auto", fontSize: 26 }}>
          {up ? "+" : ""}
          {b.sentiment.toFixed(2)}
        </span>
      </span>
      <span
        style={{
          fontSize: 14,
          lineHeight: 1.4,
          color: "var(--text-secondary)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {b.summary}
      </span>
      {b.carriedFrom && (
        <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
          {carriedLabel(b.carriedFrom, b.weekStart)}
        </span>
      )}
    </button>
  );
}
