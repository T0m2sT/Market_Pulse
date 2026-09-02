import { useEffect, useState } from "react";
import { api } from "../api/client";
import { SECTORS, type Holding, type HoldingsDoc, type Sector } from "../api/types";
import { Freshness, Row } from "../components/Card";
import { Button } from "../components/Button";
import { TickerAvatar } from "../components/TickerAvatar";

export default function Holdings() {
  const [doc, setDoc] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sortingTicker, setSortingTicker] = useState<string | null>(null);

  function load() {
    api
      .get<HoldingsDoc>("/api/holdings")
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }

  useEffect(load, []);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const updated = await api.post<HoldingsDoc>("/api/holdings/sync");
      setDoc(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function assignSector(ticker: string, sector: Sector) {
    if (!doc) return;
    const positions = doc.positions.map((p) => (p.ticker === ticker ? { ...p, sector } : p));
    setDoc({ ...doc, positions });
    setSortingTicker(null);
    try {
      await api.put<HoldingsDoc>("/api/holdings", positions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      load(); // roll back to server state on failure
    }
  }

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const unassigned = doc.positions.filter((p) => p.sector === "Unassigned");
  const bySector = SECTORS.filter((s) => s !== "Unassigned")
    .map((sector) => ({ sector, positions: doc.positions.filter((p) => p.sector === sector) }))
    .filter((g) => g.positions.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Holdings</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Button variant="primary" onClick={sync} disabled={syncing}>
        {syncing ? "Syncing…" : "Sync from Trading 212"}
      </Button>

      {unassigned.length > 0 && (
        <div>
          <h3 style={{ marginBottom: "var(--space-2)", color: "var(--warning)" }}>
            Unassigned ({unassigned.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {unassigned.map((p) => (
              <HoldingRow key={p.ticker} holding={p} onTap={() => setSortingTicker(p.ticker)} />
            ))}
          </div>
        </div>
      )}

      {bySector.map((g) => (
        <div key={g.sector}>
          <h3 style={{ marginBottom: "var(--space-2)" }}>{g.sector}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {g.positions.map((p) => (
              <HoldingRow key={p.ticker} holding={p} onTap={() => setSortingTicker(p.ticker)} />
            ))}
          </div>
        </div>
      ))}

      {sortingTicker && (
        <SectorSheet
          ticker={sortingTicker}
          onSelect={(sector) => assignSector(sortingTicker, sector)}
          onClose={() => setSortingTicker(null)}
        />
      )}
    </div>
  );
}

function HoldingRow({ holding, onTap }: { holding: Holding; onTap: () => void }) {
  return (
    <Row
      leading={<TickerAvatar ticker={holding.ticker} logo={holding.logo} />}
      label={holding.name}
      sublabel={holding.isManual ? "Manual" : (holding.displayTicker ?? holding.ticker)}
      trailing={
        <span className="num" style={{ color: "var(--text-secondary)" }}>
          {(holding.weight * 100).toFixed(1)}%
        </span>
      }
      onTap={onTap}
    />
  );
}

function SectorSheet({
  ticker,
  onSelect,
  onClose,
}: {
  ticker: string;
  onSelect: (sector: Sector) => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 10,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "var(--bg-elevated-2)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          padding: "var(--space-5) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom))",
        }}
      >
        <h3 style={{ marginBottom: "var(--space-4)" }}>Sort {ticker} into…</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {SECTORS.filter((s) => s !== "Unassigned").map((sector) => (
            <Button
              key={sector}
              align="left"
              onClick={() => onSelect(sector)}
              style={{ background: "var(--bg-elevated-1)", fontWeight: 400 }}
            >
              {sector}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
