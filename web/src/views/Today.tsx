import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, EarningsDoc, DividendsDoc, HoldingsDoc, TodayEarningsRecap } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { eur, usd, abbreviateUsd } from "../format";

function SectionHeader({ children }: { children: string }) {
  return (
    <h2
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        marginTop: "var(--space-2)",
      }}
    >
      {children}
    </h2>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const [news, setNews] = useState<NewsDoc | null>(null);
  const [earnings, setEarnings] = useState<EarningsDoc | null>(null);
  const [dividends, setDividends] = useState<DividendsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [recaps, setRecaps] = useState<TodayEarningsRecap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<NewsDoc>("/api/news/top"),
      api.get<EarningsDoc>("/api/earnings"),
      api.get<DividendsDoc>("/api/dividends"),
      api.get<HoldingsDoc>("/api/holdings"),
    ])
      .then(([n, e, d, h]) => {
        setNews(n);
        setEarnings(e);
        setDividends(d);
        setHoldings(h);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    api.get<TodayEarningsRecap[]>("/api/earnings/today-recaps").then(setRecaps).catch(() => {});
  }, []);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const earningsEvents = (earnings?.upcoming ?? []).map((e) => ({ date: e.date, kind: "earnings" as const, ticker: e.ticker }));
    const dividendEvents = (dividends?.upcoming ?? [])
      .filter((d) => !d.locked)
      .map((d) => ({ date: d.paymentDate, kind: "dividend-pay" as const, ticker: d.ticker }));
    return [...earningsEvents, ...dividendEvents];
  }, [earnings, dividends]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!news || !earnings || !dividends) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));

  // dividends.upcoming intentionally includes a short window of already-passed (locked) entries
  // for the Dividends detail screen — Today only ever shows genuinely future ones.
  const futureDividends = dividends.upcoming.filter((d) => !d.locked);
  const shownEarnings = selectedDate ? earnings.upcoming.filter((e) => e.date === selectedDate) : [];
  const shownDividends = selectedDate ? futureDividends.filter((d) => d.paymentDate === selectedDate) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h1>Today</h1>
      <Freshness updatedAt={news.updatedAt} />

      <SectionHeader>News</SectionHeader>
      {news.articles.length === 0 && (
        <Card>
          <p style={{ color: "var(--text-tertiary)" }}>No ranked stories yet.</p>
        </Card>
      )}
      {news.articles.map((a) => {
        const isPositive = a.sentiment >= 0;
        return (
          <Card key={a.id} elevated>
            <button
              onClick={() => navigate(`/article/${a.id}`)}
              style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                <TickerAvatar ticker={a.ticker} logo={holdingByTicker.get(a.ticker)?.logo} size={24} />
                <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>{a.ticker}</span>
                <span
                  className={`num ${isPositive ? "positive" : "negative"}`}
                  style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "var(--bg-elevated-1)" }}
                >
                  {isPositive ? "+" : ""}{a.sentiment.toFixed(2)}
                </span>
              </div>
              <h3 style={{ marginBottom: "var(--space-2)", fontSize: 16 }}>{a.title}</h3>
              {a.description && (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginBottom: "var(--space-2)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {a.description}
                </p>
              )}
              {a.reason && (
                <p style={{ fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic" }}>{a.reason}</p>
              )}
            </button>
          </Card>
        );
      })}

      <SectionHeader>Calendar</SectionHeader>
      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {recaps.length > 0 && (
        <>
          <SectionHeader>Recent earnings</SectionHeader>
          {recaps.map((r) => {
            const h = holdingByTicker.get(r.ticker);
            const beat = r.epsActual !== null && r.epsEstimate !== null && r.epsActual >= r.epsEstimate;
            return (
              <Card key={r.ticker} elevated>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                  <TickerAvatar ticker={r.ticker} logo={h?.logo} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h?.name ?? r.ticker}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                      {h?.displayTicker ?? r.ticker} · {r.date}
                    </p>
                  </div>
                  {r.epsActual !== null && r.epsEstimate !== null && (
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
                      {beat ? "▲" : "▼"} {usd(r.epsActual)} vs {usd(r.epsEstimate)} est.
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{r.takeaway}</p>
              </Card>
            );
          })}
        </>
      )}

      {selectedDate && (shownEarnings.length > 0 || shownDividends.length > 0) && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
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
                      <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.name}
                      </p>
                      <p
                        className="num"
                        style={{ fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {weight !== undefined && <>{(weight * 100).toFixed(1)}% · </>}
                        Earnings · Q{e.quarter} {e.year}
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
            {shownDividends.map((d) => {
              const weight = holdingByTicker.get(d.ticker)?.weight;
              return (
                <div key={`d-${d.ticker}`}>
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
                        Dividend
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
