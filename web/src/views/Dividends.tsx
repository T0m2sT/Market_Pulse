import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { DividendsDoc } from "../api/types";
import { Card, Freshness, Row } from "../components/Card";
import { Hero } from "../components/Hero";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { eur } from "../format";

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

  const next90Total = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 90);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const todayKey = new Date().toISOString().slice(0, 10);
    return (doc?.dividends ?? [])
      .filter((d) => d.paymentDate >= todayKey && d.paymentDate <= cutoffKey)
      .reduce((sum, d) => sum + d.amountEur, 0);
  }, [doc]);

  const upcoming = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return (doc?.dividends ?? [])
      .filter((x) => x.paymentDate >= todayKey)
      .sort((a, z) => a.paymentDate.localeCompare(z.paymentDate))
      .slice(0, 8);
  }, [doc]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const touching = selectedDate
    ? doc.dividends.filter((d) => d.exDate === selectedDate || d.paymentDate === selectedDate)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Dividends</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Hero label="Estimated total, next 90 days" value={next90Total} />

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {upcoming.length > 0 && (
        <>
          <h2 className="display" style={{ fontSize: 28, marginTop: "var(--space-3)" }}>
            Next payments
          </h2>
          <Card>
            {upcoming.map((x, i) => (
              <Row
                key={`${x.ticker}:${x.paymentDate}`}
                last={i === upcoming.length - 1}
                leading={<TickerAvatar ticker={x.ticker} logo={x.logo} />}
                label={x.name}
                sublabel={
                  <span className="num">
                    Pays{" "}
                    {new Date(x.paymentDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {x.yieldPct !== null && ` · ${x.yieldPct.toFixed(2)}% yield`}
                  </span>
                }
                trailing={
                  <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>
                    {eur(x.amountEur)}
                  </span>
                }
              />
            ))}
          </Card>
        </>
      )}

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
