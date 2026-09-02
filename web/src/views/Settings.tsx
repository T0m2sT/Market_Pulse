import { useState } from "react";
import { getToken, setToken, api } from "../api/client";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

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
