import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { DividendsDoc } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { eur } from "../format";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export default function Dividends() {
  const [doc, setDoc] = useState<DividendsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DividendsDoc>("/api/dividends")
      .then(setDoc)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const d = doc?.dividends ?? [];
    return [
      ...d.map((x) => ({ date: x.exDate, kind: "dividend-ex" as const, ticker: x.ticker })),
      ...d.map((x) => ({ date: x.paymentDate, kind: "dividend-pay" as const, ticker: x.ticker })),
    ];
  }, [doc]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const now = Date.now();
  const next90Total = doc.dividends
    .filter((d) => {
      const pay = new Date(d.paymentDate + "T00:00:00").getTime();
      return pay >= now && pay <= now + NINETY_DAYS_MS;
    })
    .reduce((sum, d) => sum + d.amountEur, 0);

  const touching = selectedDate
    ? doc.dividends.filter((d) => d.exDate === selectedDate || d.paymentDate === selectedDate)
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
          {eur(next90Total)}
        </p>
      </Card>

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {selectedDate && touching.length > 0 && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}
          onClose={() => setSelectedDate(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {touching.map((d) => {
              const isExDate = d.exDate === selectedDate;
              const isPayDate = d.paymentDate === selectedDate;
              return (
                <div key={`${d.ticker}:${d.exDate}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <TickerAvatar ticker={d.ticker} logo={d.logo} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 15,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {d.name}
                      </p>
                      <p className="num" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        {isExDate ? "Ex-dividend" : "Payment"}
                        {d.yieldPct !== null && <> · {d.yieldPct.toFixed(2)}% yield</>}
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginTop: "var(--space-3)",
                    }}
                  >
                    <span className="num" style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                      {eur(d.perShareEur)}/share × {d.qualifyingShares.toFixed(4)}
                    </span>
                    <span
                      className={`num ${isPayDate ? "glow-positive" : ""}`}
                      style={isPayDate ? { fontWeight: 600 } : { fontWeight: 600, color: "var(--text-primary)" }}
                    >
                      {eur(d.amountEur)}
                    </span>
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
