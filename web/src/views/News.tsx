import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, HoldingsDoc } from "../api/types";
import { Freshness, FilterMenu } from "../components/Card";
import { Input } from "../components/Input";
import { TickerAvatar } from "../components/TickerAvatar";
import { BriefingTile } from "../components/BriefingTile";

type SeenFilter = "seen" | "unseen";
type SentimentFilter = "positive" | "negative";

/** Two options, either can be on or both off: tapping the selected one switches it off again. */
function Toggle<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T | null;
  onChange: (v: T | null) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: "var(--bg-elevated-1)",
        border: "1px solid var(--hairline)",
      }}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            aria-pressed={active}
            onClick={() => onChange(active ? null : o.id)}
            style={{
              padding: "9px 0",
              borderRadius: 999,
              border: "none",
              background: active ? "var(--accent-fill)" : "transparent",
              color: active ? "var(--on-accent)" : "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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
  const [seenFilter, setSeenFilter] = useState<SeenFilter | null>(null);
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter | null>(null);
  const isAll = seenFilter === null && sentimentFilter === null;
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
      if (sentimentFilter === "positive" && b.sentiment < 0) return false;
      if (sentimentFilter === "negative" && b.sentiment >= 0) return false;
      if (seenFilter === "unseen" && b.seen) return false;
      if (seenFilter === "seen" && !b.seen) return false;
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
  }, [doc, holdings, activeWeek, tickerFilter, seenFilter, sentimentFilter, isAll, sort]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const fresh = filtered.filter((b) => b.articleCount > 0);
  const quiet = filtered.filter((b) => b.articleCount === 0);
  const weekLabel = activeWeek
    ? new Date(activeWeek + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
  const atOldest = weekIndex >= weeks.length - 1;
  const atNewest = weekIndex <= 0;
  const arrow = (disabled: boolean): React.CSSProperties => ({
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: "1px solid var(--hairline)",
    background: "var(--bg-elevated-1)",
    color: "var(--text-primary)",
    fontSize: 18,
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? "default" : "pointer",
  });
  const open = (b: (typeof fresh)[number]) => navigate(`/briefing/${b.ticker}/${b.weekStart}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h1>News</h1>
        <FilterMenu mode={sort} onChange={setSort} labels={SORT_LABELS} />
      </div>

      {/* Week switcher: the date is the headline, arrows step through weeks */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <button
          onClick={() => setWeekIndex((i) => Math.min(i + 1, weeks.length - 1))}
          disabled={atOldest}
          aria-label="Previous week"
          style={arrow(atOldest)}
        >
          ‹
        </button>
        <div style={{ textAlign: "center" }}>
          <p className="display" style={{ fontSize: 30 }}>
            {weekLabel ? `Week of ${weekLabel}` : "No weeks yet"}
          </p>
          <Freshness updatedAt={doc.updatedAt} />
        </div>
        <button
          onClick={() => setWeekIndex((i) => Math.max(i - 1, 0))}
          disabled={atNewest}
          aria-label="Next week"
          style={arrow(atNewest)}
        >
          ›
        </button>
      </div>

      <Input
        value={tickerFilter}
        onChange={(e) => setTickerFilter(e.target.value)}
        placeholder="Search a ticker"
        aria-label="Filter by ticker"
        style={{ borderRadius: 999, padding: "var(--space-3) var(--space-4)" }}
      />

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Toggle
          label="Seen state"
          value={seenFilter}
          onChange={setSeenFilter}
          options={[
            { id: "seen", label: "Seen" },
            { id: "unseen", label: "Unseen" },
          ]}
        />
        <Toggle
          label="Sentiment"
          value={sentimentFilter}
          onChange={setSentimentFilter}
          options={[
            { id: "positive", label: "Positive" },
            { id: "negative", label: "Negative" },
          ]}
        />
      </div>

      {filtered.length === 0 && <p style={{ color: "var(--text-tertiary)" }}>No briefings match.</p>}

      {/* Every briefing gets the same full-width tile; two columns once the screen is wide enough */}
      {fresh.length > 0 && (
        <div className="tile-grid">
          {fresh.map((b) => (
            <BriefingTile
              key={`${b.ticker}:${b.weekStart}`}
              b={b}
              logo={holdingByTicker.get(b.ticker)?.logo}
              onOpen={() => open(b)}
            />
          ))}
        </div>
      )}

      {/* Quiet tickers collapse into one line instead of a row each */}
      {quiet.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>
            No update this week
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {quiet.map((b) => (
              <span
                key={`${b.ticker}:${b.weekStart}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px 4px 4px",
                  borderRadius: 999,
                  border: "1px solid var(--hairline)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-tertiary)",
                }}
              >
                <TickerAvatar ticker={b.ticker} logo={holdingByTicker.get(b.ticker)?.logo} size={18} />
                {b.ticker}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
