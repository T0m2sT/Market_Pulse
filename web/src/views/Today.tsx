import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, EarningsDoc, DividendsDoc, HoldingsDoc, ReturnsDoc } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Hero } from "../components/Hero";
import { Ribbon } from "../components/Ribbon";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { eur, usd, abbreviateUsd } from "../format";
import { BriefingTile } from "../components/BriefingTile";

function SectionHeader({ children, action }: { children: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: "var(--space-5)" }}>
      <h2 className="display" style={{ fontSize: 28 }}>
        {children}
      </h2>
      {action && (
        <button
          onClick={action.onClick}
          className="mono"
          style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontSize: 12, fontWeight: 700 }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const [news, setNews] = useState<NewsDoc | null>(null);
  const [earnings, setEarnings] = useState<EarningsDoc | null>(null);
  const [dividends, setDividends] = useState<DividendsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [returns, setReturns] = useState<ReturnsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<NewsDoc>("/api/news/top"),
      api.get<EarningsDoc>("/api/earnings"),
      api.get<DividendsDoc>("/api/dividends"),
      api.get<HoldingsDoc>("/api/holdings"),
      api.get<ReturnsDoc>("/api/returns"),
    ])
      .then(([n, e, d, h, r]) => {
        setNews(n);
        setEarnings(e);
        setDividends(d);
        setHoldings(h);
        setReturns(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  const ribbon = useMemo(
    () =>
      [...(holdings?.positions ?? [])]
        .sort((a, b) => b.weight - a.weight)
        .map((p) => ({ ...p, change: p.averagePrice > 0 ? p.currentPrice / p.averagePrice - 1 : 0 })),
    [holdings],
  );

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const earningsEvents = (earnings?.calendar ?? []).map((e) => ({
      date: e.date,
      kind: e.isPast ? ("earnings-past" as const) : ("earnings" as const),
      ticker: e.ticker,
    }));
    // Same events as the Dividends tab: both the ex-date and the payment date for every
    // dividend, so the two calendars agree. (Dividends tab shows all; Today shows all too.)
    const d = dividends?.dividends ?? [];
    const dividendEvents = [
      ...d.map((x) => ({ date: x.exDate, kind: "dividend-ex" as const, ticker: x.ticker })),
      ...d.map((x) => ({ date: x.paymentDate, kind: "dividend-pay" as const, ticker: x.ticker })),
    ];
    return [...earningsEvents, ...dividendEvents];
  }, [earnings, dividends]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!news || !earnings || !dividends) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));
  const shownEarnings = selectedDate ? earnings.calendar.filter((e) => e.date === selectedDate) : [];
  const shownDividends = selectedDate
    ? dividends.dividends.filter((d) => d.exDate === selectedDate || d.paymentDate === selectedDate)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h1>Today</h1>
      <Freshness updatedAt={news.updatedAt} />

      {returns && (
        <Hero label="Portfolio value" value={returns.totalValue} pnl={returns.totalPnl} percent={returns.totalPnlPercent} />
      )}

      {ribbon.length > 0 && (
        <Ribbon>
          {ribbon.map((p) => (
            <div
              key={p.ticker}
              className="num"
              style={{
                flex: "none",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "6px 12px 6px 6px",
                borderRadius: 999,
                background: "var(--bg-elevated-1)",
                border: "1px solid var(--hairline)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <TickerAvatar ticker={p.ticker} logo={p.logo} size={24} />
              {p.displayTicker ?? p.ticker}
              <span className={p.change >= 0 ? "positive" : "negative"}>
                {p.change >= 0 ? "+" : "-"}
                {Math.abs(p.change * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </Ribbon>
      )}

      <SectionHeader>Calendar</SectionHeader>
      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      <SectionHeader action={{ label: "ALL NEWS →", onClick: () => navigate("/news") }}>Briefings</SectionHeader>
      {news.briefings.length === 0 ? (
        <Card>
          <p style={{ color: "var(--text-tertiary)" }}>No briefings yet.</p>
        </Card>
      ) : (
        <div className="tile-grid">
          {news.briefings.map((b) => (
            <BriefingTile
              key={`${b.ticker}:${b.weekStart}`}
              b={b}
              logo={holdingByTicker.get(b.ticker)?.logo}
              onOpen={() => navigate(`/briefing/${b.ticker}/${b.weekStart}`)}
            />
          ))}
        </div>
      )}

      {selectedDate && (shownEarnings.length > 0 || shownDividends.length > 0) && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}
          onClose={() => setSelectedDate(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {shownEarnings.map((e) => {
              const weight = holdingByTicker.get(e.ticker)?.weight;
              return (
                <div key={`e-${e.ticker}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <TickerAvatar ticker={e.ticker} logo={e.logo} />
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
                        {e.name}
                      </p>
                      <p
                        className="num"
                        style={{
                          fontSize: 12,
                          color: "var(--text-tertiary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {weight !== undefined && <>{(weight * 100).toFixed(1)}% · </>}
                        {e.isPast ? "Reported" : "Earnings"} · {e.quarter > 0 ? `Q${e.quarter} FY${e.year}` : e.year}
                      </p>
                    </div>
                  </div>
                  {!e.isPast && (e.epsEstimate !== null || e.revenueEstimate !== null) && (
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
              );
            })}
            {shownDividends.map((d) => {
              const weight = holdingByTicker.get(d.ticker)?.weight;
              const isPayDate = d.paymentDate === selectedDate;
              return (
                <div key={`d-${d.ticker}`}>
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
                      <p
                        className="num"
                        style={{
                          fontSize: 12,
                          color: "var(--text-tertiary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {weight !== undefined && <>{(weight * 100).toFixed(1)}% · </>}
                        {isPayDate ? "Payment" : "Ex-dividend"}
                        {d.yieldPct !== null && <> · {d.yieldPct.toFixed(2)}% yield</>}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-3)" }}>
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
