import { useState } from "react";
import { getToken, setToken, api } from "../api/client";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

interface ProviderKey {
  secret: string;
  purpose: string;
  url: string;
}

const PROVIDER_KEYS: ProviderKey[] = [
  { secret: "T212_API_KEY_ID / T212_API_SECRET", purpose: "Syncs your live portfolio positions from Trading212.", url: "https://www.trading212.com" },
  { secret: "FINNHUB_API_KEY", purpose: "Earnings calendar and historical EPS results.", url: "https://finnhub.io/register" },
  { secret: "MARKETAUX_API_KEY", purpose: "Raw news articles per holding, feeds the weekly briefing.", url: "https://www.marketaux.com" },
  { secret: "ANTHROPIC_API_KEY", purpose: "Claude writes the weekly news briefings.", url: "https://console.anthropic.com" },
  { secret: "EODHD_API_KEY", purpose: "Dividend ex-date, pay-date and amount data.", url: "https://eodhd.com" },
];

function InfoRow({ k }: { k: ProviderKey }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
        <code style={{ fontSize: 12 }}>{k.secret}</code>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`About ${k.secret}`}
          title={`About ${k.secret}`}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "1px solid var(--text-tertiary)",
            background: "none",
            color: "var(--text-tertiary)",
            fontSize: 11,
            lineHeight: "16px",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          i
        </button>
      </div>
      {open && (
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: "var(--space-1)" }}>
          {k.purpose}{" "}
          <a href={k.url} target="_blank" rel="noreferrer">
            Get a key
          </a>
        </p>
      )}
    </div>
  );
}

export default function Settings() {
  const [tokenInput, setTokenInput] = useState(getToken() ?? "");
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  function saveToken() {
    setToken(tokenInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function refresh(kind: "holdings" | "returns" | "earnings" | "news") {
    setRefreshing(kind);
    setRefreshError(null);
    try {
      const path =
        kind === "holdings" ? "/api/holdings/sync" : `/api/${kind}/refresh`;
      await api.post(path);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Settings</h1>

      <Card>
        <h3 style={{ marginBottom: "var(--space-2)" }}>Bearer token</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
          The token from your Worker's <code>API_TOKEN</code> secret.
        </p>
        <Input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Paste bearer token"
          style={{ marginBottom: "var(--space-3)" }}
        />
        <Button variant="primary" onClick={saveToken}>
          {saved ? "Saved" : "Save token"}
        </Button>
      </Card>

      <Card>
        <h3 style={{ marginBottom: "var(--space-2)" }}>API keys</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: "var(--space-3)" }}>
          These are set as Worker secrets during deployment, not here — see the README. Tap the{" "}
          <span style={{ fontStyle: "italic" }}>i</span> next to each for what it's for and where to get it.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {PROVIDER_KEYS.map((k) => (
            <InfoRow key={k.secret} k={k} />
          ))}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginBottom: "var(--space-3)" }}>Manual refresh</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {(["holdings", "returns", "earnings", "news"] as const).map((kind) => (
            <Button
              key={kind}
              align="left"
              onClick={() => refresh(kind)}
              disabled={refreshing !== null}
              style={{ textTransform: "capitalize" }}
            >
              {refreshing === kind ? "Refreshing…" : `Sync ${kind}`}
            </Button>
          ))}
        </div>
        {refreshError && (
          <p style={{ color: "var(--negative)", fontSize: 13, marginTop: "var(--space-2)" }}>{refreshError}</p>
        )}
      </Card>

      <Card>
        <h3 style={{ marginBottom: "var(--space-2)" }}>Push notifications</h3>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
          Not yet available — coming in a later phase.
        </p>
      </Card>
    </div>
  );
}
