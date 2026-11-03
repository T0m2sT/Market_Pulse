import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ReturnsDoc, PositionReturn } from "../api/types";
import { Hero } from "../components/Hero";
import { Card, Freshness, PnL, Row, FilterMenu } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { eur } from "../format";

type ViewMode = "sector" | "name" | "return" | "weight";

const VIEW_LABELS: Record<ViewMode, string> = {
  sector: "Sector",
  name: "Name",
  return: "Return",
  weight: "Weight",
};

/** Trim trailing zeros from a fractional share count: 0.172579 -> "0.1726", 3 -> "3". */
function shares(q: number): string {
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(4).replace(/\.?0+$/, "");
}

function PositionRow({ p, totalValue, last }: { p: PositionReturn; totalValue: number; last: boolean }) {
  const value = p.currentPrice * p.quantity;
  const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
  return (
    <Row
      last={last}
      leading={<TickerAvatar ticker={p.ticker} logo={p.logo} />}
      label={p.name}
      sublabel={
        <>
          <span style={{ display: "block" }}>
            {p.isManual ? "Manual" : (p.displayTicker ?? p.ticker)}
            <span style={{ color: "var(--text-tertiary)" }}> · {weight.toFixed(1)}%</span>
          </span>
          <span className="num" style={{ display: "block", color: "var(--text-tertiary)" }}>
            {shares(p.quantity)} sh @ {eur(p.currentPrice)}
          </span>
        </>
      }
      trailing={
        <div>
          <p className="num" style={{ fontSize: 13, color: "var(--text-secondary)" }}>{eur(value)}</p>
          <PnL value={p.pnl} percent={p.pnlPercent} />
        </div>
      }
    />
  );
}

export default function Returns() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ReturnsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("sector");

  const load = () =>
    api
      .get<ReturnsDoc>("/api/returns")
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));

  useEffect(() => {
    load();
    // Backend snapshot refreshes every minute during market hours (server-side cron) - poll
    // the cached GET here to pick that up, rather than triggering our own /refresh (real T212 call).
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const allPositions = doc.sectors.flatMap((s) => s.positions);
  const sectors = [...doc.sectors].sort((a, b) => b.value - a.value);

  const valueOf = (p: PositionReturn) => p.currentPrice * p.quantity;
  const byValue = (a: PositionReturn, b: PositionReturn) => valueOf(b) - valueOf(a);

  // One card per group; the active filter decides the groups.
  let buckets: { title: string; positions: PositionReturn[] }[] = [];
  if (mode === "sector") {
    buckets = sectors.map((s) => ({ title: s.sector, positions: [...s.positions].sort(byValue) }));
  } else if (mode === "name") {
    const byLetter = new Map<string, PositionReturn[]>();
    for (const p of [...allPositions].sort((a, b) => a.name.localeCompare(b.name))) {
      const k = p.name.charAt(0).toUpperCase();
      byLetter.set(k, [...(byLetter.get(k) ?? []), p]);
    }
    buckets = [...byLetter].map(([title, positions]) => ({ title, positions }));
  } else if (mode === "return") {
    const sorted = [...allPositions].sort((a, b) => b.pnlPercent - a.pnlPercent);
    buckets = [
      { title: "Gainers", positions: sorted.filter((p) => p.pnl >= 0) },
      { title: "Losers", positions: sorted.filter((p) => p.pnl < 0) },
    ];
  } else {
    const sorted = [...allPositions].sort(byValue);
    const share = (p: PositionReturn) => (doc.totalValue > 0 ? valueOf(p) / doc.totalValue : 0);
    buckets = [
      { title: "Over 10% of portfolio", positions: sorted.filter((p) => share(p) >= 0.1) },
      { title: "5% to 10%", positions: sorted.filter((p) => share(p) >= 0.05 && share(p) < 0.1) },
      { title: "Under 5%", positions: sorted.filter((p) => share(p) < 0.05) },
    ];
  }
  const groups = buckets
    .filter((g) => g.positions.length > 0)
    .map((g) => {
      const value = g.positions.reduce((s, p) => s + valueOf(p), 0);
      const pnl = g.positions.reduce((s, p) => s + p.pnl, 0);
      const cost = value - pnl;
      return { ...g, value, pnl, percent: cost > 0 ? pnl / cost : 0 };
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h1>Returns</h1>
        <FilterMenu mode={mode} onChange={setMode} labels={VIEW_LABELS} />
      </div>
      <Freshness updatedAt={doc.updatedAt} />

      <Hero label="Total value" value={doc.totalValue} pnl={doc.totalPnl} percent={doc.totalPnlPercent} />

      {groups.map((g) => (
        <Hero key={g.title} compact label={g.title} value={g.value} pnl={g.pnl} percent={g.percent}>
          {g.positions.map((p, i) => (
            <PositionRow key={p.ticker} p={p} totalValue={doc.totalValue} last={i === g.positions.length - 1} />
          ))}
        </Hero>
      ))}

      <button
        onClick={() => navigate("/holdings")}
        style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
      >
        <Card elevated>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ marginBottom: "var(--space-1)" }}>Holdings</h3>
              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Manage positions & sectors</p>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>→</span>
          </div>
        </Card>
      </button>
    </div>
  );
}
