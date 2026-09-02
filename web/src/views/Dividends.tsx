import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { DividendsDoc, HoldingsDoc } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { eur } from "../format";

export default function Dividends() {
  const [doc, setDoc] = useState<DividendsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DividendsDoc>("/api/dividends")
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const upcoming = doc?.upcoming ?? [];
    const exEvents = upcoming.map((d) => ({ date: d.exDate, kind: "dividend-ex" as const, ticker: d.ticker }));
    const payEvents = upcoming.map((d) => ({ date: d.paymentDate, kind: "dividend-pay" as const, ticker: d.ticker }));
    return [...exEvents, ...payEvents];
  }, [doc]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const total = doc.upcoming.reduce((sum, d) => sum + d.estimatedPayment, 0);
  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));
  const shownDividends = selectedDate
    ? doc.upcoming.filter((d) => d.exDate === selectedDate || d.paymentDate === selectedDate)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Dividends</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Card elevated>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>
          Estimated total, next 90 days
        </p>
        <p className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {eur(total)}
        </p>
      </Card>

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {selectedDate && shownDividends.length > 0 && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          onClose={() => setSelectedDate(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {shownDividends.map((d) => {
              const weight = holdingByTicker.get(d.ticker)?.weight;
              return (
                <div key={`${d.ticker}:${d.exDate}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <TickerAvatar ticker={d.ticker} logo={d.logo} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name}
                      </p>
                      <p
                        className="num"
                        style={{ fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {weight !== undefined && <>{(weight * 100).toFixed(1)}% · </>}
                        {d.locked ? "Locked in" : "Tracking"}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-3)" }}>
                    <span className="num" style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                      {eur(d.perShare)}/share × {d.qualifyingShares.toFixed(4)}
                    </span>
                    <span className="num positive" style={{ fontWeight: 600 }}>{eur(d.estimatedPayment)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
