import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { EarningsDoc, HoldingsDoc, EarningsResult, CalendarRowEntry } from "../api/types";
import { Card, Freshness, FilterMenu } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { usd, abbreviateUsd } from "../format";

type SortMode = "name" | "weight";
const SORT_LABELS: Record<SortMode, string> = { name: "Name", weight: "Weight" };


function ResultRow({
  label,
  value,
  est,
  good,
  hasCompare,
}: {
  label: string;
  value: string;
  est: string | null;
  good: boolean;
  hasCompare: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}>
        <span
          className="num"
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: hasCompare ? (good ? "var(--positive)" : "var(--negative)") : "var(--text-primary)",
          }}
        >
          {value}
        </span>
        {est && (
          <span className="num" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            est. {est}
          </span>
        )}
      </span>
    </div>
  );
}

function ResultBody({ r }: { r: EarningsResult }) {
  const epsBeat = r.eps !== null && r.epsEstimate !== null && r.eps >= r.epsEstimate;
  const revBeat = r.revenue !== null && r.revenueEstimate !== null && r.revenue >= r.revenueEstimate;
  const hasRevenue = r.revenue !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <ResultRow
        label="EPS"
        value={r.eps !== null ? usd(r.eps) : "—"}
        est={r.epsEstimate !== null ? usd(r.epsEstimate) : null}
        good={epsBeat}
        hasCompare={r.eps !== null && r.epsEstimate !== null}
      />
      {r.surprisePct !== null && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Surprise</span>
          <span
            className={`num ${r.surprisePct >= 0 ? "positive" : "negative"}`}
            style={{ fontSize: 15, fontWeight: 600 }}
          >
            {r.surprisePct >= 0 ? "▲" : "▼"} {Math.abs(r.surprisePct).toFixed(1)}%
          </span>
        </div>
      )}
      {hasRevenue && (
        <ResultRow
          label="Revenue"
          value={abbreviateUsd(r.revenue!)}
          est={r.revenueEstimate !== null ? abbreviateUsd(r.revenueEstimate) : null}
          good={revBeat}
          hasCompare={r.revenueEstimate !== null}
        />
      )}
      {!hasRevenue && (
        <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          Revenue detail is only available for the latest reported quarter.
        </p>
      )}
    </div>
  );
}

export default function Earnings() {
  const [doc, setDoc] = useState<EarningsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<EarningsResult | null>(null);
  const [sort, setSort] = useState<SortMode>("name");

  useEffect(() => {
    api
      .get<EarningsDoc>("/api/earnings")
      .then(setDoc)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const calendarEvents: CalendarEvent[] = useMemo(
    () =>
      (doc?.calendar ?? []).map((e) => ({
        date: e.date,
        kind: e.isPast ? ("earnings-past" as const) : ("earnings" as const),
        ticker: e.ticker,
      })),
    [doc],
  );

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));

  const dateRows: CalendarRowEntry[] = selectedDate
    ? doc.calendar.filter((e) => e.date === selectedDate)
    : [];
  const resultForDate = (ticker: string, date: string): EarningsResult | null =>
    (doc.results[ticker] ?? []).find((r) => r.date === date) ?? null;

  const tickersWithResults = Object.entries(doc.results)
    .filter(([, r]) => r.length > 0)
    .sort(([a], [b]) => {
      const ha = holdingByTicker.get(a);
      const hb = holdingByTicker.get(b);
      if (sort === "weight") return (hb?.weight ?? 0) - (ha?.weight ?? 0);
      return (ha?.name ?? a).localeCompare(hb?.name ?? b);
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Earnings</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {selectedDate && dateRows.length > 0 && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}
          onClose={() => setSelectedDate(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {dateRows.map((e) => {
              const weight = holdingByTicker.get(e.ticker)?.weight;
              const result = e.isPast ? resultForDate(e.ticker, e.date) : null;
              return (
                <div key={e.ticker}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <TickerAvatar ticker={e.ticker} logo={e.logo} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 500 }}>{e.name}</p>
                      <p className="num" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        {weight !== undefined && <>{(weight * 100).toFixed(1)}% · </>}
                        {e.quarter > 0 ? `Q${e.quarter} ${e.year}` : e.year}
                        {e.isEstimate && " (est.)"}
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: "var(--space-3)",
                      paddingTop: "var(--space-3)",
                      borderTop: "1px solid var(--hairline)",
                    }}
                  >
                    {e.isPast ? (
                      result ? (
                        <ResultBody r={result} />
                      ) : (
                        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Results not in yet.</p>
                      )
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-around" }}>
                        {e.epsEstimate !== null && (
                          <div style={{ textAlign: "center" }}>
                            <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>EPS est.</p>
                            <p className="num" style={{ fontSize: 14 }}>
                              {usd(e.epsEstimate)}
                            </p>
                          </div>
                        )}
                        {e.revenueEstimate !== null && (
                          <div style={{ textAlign: "center" }}>
                            <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Revenue est.</p>
                            <p className="num" style={{ fontSize: 14 }}>
                              {abbreviateUsd(e.revenueEstimate)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {selectedResult && (
        <Modal title={selectedResult.period} onClose={() => setSelectedResult(null)}>
          <ResultBody r={selectedResult} />
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Past results</h3>
        <FilterMenu mode={sort} onChange={setSort} labels={SORT_LABELS} />
      </div>
      {tickersWithResults.length === 0 && (
        <p style={{ color: "var(--text-tertiary)" }}>No historical results yet.</p>
      )}

      <div
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "var(--space-3)" }}
      >
        {tickersWithResults.map(([ticker, results]) => {
          const h = holdingByTicker.get(ticker);
          return (
            <Card key={ticker}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  marginBottom: "var(--space-3)",
                }}
              >
                <TickerAvatar ticker={ticker} logo={h?.logo} size={28} />
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 15,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h?.name ?? ticker}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{h?.displayTicker ?? ticker}</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {results.slice(0, 4).map((r) => (
                  <button
                    key={r.date}
                    onClick={() => setSelectedResult(r)}
                    style={{
                      padding: "var(--space-2) 0",
                      borderTop: "1px solid var(--hairline)",
                      background: "none",
                      border: "none",
                      borderTopWidth: 1,
                      borderTopStyle: "solid",
                      borderTopColor: "var(--hairline)",
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.period}</p>
                      {r.surprisePct !== null && (
                        <span
                          className={`num ${r.surprisePct >= 0 ? "positive" : "negative"}`}
                          style={{ fontSize: 11, fontWeight: 600 }}
                        >
                          {r.surprisePct >= 0 ? "▲" : "▼"} {Math.abs(r.surprisePct).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 2 }}>
                      <span className="num" style={{ fontSize: 13 }}>
                        {r.eps !== null ? usd(r.eps) : "—"}
                      </span>
                      {r.epsEstimate !== null && (
                        <span className="num" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                          est. {usd(r.epsEstimate)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
