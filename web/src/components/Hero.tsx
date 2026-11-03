import { useEffect, useRef, type ReactNode } from "react";
import { eur } from "../format";

/** Counts a euro value up from zero by writing straight to the DOM node (no React state per frame). */
function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = eur(value);
      return;
    }
    const start = performance.now();
    const duration = 1100;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = eur(value * (1 - Math.pow(1 - t, 4)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span ref={ref}>{eur(value)}</span>;
}

/** The one big number: what the portfolio is worth, and what it has made. */
export function Hero({
  label,
  value,
  pnl,
  percent,
  compact = false,
  children,
}: {
  label: string;
  value: number;
  /** Leave both out for a plain total with no profit and loss pill. */
  pnl?: number;
  percent?: number;
  /** Smaller card for a group of positions: static value, and `children` rendered underneath. */
  compact?: boolean;
  children?: ReactNode;
}) {
  const up = (pnl ?? 0) >= 0;
  return (
    <section
      aria-label={label}
      style={{
        position: "relative",
        padding: "var(--space-5)",
        borderRadius: "var(--radius-lg)",
        background: compact ? "var(--card-bg)" : "var(--hero-bg)",
        color: "var(--hero-fg)",
        overflow: "hidden",
        border: compact ? "1px solid var(--hairline)" : "1px solid var(--line-strong)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <p className="mono" style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, textTransform: "uppercase" }}>{label}</p>
      <p
        className="display num"
        style={{ fontSize: compact ? 36 : "clamp(44px, 14vw, 64px)", marginTop: "var(--space-2)" }}
      >
        {compact ? eur(value) : <CountUp value={value} />}
      </p>
      {pnl !== undefined && percent !== undefined && (
      <p
        className="num"
        style={{
          display: "inline-block",
          marginTop: compact ? "var(--space-3)" : "var(--space-4)",
          padding: "6px 12px",
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 700,
          // Orange pill; the text inside is deep green for a gain and deep red for a loss (plus an arrow).
          background: "var(--orange)",
          color: up ? "#00461f" : "#a3001f",
        }}
      >
        {up ? "▲ +" : "▼ -"}€{Math.abs(pnl).toFixed(2)} ({up ? "+" : "-"}
        {Math.abs(percent * 100).toFixed(2)}%)
      </p>
      )}
      {children && <div style={{ marginTop: "var(--space-4)" }}>{children}</div>}
    </section>
  );
}
