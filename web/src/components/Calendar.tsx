import { useState } from "react";

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  kind: "earnings" | "earnings-past" | "dividend-ex" | "dividend-pay";
  ticker: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_VISIBLE_PER_DAY = 2;

function toKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const KIND_COLOR: Record<CalendarEvent["kind"], string> = {
  earnings: "var(--accent-dim)", // upcoming earnings
  "earnings-past": "var(--bg-elevated-2)", // already-reported earnings, muted
  "dividend-ex": "rgba(79, 184, 122, 0.16)", // ex-dividend date, lighter (just a qualification cutoff)
  "dividend-pay": "rgba(79, 184, 122, 0.45)", // payment date, darker (the cash actually arrives)
};

export function Calendar({
  events,
  onSelectDate,
}: {
  events: CalendarEvent[];
  onSelectDate?: (date: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = eventsByDate.get(e.date) ?? [];
    list.push(e);
    eventsByDate.set(e.date, list);
  }

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toKey(now.getFullYear(), now.getMonth(), now.getDate());

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); } else setMonth((m) => m + 1);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 18, padding: "0 var(--space-2)" }}>
          ‹
        </button>
        <p style={{ fontWeight: 600 }}>
          {firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <button onClick={nextMonth} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 18, padding: "0 var(--space-2)" }}>
          ›
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: "var(--space-1)" }}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "var(--text-tertiary)" }}>{w}</div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
        }}
      >
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const key = toKey(year, month, day);
          const dayEvents = eventsByDate.get(key) ?? [];
          const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY);
          const overflow = dayEvents.length - visible.length;
          const isToday = key === todayKey;
          return (
            <button
              key={i}
              onClick={() => dayEvents.length > 0 && onSelectDate?.(key)}
              style={{
                minHeight: 44,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 2,
                padding: "4px 2px",
                border: "none",
                borderRadius: 8,
                background: isToday ? "var(--accent-wash)" : "none",
                color: isToday ? "var(--accent)" : "var(--text-primary)",
                fontSize: 12,
                fontWeight: isToday ? 700 : 400,
                cursor: dayEvents.length > 0 ? "pointer" : "default",
              }}
            >
              {day}
              {visible.map((e, j) => (
                <span
                  key={j}
                  className="num"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: "2px 4px",
                    borderRadius: 4,
                    background: KIND_COLOR[e.kind],
                    color: "var(--text-primary)",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.ticker}
                </span>
              ))}
              {overflow > 0 && (
                <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>+{overflow}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
