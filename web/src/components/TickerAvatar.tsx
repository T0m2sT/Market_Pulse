const PALETTE = [
  "var(--ticker-1)",
  "var(--ticker-2)",
  "var(--ticker-3)",
  "var(--ticker-4)",
  "var(--ticker-5)",
  "var(--ticker-6)",
  "var(--ticker-7)",
  "var(--ticker-8)",
];

function hashTicker(ticker: string): number {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic color per ticker so the same symbol always gets the same avatar color. */
export function avatarColor(ticker: string): string {
  return PALETTE[hashTicker(ticker) % PALETTE.length];
}

export function TickerAvatar({
  ticker,
  logo,
  size = 36,
}: {
  ticker: string;
  logo?: string;
  size?: number;
}) {
  const initials = ticker.replace(/\..*$/, "").slice(0, 2).toUpperCase();

  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: "50%",
          objectFit: "cover",
          background: "var(--bg-elevated-2)",
        }}
        onError={(e) => {
          // Logo failed to load — swap the <img> for the initials fallback in place.
          const el = e.currentTarget;
          const fallback = document.createElement("div");
          fallback.style.cssText = `width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;background:${avatarColor(ticker)};display:flex;align-items:center;justify-content:center;font-size:${size * 0.36}px;font-weight:700;color:var(--bg-base);letter-spacing:-0.02em`;
          fallback.textContent = initials;
          el.replaceWith(fallback);
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        background: avatarColor(ticker),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.36,
        fontWeight: 700,
        color: "var(--bg-base)",
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}
