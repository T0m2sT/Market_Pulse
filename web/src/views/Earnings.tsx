import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { EarningsDoc, HoldingsDoc } from "../api/types";
import { Card, Freshness, FilterMenu } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { usd, abbreviateUsd, fiscalQuarterLabel } from "../format";

type SortMode = "name" | "weight";

const SORT_LABELS: Record<SortMode, string> = {
  name: "Name",
  weight: "Weight",
};

export default function Earnings() {
  const [doc, setDoc] = useState<EarningsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("name");

  useEffect(() => {
    api
      .get<EarningsDoc>("/api/earnings")
      .then(setDoc)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const calendarEvents: CalendarEvent[] = useMemo(
    () => (doc?.upcoming ?? []).map((e) => ({ date: e.date, kind: "earnings" as const, ticker: e.ticker })),
    [doc],
  );

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));
  const shownEarnings = selectedDate ? doc.upcoming.filter((e) => e.date === selectedDate) : [];

  const tickersWithResults = Object.entries(doc.results)
    .filter(([, results]) => results.length > 0)
    .sort(([tickerA], [tickerB]) => {
      const a = holdingByTicker.get(tickerA);
      const b = holdingByTicker.get(tickerB);
      if (sort === "weight") return (b?.weight ?? 0) - (a?.weight ?? 0);
      return (a?.name ?? tickerA).localeCompare(b?.name ?? tickerB);
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Earnings</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {selectedDate && shownEarnings.length > 0 && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          onClose={() => setSelectedDate(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {shownEarnings.map((e) => {
              const weight = holdingByTicker.get(e.ticker)?.weight;
              return (
                <div key={e.ticker}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <TickerAvatar ticker={e.ticker} logo={e.logo} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.name}
                      </p>
                      <p
                        className="num"
                        style={{ fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {weight !== undefined && <>{(weight * 100).toFixed(1)}% · </>}
                        {e.quarter > 0 ? `Q${e.quarter} ${e.year}` : e.year}
                        {e.isEstimate && " (est.)"}
                      </p>
                    </div>
                  </div>
                  {(e.epsEstimate !== null || e.revenueEstimate !== null) && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-around",
                        marginTop: "var(--space-3)",
                        paddingTop: "var(--space-3)",
                        borderTop: "1px solid var(--hairline)",
                      }}
                    >
                      {e.epsEstimate !== null && (
                        <div style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>EPS est.</p>
                          <p className="num" style={{ fontSize: 14 }}>{usd(e.epsEstimate)}</p>
                        </div>
                      )}
                      {e.revenueEstimate !== null && (
                        <div style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Revenue est.</p>
                          <p className="num" style={{ fontSize: 14 }}>{abbreviateUsd(e.revenueEstimate)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Past results</h3>
        <FilterMenu mode={sort} onChange={setSort} labels={SORT_LABELS} />
      </div>
      {tickersWithResults.length === 0 && (
        <p style={{ color: "var(--text-tertiary)" }}>No historical results yet.</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "var(--space-3)" }}>
      {tickersWithResults.map(([ticker, results]) => {
        const h = holdingByTicker.get(ticker);
        return (
          <Card key={ticker}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <TickerAvatar ticker={ticker} logo={h?.logo} size={28} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h?.name ?? ticker}
                </p>
                <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{h?.displayTicker ?? ticker}</p>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {results.slice(0, 4).map((r) => {
                const beat = r.surprisePercent !== null && r.surprisePercent >= 0;
                const hasFinancials = r.actual !== null || r.estimate !== null;
                return (
                  <div
                    key={r.period}
                    style={{
                      padding: "var(--space-2) 0",
                      borderTop: "1px solid var(--hairline)",
                    }}
                  >
                    <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>{fiscalQuarterLabel(r.period)}</p>
                    {hasFinancials ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 2 }}>
                        <div>
                          <p className="num" style={{ fontSize: 14 }}>
                            {r.actual !== null ? usd(r.actual) : "—"}
                          </p>
                          <p className="num" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                            est. {r.estimate !== null ? usd(r.estimate) : "—"}
                          </p>
                        </div>
                        {r.surprisePercent !== null && (
                          <span
                            className={`num ${beat ? "positive" : "negative"}`}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "3px 7px",
                              borderRadius: 999,
                              background: "var(--bg-elevated-1)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {beat ? "▲" : "▼"} {Math.abs(r.surprisePercent).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="num" style={{ fontSize: 14, marginTop: 2 }}>Reported</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      </div>
    </div>
  );
}
