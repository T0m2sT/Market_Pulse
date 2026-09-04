import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ReturnsDoc, PositionReturn } from "../api/types";
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

function PositionRow({ p, totalValue }: { p: PositionReturn; totalValue: number }) {
  const value = p.currentPrice * p.quantity;
  const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
  return (
    <Row
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
    // Backend snapshot refreshes every minute during market hours (server-side cron) — poll
    // the cached GET here to pick that up, rather than triggering our own /refresh (real T212 call).
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const allPositions = doc.sectors.flatMap((s) => s.positions);
  const sectors = [...doc.sectors].sort((a, b) => b.value - a.value);

  let flatSorted: PositionReturn[] = [];
  if (mode === "name") {
    flatSorted = [...allPositions].sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === "return") {
    flatSorted = [...allPositions].sort((a, b) => b.pnlPercent - a.pnlPercent);
  } else if (mode === "weight") {
    flatSorted = [...allPositions].sort(
      (a, b) => b.currentPrice * b.quantity - a.currentPrice * a.quantity,
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h1>Returns</h1>
        <FilterMenu mode={mode} onChange={setMode} labels={VIEW_LABELS} />
      </div>
      <Freshness updatedAt={doc.updatedAt} />

      <Card elevated>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>
          Total value
        </p>
        <p className="num" style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {eur(doc.totalValue)}
        </p>
        <PnL value={doc.totalPnl} percent={doc.totalPnlPercent} />
      </Card>

      {mode === "sector"
        ? sectors.map((s) => {
            const allocation = doc.totalValue > 0 ? (s.value / doc.totalValue) * 100 : 0;
            return (
              <div key={s.sector}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-2)" }}>
                  <h3>
                    {s.sector} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-tertiary)" }}>{allocation.toFixed(1)}%</span>
                  </h3>
                  <div style={{ textAlign: "right" }}>
                    <p className="num" style={{ color: "var(--text-secondary)", fontSize: 14 }}>{eur(s.value)}</p>
                    <PnL value={s.pnl} percent={s.pnlPercent} />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {s.positions.map((p) => (
                    <PositionRow key={p.ticker} p={p} totalValue={doc.totalValue} />
                  ))}
                </div>
              </div>
            );
          })
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {flatSorted.map((p) => (
              <PositionRow key={p.ticker} p={p} totalValue={doc.totalValue} />
            ))}
          </div>
        )}

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
