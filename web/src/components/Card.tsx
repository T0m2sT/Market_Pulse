import { useState, type ReactNode } from "react";

export function Card({ children, elevated = false }: { children: ReactNode; elevated?: boolean }) {
  return (
    <div
      style={{
        background: elevated ? "var(--bg-elevated-2)" : "var(--bg-elevated-1)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-4)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {children}
    </div>
  );
}

/** A self-contained pill-chip list row: leading element (usually a TickerAvatar), label, trailing value. */
export function Row({
  leading,
  label,
  sublabel,
  trailing,
  onTap,
}: {
  leading?: ReactNode;
  label: ReactNode;
  sublabel?: ReactNode;
  trailing?: ReactNode;
  onTap?: () => void;
}) {
  const Tag = onTap ? "button" : "div";
  return (
    <Tag
      onClick={onTap}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        width: "100%",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-elevated-2)",
        border: "none",
        textAlign: "left",
        cursor: onTap ? "pointer" : "default",
      }}
    >
      {leading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </p>
        {sublabel && <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{sublabel}</p>}
      </div>
      {trailing && <div style={{ textAlign: "right", flexShrink: 0 }}>{trailing}</div>}
    </Tag>
  );
}

export function Freshness({ updatedAt }: { updatedAt: string }) {
  const date = new Date(updatedAt);
  const isStale = Date.now() - date.getTime() > 1000 * 60 * 60 * 2; // 2h
  return (
    <p style={{ fontSize: 12, color: isStale ? "var(--warning)" : "var(--text-tertiary)" }}>
      Updated {date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
    </p>
  );
}

/** value is always in the T212 account currency (EUR) — every P&L this app computes is portfolio money. */
export function PnL({ value, percent }: { value: number; percent: number }) {
  const sign = value >= 0 ? "positive" : "negative";
  const prefix = value >= 0 ? "+" : "";
  return (
    <span className={`num ${sign}`}>
      {prefix}€{value.toFixed(2)} ({prefix}
      {(percent * 100).toFixed(2)}%)
    </span>
  );
}

/** A small dropdown for switching between sort/view modes — used by Returns and Earnings. */
export function FilterMenu<T extends string>({
  mode,
  onChange,
  labels,
}: {
  mode: T;
  onChange: (m: T) => void;
  labels: Record<T, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated-2)",
          border: "none",
          color: "var(--text-primary)",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {labels[mode]} ▾
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 11,
              background: "var(--bg-elevated-2)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow-card)",
              overflow: "hidden",
              minWidth: 140,
            }}
          >
            {(Object.keys(labels) as T[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-3)",
                  background: m === mode ? "var(--accent-wash)" : "none",
                  border: "none",
                  color: m === mode ? "var(--accent)" : "var(--text-primary)",
                  fontSize: 14,
                  fontWeight: m === mode ? 600 : 400,
                }}
              >
                {labels[m]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
