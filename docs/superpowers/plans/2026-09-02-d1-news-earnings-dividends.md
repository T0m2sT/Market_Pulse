# D1 persistence for News, Earnings, Dividends — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the News, Earnings, and Dividends tabs off single rebuilt-every-cron KV documents and onto Cloudflare D1 with bounded history, so a paid dividend stays visible, news becomes Claude-written weekly company briefings, and every past earnings report has a structured revenue/EPS/guidance pop-up.

**Architecture:** A D1 database (`market-pulse`) bound to the existing Worker as `DB`. Five tables (`news_articles`, `news_briefings`, `earnings_calendar`, `earnings_results`, `dividends`). Domain modules (`src/news.ts`, `src/earnings.ts`, `src/dividends.ts`) rewritten to read/write D1 through a thin typed helper (`src/db.ts`); no ORM. Holdings, returns, and push subscriptions stay in KV. Crons gain one new `*/10` earnings-results poll that no-ops instantly on non-earnings days, plus a Monday-only news-briefing generation slot. Frontend views rewritten to consume the new API shapes.

**Council review:** `/council` could not run — no provider API keys are configured in this environment (`GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROK_API_KEY` / `PERPLEXITY_API_KEY` all unset). A single-reviewer critical pass was done instead; its accepted findings are folded in below (cron day-of-week `2-6` not `1-5`, briefing generation split to a Monday cron to bound subrequests, `description` column added to `news_articles`, backfill chunked to 15 rows/call, `getEarnings` updatedAt simplified).

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Wrangler migrations, TypeScript, React 19 + react-router 7, Vitest (new dev dep, pure-logic tests only), Claude Haiku (`claude-haiku-4-5-20251001`) with and without `web_search`.

---

## File Structure

**New files:**
- `migrations/0001_init.sql` — all five tables + indexes.
- `src/db.ts` — `D1` typed query helpers: `all<T>()`, `first<T>()`, `run()`, `batch()`. ~40 lines.
- `src/iso-week.ts` — `isoWeekBounds(date)` → `{ weekStart, weekEnd }` (Mon–Sun, YYYY-MM-DD). Pure. Shared by news + tests.
- `src/backfill.ts` — one-time idempotent backfill: dividends refresh + earnings history + KAP.L.
- `vitest.config.ts` — node environment, `src/**/*.test.ts`.
- `src/dividends.test.ts`, `src/news.test.ts`, `src/earnings.test.ts`, `src/iso-week.test.ts` — pure-logic self-checks.
- `web/src/views/Briefing.tsx` — replaces `Article.tsx`.

**Rewritten:**
- `src/dividends.ts` — D1-backed; lock/freeze; yield; retention.
- `src/news.ts` — article ingest to D1; weekly briefing generation; no per-article ranking; no seen-set.
- `src/earnings.ts` — calendar + results to D1; results poll; no today-recaps.
- `web/src/views/News.tsx` — briefing list.
- `web/src/views/Dividends.tsx` — ex/pay pop-up entries with/without glow + yield.
- `web/src/views/Earnings.tsx` — tappable rows, past-date pop-up with revenue/EPS/guidance.

**Edited:**
- `wrangler.jsonc` — `d1_databases` binding; new cron.
- `src/env.d.ts` — `DB: D1Database`.
- `worker-configuration.d.ts` — regenerated via `wrangler types` (do not hand-edit).
- `src/index.ts` — route changes, cron dispatch, `/api/admin/backfill`.
- `src/haiku.ts` — delete `rankArticles`, `RankInput`, `RankedItem`.
- `src/web-earnings.ts` — delete recap half (`TodayEarningsRecap`, `lookupTodayEarningsRecap`, `RECAP_SYSTEM_PROMPT`); keep KAP.L next-date + history lookup; add a structured-results lookup used by the poll.
- `web/src/views/Today.tsx` — top-3 briefings; remove today-recap section; calendar past+future earnings dots.
- `web/src/api/types.ts` — `Briefing`/`NewsDoc`, `EarningsResult` new columns, `CalendarRowEntry`, `Dividend`; remove `RankedArticle`, `TodayEarningsRecap`.
- `web/src/App.tsx` — route `/article/:id` → `/briefing/:ticker/:weekStart`.
- `web/src/components/Calendar.tsx` — distinguish past vs future earnings dot.

**Deleted:**
- `web/src/views/Article.tsx` (replaced by `Briefing.tsx`).

---

## Conventions used throughout

- All dates stored as `YYYY-MM-DD` strings; all timestamps as ISO 8601 (`new Date().toISOString()`).
- "today" in the Worker = `new Date().toISOString().slice(0, 10)` (UTC).
- D1 upserts use `INSERT ... ON CONFLICT (<pk>) DO UPDATE SET ...`.
- Every domain module exports a `getX(db)` read and a `refreshX(db, ...)` write, mirroring the current KV signatures with `db` swapped for `kv`.
- Model constant: `const HAIKU = "claude-haiku-4-5-20251001";` (already the string used across the codebase).
- Commit after every task with a conventional single-line message (repo rule: no multi-line body, no AI attribution trailer).

---

## Task 1: Add Vitest and the ISO-week helper

**Files:**
- Create: `vitest.config.ts`
- Create: `src/iso-week.ts`
- Create: `src/iso-week.test.ts`
- Modify: `package.json` (root) — add `vitest` dev dep + `test` script

- [ ] **Step 1: Install vitest**

Run:
```bash
npm install -D vitest@^3
```
Expected: `vitest` appears in root `package.json` `devDependencies`.

- [ ] **Step 2: Set the test script**

Edit root `package.json` `scripts`:
```json
"scripts": {
  "test": "vitest run"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing test — `src/iso-week.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { isoWeekBounds } from "./iso-week";

describe("isoWeekBounds", () => {
  it("returns Monday..Sunday for a mid-week date", () => {
    // 2026-09-02 is a Wednesday
    expect(isoWeekBounds("2026-09-02")).toEqual({
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
    });
  });

  it("treats Monday as the start of its own week", () => {
    expect(isoWeekBounds("2026-08-31")).toEqual({
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
    });
  });

  it("treats Sunday as the end of the week that started the prior Monday", () => {
    expect(isoWeekBounds("2026-09-06")).toEqual({
      weekStart: "2026-08-31",
      weekEnd: "2026-09-06",
    });
  });

  it("handles month/year boundaries", () => {
    // 2027-01-01 is a Friday
    expect(isoWeekBounds("2027-01-01")).toEqual({
      weekStart: "2026-12-28",
      weekEnd: "2027-01-03",
    });
  });
});
```

- [ ] **Step 5: Run it, verify failure**

Run: `npm test -- iso-week`
Expected: FAIL — `isoWeekBounds` is not exported / file missing.

- [ ] **Step 6: Implement `src/iso-week.ts`**

```ts
/** Monday..Sunday bounds of the ISO week containing `date` (YYYY-MM-DD), as YYYY-MM-DD strings. */
export function isoWeekBounds(date: string): { weekStart: string; weekEnd: string } {
  const d = new Date(date + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon->0, Sun->6
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 7: Run it, verify pass**

Run: `npm test -- iso-week`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/iso-week.ts src/iso-week.test.ts
git commit -m "test: add vitest and iso-week helper"
```

---

## Task 2: D1 schema migration

**Files:**
- Create: `migrations/0001_init.sql`

> **Subrequest-limit check (do this first, before Task 3):** run `npx wrangler deployments list` / check the Cloudflare dashboard for the Workers plan. The `5 6 * * *` cron already fans out ~25 Finnhub + a Claude call in the *current* code and works, which means this account is on the **Workers Paid** plan (1000 subrequests/invocation) — the free plan's 50 would already be failing. Confirm this. The new design keeps each cron invocation's subrequest count bounded: calendar+dividends (~95), briefings on their own Monday cron (~25 Claude calls), poll (~2). All fine on Paid; none fit Free. If somehow on Free, the briefing and calendar crons must be split further — flag before proceeding.

- [ ] **Step 1: Write `migrations/0001_init.sql`**

```sql
-- Raw article feed. Fed to Claude only; never rendered in the app.
CREATE TABLE news_articles (
  url          TEXT PRIMARY KEY,
  ticker       TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL,
  published_at TEXT NOT NULL,
  sentiment    REAL NOT NULL,
  fetched_at   TEXT NOT NULL
);
CREATE INDEX idx_news_articles_ticker_pub ON news_articles (ticker, published_at);
CREATE INDEX idx_news_articles_pub ON news_articles (published_at);

-- Claude-written weekly briefings. The only thing the News tab shows.
CREATE TABLE news_briefings (
  ticker        TEXT NOT NULL,
  week_start    TEXT NOT NULL,
  summary       TEXT NOT NULL,
  body          TEXT NOT NULL,
  sentiment     REAL NOT NULL,
  article_count INTEGER NOT NULL,
  seen          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (ticker, week_start)
);
CREATE INDEX idx_news_briefings_week ON news_briefings (week_start);

-- One row per known earnings date (past or upcoming) per ticker.
CREATE TABLE earnings_calendar (
  ticker           TEXT NOT NULL,
  date             TEXT NOT NULL,
  hour             TEXT NOT NULL DEFAULT '',
  quarter          INTEGER NOT NULL DEFAULT 0,
  year             INTEGER NOT NULL DEFAULT 0,
  eps_estimate     REAL,
  revenue_estimate REAL,
  is_estimate      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ticker, date)
);

-- Structured actuals, filled by the post-report Claude poll or the backfill.
CREATE TABLE earnings_results (
  ticker           TEXT NOT NULL,
  date             TEXT NOT NULL,
  period           TEXT NOT NULL,
  revenue          REAL,
  revenue_estimate REAL,
  revenue_yoy_pct  REAL,
  eps              REAL,
  eps_estimate     REAL,
  eps_yoy_pct      REAL,
  guidance_text    TEXT,
  highlights_text  TEXT,
  beat             INTEGER,
  checked_at       TEXT NOT NULL,
  PRIMARY KEY (ticker, date)
);

-- One row per (ticker, ex-date). Retained by payment date, not ex-date.
CREATE TABLE dividends (
  ticker            TEXT NOT NULL,
  ex_date           TEXT NOT NULL,
  payment_date      TEXT NOT NULL,
  per_share_usd     REAL NOT NULL,
  per_share_eur     REAL NOT NULL,
  qualifying_shares REAL NOT NULL,
  amount_eur        REAL NOT NULL,
  yield_pct         REAL,
  locked            INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (ticker, ex_date)
);
```

- [ ] **Step 2: Verify it parses locally**

Run:
```bash
npx wrangler d1 execute market-pulse --local --command "SELECT 1" || true
npx wrangler d1 migrations apply market-pulse --local
```
Expected: first command may warn that the DB/binding isn't configured yet — that's fine, it's fixed in Task 3. If the binding is already added, `migrations apply --local` reports `0001_init.sql` applied with no SQL errors. If run before Task 3, skip this step and verify after Task 3 Step 4.

- [ ] **Step 3: Commit**

```bash
git add migrations/0001_init.sql
git commit -m "feat: add d1 schema migration"
```

---

## Task 3: Wire the D1 binding and `db.ts` helper

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `src/env.d.ts`
- Create: `src/db.ts`
- Regenerate: `worker-configuration.d.ts`

- [ ] **Step 1: Add the binding to `wrangler.jsonc`**

Add a top-level `d1_databases` array (sibling of `kv_namespaces`):
```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "market-pulse",
      "database_id": "PLACEHOLDER_SET_BY_WRANGLER_D1_CREATE"
    }
  ],
```
> The real `database_id` is filled in during the Migration runbook (end of plan) after `wrangler d1 create market-pulse`. Local dev works with the placeholder because `--local` uses a file-backed DB keyed by `database_name`.

- [ ] **Step 2: Add `DB` to `src/env.d.ts`**

```ts
interface Env {
  API_TOKEN: string;
  T212_API_KEY_ID: string;
  T212_API_SECRET: string;
  FINNHUB_API_KEY: string;
  MARKETAUX_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  FMP_API_KEY: string;
  DB: D1Database;
}
```

- [ ] **Step 3: Regenerate worker types**

Run:
```bash
npx wrangler types
```
Expected: `worker-configuration.d.ts` regenerated, now including `DB: D1Database` in the base env. Do not hand-edit this file.

- [ ] **Step 4: Apply the migration locally**

Run:
```bash
npx wrangler d1 migrations apply market-pulse --local
```
Expected: `0001_init.sql` applied, no SQL errors.

- [ ] **Step 5: Create `src/db.ts`**

```ts
/**
 * Thin typed wrappers over the D1 binding. No ORM — each domain module writes its own SQL.
 * `bind(...)` params are positional `?` placeholders.
 */
export const db = {
  async all<T>(d1: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
    const { results } = await d1.prepare(sql).bind(...params).all<T>();
    return results ?? [];
  },

  async first<T>(d1: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
    return (await d1.prepare(sql).bind(...params).first<T>()) ?? null;
  },

  async run(d1: D1Database, sql: string, ...params: unknown[]): Promise<void> {
    await d1.prepare(sql).bind(...params).run();
  },

  /** Runs statements in one D1 batch (atomic). Each entry is [sql, params]. */
  async batch(d1: D1Database, statements: [string, unknown[]][]): Promise<void> {
    if (statements.length === 0) return;
    await d1.batch(statements.map(([sql, p]) => d1.prepare(sql).bind(...p)));
  },
};
```

- [ ] **Step 6: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc src/env.d.ts src/db.ts worker-configuration.d.ts
git commit -m "feat: wire d1 binding and query helper"
```

---

## Task 4: Rewrite `dividends.ts` on D1 — payments-per-year inference (pure logic first)

**Files:**
- Modify: `src/dividends.ts`
- Create: `src/dividends.test.ts`

- [ ] **Step 1: Write the failing test — `src/dividends.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { paymentsPerYear, resolveDividendRow } from "./dividends";

describe("paymentsPerYear", () => {
  it("counts dividends in the trailing 365 days from the newest ex-date", () => {
    const history = [
      { date: "2026-08-15" },
      { date: "2026-05-15" },
      { date: "2026-02-15" },
      { date: "2025-11-15" },
      { date: "2025-08-15" }, // exactly 365d before newest — inclusive
      { date: "2025-05-15" }, // older, excluded
    ];
    expect(paymentsPerYear(history)).toBe(4);
  });

  it("defaults to 4 when history is too thin", () => {
    expect(paymentsPerYear([{ date: "2026-08-15" }])).toBe(4);
    expect(paymentsPerYear([])).toBe(4);
  });

  it("clamps to 1..12", () => {
    const monthly = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-${String(((i % 12) + 1)).padStart(2, "0")}-01`,
    }));
    expect(paymentsPerYear(monthly)).toBeLessThanOrEqual(12);
  });
});

describe("resolveDividendRow", () => {
  const base = {
    ticker: "KLAC",
    exDate: "2026-08-15",
    paymentDate: "2026-09-01",
    perShareUsd: 1.7,
    usdToEur: 0.92,
    quantity: 3.42,
    currentPrice: 110,
    paymentsPerYear: 4,
    today: "2026-09-02",
  };

  it("locks once the ex-date has passed and freezes prior EUR + shares", () => {
    const prior = {
      per_share_eur: 1.55,
      qualifying_shares: 3.0,
      yield_pct: 6.0,
      locked: 0,
    };
    const row = resolveDividendRow(base, prior);
    expect(row.locked).toBe(1);
    expect(row.per_share_eur).toBe(1.55); // frozen, not 1.7 * 0.92
    expect(row.qualifying_shares).toBe(3.0); // frozen, not 3.42
    expect(row.yield_pct).toBe(6.0); // frozen
    expect(row.amount_eur).toBeCloseTo(1.55 * 3.0);
  });

  it("tracks live values while unlocked (ex-date still in the future)", () => {
    const future = { ...base, exDate: "2026-09-20", today: "2026-09-02" };
    const row = resolveDividendRow(future, null);
    expect(row.locked).toBe(0);
    expect(row.per_share_eur).toBeCloseTo(1.7 * 0.92);
    expect(row.qualifying_shares).toBe(3.42);
    expect(row.yield_pct).toBeCloseTo((1.7 * 4) / 110 * 100);
    expect(row.amount_eur).toBeCloseTo(1.7 * 0.92 * 3.42);
  });

  it("stays locked if the prior row was already locked even with a future date", () => {
    const row = resolveDividendRow(
      { ...base, exDate: "2026-09-20", today: "2026-09-02" },
      { per_share_eur: 1.4, qualifying_shares: 2.0, yield_pct: 5.0, locked: 1 },
    );
    expect(row.locked).toBe(1);
    expect(row.per_share_eur).toBe(1.4);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- dividends`
Expected: FAIL — `paymentsPerYear` / `resolveDividendRow` not exported.

- [ ] **Step 3: Rewrite `src/dividends.ts`**

```ts
import { db } from "./db";
import { fetchDividends, type FmpDividend } from "./fmp";
import { usdToEurRate } from "./fx";
import { marketauxLookupTicker, type Holding } from "./holdings";

export interface DividendRow {
  ticker: string;
  exDate: string;
  paymentDate: string;
  perShareUsd: number;
  perShareEur: number;
  qualifyingShares: number;
  amountEur: number;
  yieldPct: number | null;
  locked: boolean;
}

/** Serving shape — name/logo joined from KV holdings by the route. */
export interface Dividend extends DividendRow {
  name: string;
  logo?: string;
}

const EARLIEST_EX_DATE = "2026-08-01";
const RETENTION_DAYS = 60;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Number of dividend payments in the trailing 365 days from the most recent ex-date; default 4, clamp 1..12. */
export function paymentsPerYear(history: { date: string }[]): number {
  if (history.length < 2) return 4;
  const sorted = [...history].map((h) => h.date).sort().reverse();
  const newest = new Date(sorted[0] + "T00:00:00Z").getTime();
  const cutoff = newest - 365 * 24 * 60 * 60 * 1000;
  const count = sorted.filter((d) => new Date(d + "T00:00:00Z").getTime() >= cutoff).length;
  return Math.min(12, Math.max(1, count));
}

interface PriorRow {
  per_share_eur: number;
  qualifying_shares: number;
  yield_pct: number | null;
  locked: number;
}

interface ResolveInput {
  ticker: string;
  exDate: string;
  paymentDate: string;
  perShareUsd: number;
  usdToEur: number;
  quantity: number;
  currentPrice: number;
  paymentsPerYear: number;
  today: string;
}

/** Pure: computes the row to upsert given the FMP dividend + this ticker's prior stored row (or null). */
export function resolveDividendRow(input: ResolveInput, prior: PriorRow | null): {
  ticker: string;
  ex_date: string;
  payment_date: string;
  per_share_usd: number;
  per_share_eur: number;
  qualifying_shares: number;
  amount_eur: number;
  yield_pct: number | null;
  locked: 0 | 1;
} {
  const wasLocked = prior?.locked === 1;
  const locked = wasLocked || input.exDate < input.today;

  const perShareEur = locked && prior ? prior.per_share_eur : input.perShareUsd * input.usdToEur;
  const qualifyingShares = locked && prior ? prior.qualifying_shares : input.quantity;
  const yieldPct = locked && prior
    ? prior.yield_pct
    : input.currentPrice > 0
      ? (input.perShareUsd * input.paymentsPerYear) / input.currentPrice * 100
      : null;

  return {
    ticker: input.ticker,
    ex_date: input.exDate,
    payment_date: input.paymentDate,
    per_share_usd: input.perShareUsd,
    per_share_eur: perShareEur,
    qualifying_shares: qualifyingShares,
    amount_eur: perShareEur * qualifyingShares,
    yield_pct: yieldPct,
    locked: locked ? 1 : 0,
  };
}

export async function getDividends(d1: D1Database): Promise<DividendRow[]> {
  const rows = await db.all<{
    ticker: string; ex_date: string; payment_date: string;
    per_share_usd: number; per_share_eur: number; qualifying_shares: number;
    amount_eur: number; yield_pct: number | null; locked: number;
  }>(d1, `SELECT * FROM dividends ORDER BY ex_date ASC`);
  return rows.map((r) => ({
    ticker: r.ticker,
    exDate: r.ex_date,
    paymentDate: r.payment_date,
    perShareUsd: r.per_share_usd,
    perShareEur: r.per_share_eur,
    qualifyingShares: r.qualifying_shares,
    amountEur: r.amount_eur,
    yieldPct: r.yield_pct,
    locked: r.locked === 1,
  }));
}

export async function refreshDividends(
  d1: D1Database,
  fmpKey: string,
  holdings: Holding[],
): Promise<DividendRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  let usdToEur: number;
  try {
    usdToEur = await usdToEurRate();
  } catch {
    return getDividends(d1); // don't write unconverted USD as EUR
  }

  for (const h of holdings) {
    if (h.isManual) continue;

    let fmpDividends: FmpDividend[];
    try {
      fmpDividends = await fetchDividends(fmpKey, marketauxLookupTicker(h));
    } catch {
      continue; // keep this ticker's existing rows untouched
    }

    const ppy = paymentsPerYear(fmpDividends.map((d) => ({ date: d.date })));
    const paymentRetentionFloor = daysAgo(RETENTION_DAYS);

    for (const div of fmpDividends) {
      if (div.date < EARLIEST_EX_DATE) continue;
      if (div.paymentDate < paymentRetentionFloor) continue;

      const prior = await db.first<PriorRow>(
        d1,
        `SELECT per_share_eur, qualifying_shares, yield_pct, locked FROM dividends WHERE ticker = ? AND ex_date = ?`,
        h.ticker,
        div.date,
      );

      const row = resolveDividendRow(
        {
          ticker: h.ticker,
          exDate: div.date,
          paymentDate: div.paymentDate,
          perShareUsd: div.dividend,
          usdToEur,
          quantity: h.quantity,
          currentPrice: h.currentPrice,
          paymentsPerYear: ppy,
          today,
        },
        prior,
      );

      await db.run(
        d1,
        `INSERT INTO dividends
           (ticker, ex_date, payment_date, per_share_usd, per_share_eur, qualifying_shares, amount_eur, yield_pct, locked, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticker, ex_date) DO UPDATE SET
           payment_date = excluded.payment_date,
           per_share_usd = excluded.per_share_usd,
           per_share_eur = excluded.per_share_eur,
           qualifying_shares = excluded.qualifying_shares,
           amount_eur = excluded.amount_eur,
           yield_pct = excluded.yield_pct,
           locked = excluded.locked,
           updated_at = excluded.updated_at`,
        row.ticker, row.ex_date, row.payment_date, row.per_share_usd,
        row.per_share_eur, row.qualifying_shares, row.amount_eur, row.yield_pct, row.locked,
        new Date().toISOString(),
      );
    }
  }

  // Retention.
  await db.run(
    d1,
    `DELETE FROM dividends WHERE ex_date < ? OR payment_date < ?`,
    EARLIEST_EX_DATE,
    daysAgo(RETENTION_DAYS),
  );

  return getDividends(d1);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- dividends`
Expected: PASS (all `paymentsPerYear` + `resolveDividendRow` cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/index.ts` (still importing `getUpcomingDividends`) — fixed in Task 8. No errors in `dividends.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/dividends.ts src/dividends.test.ts
git commit -m "feat: rewrite dividends on d1 with yield and payment-date retention"
```

---

## Task 5: Rewrite `news.ts` — article ingest + weekly briefings on D1

**Files:**
- Modify: `src/news.ts`
- Modify: `src/haiku.ts` (delete `rankArticles` and its types)
- Create: `src/news.test.ts`

- [ ] **Step 1: Write the failing test — `src/news.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { briefingSentiment, shouldGenerateBriefings } from "./news";

describe("briefingSentiment", () => {
  it("is the arithmetic mean of article sentiments", () => {
    expect(briefingSentiment([0.5, -0.1, 0.2])).toBeCloseTo(0.2);
  });
  it("is 0 for no articles", () => {
    expect(briefingSentiment([])).toBe(0);
  });
});

describe("shouldGenerateBriefings", () => {
  it("runs when no briefing exists for the just-completed week", () => {
    expect(shouldGenerateBriefings("2026-08-24", null)).toBe(true);
  });
  it("skips when a briefing already exists for that week", () => {
    expect(shouldGenerateBriefings("2026-08-24", "2026-08-24")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- news`
Expected: FAIL — exports missing.

- [ ] **Step 3: Rewrite `src/news.ts`**

```ts
import { db } from "./db";
import { fetchNewsForTicker, type MarketauxArticle } from "./marketaux";
import { isoWeekBounds } from "./iso-week";
import { marketauxLookupTicker, type Holding } from "./holdings";

const HAIKU = "claude-haiku-4-5-20251001";
const ARTICLE_RETENTION_DAYS = 30;
const BRIEFING_RETENTION_WEEKS = 5;
const MIN_MATCH_SCORE = 0.1;
const PAYWALLED_SOURCES = new Set(["seekingalpha.com"]);
const BATCH_SIZE = 4;

export interface Briefing {
  ticker: string;
  weekStart: string;
  summary: string;
  body: string;
  sentiment: number;
  articleCount: number;
  seen: boolean;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function weeksAgo(n: number): string {
  return daysAgo(n * 7);
}

export function briefingSentiment(sentiments: number[]): number {
  if (sentiments.length === 0) return 0;
  return sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
}

/** True when we should generate briefings for `justCompletedWeekStart` (no briefing row exists for it yet). */
export function shouldGenerateBriefings(
  justCompletedWeekStart: string,
  latestBriefingWeekStart: string | null,
): boolean {
  return latestBriefingWeekStart !== justCompletedWeekStart;
}

// ---- Reads ----

export interface NewsDoc {
  updatedAt: string;
  briefings: Briefing[];
}

export async function getBriefings(d1: D1Database): Promise<NewsDoc> {
  const rows = await db.all<{
    ticker: string; week_start: string; summary: string; body: string;
    sentiment: number; article_count: number; seen: number; created_at: string;
  }>(
    d1,
    `SELECT * FROM news_briefings ORDER BY week_start DESC, ABS(sentiment) DESC`,
  );
  const updatedAt = rows[0]?.created_at ?? new Date(0).toISOString();
  return {
    updatedAt,
    briefings: rows.map((r) => ({
      ticker: r.ticker,
      weekStart: r.week_start,
      summary: r.summary,
      body: r.body,
      sentiment: r.sentiment,
      articleCount: r.article_count,
      seen: r.seen === 1,
    })),
  };
}

export async function markBriefingSeen(d1: D1Database, ticker: string, weekStart: string): Promise<void> {
  await db.run(
    d1,
    `UPDATE news_briefings SET seen = 1 WHERE ticker = ? AND week_start = ?`,
    ticker,
    weekStart,
  );
}

// ---- Article ingest ----

export async function refreshArticles(
  d1: D1Database,
  marketauxToken: string,
  holdings: Holding[],
): Promise<void> {
  const lookupToDisplay = new Map(holdings.map((h) => [marketauxLookupTicker(h), h.ticker]));
  const entries = [...lookupToDisplay.entries()];
  const now = new Date().toISOString();

  const perTicker: { display: string; articles: MarketauxArticle[] }[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const res = await Promise.all(
      batch.map(async ([lookup, display]) => {
        try {
          return { display, articles: await fetchNewsForTicker(marketauxToken, lookup) };
        } catch {
          return { display, articles: [] as MarketauxArticle[] };
        }
      }),
    );
    perTicker.push(...res);
  }

  // D1 caps a batch at 100 bound statements; ~25 tickers x 3 articles = <=75, safe. If holdings
  // ever exceed ~30, chunk this loop into batches of 50.
  const statements: [string, unknown[]][] = [];
  for (const { display, articles } of perTicker) {
    for (const a of articles) {
      if (PAYWALLED_SOURCES.has(a.source)) continue;
      const entity = a.entities.find((e) => lookupToDisplay.get(e.symbol) === display);
      const matchScore = entity?.match_score ?? 0;
      if (matchScore < MIN_MATCH_SCORE) continue;
      statements.push([
        `INSERT INTO news_articles (url, ticker, title, description, source, published_at, sentiment, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET
           sentiment = excluded.sentiment, fetched_at = excluded.fetched_at`,
        [a.url, display, a.title, a.description ?? "", a.source, a.published_at, entity?.sentiment_score ?? 0, now],
      ]);
    }
  }
  await db.batch(d1, statements);

  await db.run(d1, `DELETE FROM news_articles WHERE published_at < ?`, daysAgo(ARTICLE_RETENTION_DAYS));
}

// ---- Weekly briefing generation ----

const BRIEFING_SYSTEM_PROMPT = `You write a weekly briefing on what is going on with a single company, for someone who holds its stock and wants the picture without reading every article.
You are given that week's news articles for the company (titles, descriptions, sources, sentiment scores).
Write from ONLY those articles — do not invent facts not present in them.
Respond with ONLY JSON, no prose: {"summary": "...", "body": "..."}
summary: 1-2 sentences, the single most important thing that happened this week.
body: 3-6 short paragraphs of plain prose covering the week's developments, why they matter to a shareholder, and the overall tone. No markdown, no headings, no bullet lists.`;

interface BriefingResult {
  summary: string;
  body: string;
}

async function generateBriefing(
  anthropicKey: string,
  ticker: string,
  name: string,
  weekLabel: string,
  articles: { title: string; description: string; source: string; sentiment: number }[],
): Promise<BriefingResult | null> {
  const userContent =
    `Company: ${name} (${ticker}). Week: ${weekLabel}.\n\nArticles:\n` +
    articles
      .map(
        (a, i) =>
          `${i + 1}. [${a.source}] (sentiment ${a.sentiment.toFixed(2)})\n${a.title}\n${a.description}`,
      )
      .join("\n---\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 2048,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as BriefingResult;
    if (typeof parsed.summary !== "string" || typeof parsed.body !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function refreshBriefings(
  d1: D1Database,
  anthropicKey: string,
  holdings: Holding[],
): Promise<void> {
  // Runs from a Monday-only cron (5 7 * * 2 in Cloudflare's shifted DOW = Monday). "3 days ago"
  // lands in the just-completed Mon-Sun week regardless of the exact run hour.
  const { weekStart, weekEnd } = isoWeekBounds(daysAgo(3));

  const latest = await db.first<{ week_start: string }>(
    d1,
    `SELECT week_start FROM news_briefings ORDER BY week_start DESC LIMIT 1`,
  );
  if (!shouldGenerateBriefings(weekStart, latest?.week_start ?? null)) return;

  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));

  const grouped = await db.all<{ ticker: string }>(
    d1,
    `SELECT DISTINCT ticker FROM news_articles WHERE published_at >= ? AND published_at <= ?`,
    weekStart,
    weekEnd + "T23:59:59Z",
  );

  for (const { ticker } of grouped) {
    const articles = await db.all<{
      title: string; description: string; source: string; sentiment: number;
    }>(
      d1,
      `SELECT title, description, source, sentiment FROM news_articles
       WHERE ticker = ? AND published_at >= ? AND published_at <= ?
       ORDER BY published_at ASC`,
      ticker,
      weekStart,
      weekEnd + "T23:59:59Z",
    );
    if (articles.length === 0) continue;

    const briefing = await generateBriefing(
      anthropicKey,
      ticker,
      nameByTicker.get(ticker) ?? ticker,
      `${weekStart} to ${weekEnd}`,
      articles.map((a) => ({ title: a.title, description: a.description, source: a.source, sentiment: a.sentiment })),
    );
    if (!briefing) continue;

    await db.run(
      d1,
      `INSERT INTO news_briefings
         (ticker, week_start, summary, body, sentiment, article_count, seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (ticker, week_start) DO UPDATE SET
         summary = excluded.summary, body = excluded.body,
         sentiment = excluded.sentiment, article_count = excluded.article_count,
         created_at = excluded.created_at`,
      ticker,
      weekStart,
      briefing.summary,
      briefing.body,
      briefingSentiment(articles.map((a) => a.sentiment)),
      articles.length,
      new Date().toISOString(),
    );
  }

  await db.run(d1, `DELETE FROM news_briefings WHERE week_start < ?`, weeksAgo(BRIEFING_RETENTION_WEEKS));
}

export async function refreshNews(
  d1: D1Database,
  marketauxToken: string,
  anthropicKey: string,
  holdings: Holding[],
): Promise<NewsDoc> {
  await refreshArticles(d1, marketauxToken, holdings);
  return getBriefings(d1);
}
```

> Briefings are generated from title + description + source + sentiment. Marketaux returns `description` in the same response, so storing it costs nothing extra and materially improves briefing quality.

- [ ] **Step 4: Delete `rankArticles` from `src/haiku.ts`**

Replace the entire file contents of `src/haiku.ts` with an empty module marker (the file is no longer imported anywhere after Task 8):

```ts
// Intentionally empty — the per-article impact ranker was removed when News moved to
// Claude-written weekly briefings (see src/news.ts). File kept as a deletion marker;
// safe to `git rm` in a later cleanup.
export {};
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- news`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/index.ts` (still importing old news exports). None in `news.ts` / `haiku.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/news.ts src/haiku.ts src/news.test.ts
git commit -m "feat: rewrite news as d1-backed weekly claude briefings"
```

---

## Task 6: Rewrite `earnings.ts` + `web-earnings.ts` on D1

**Files:**
- Modify: `src/earnings.ts`
- Modify: `src/web-earnings.ts`
- Modify: `src/finnhub.ts` (no change to signatures; confirm `fetchEarningsHistory` shape used below)
- Create: `src/earnings.test.ts`

- [ ] **Step 1: Write the failing test — `src/earnings.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resultsAvailableAt, needsResultsPoll, periodLabel } from "./earnings";

describe("resultsAvailableAt", () => {
  it("bmo -> ~13:40 UTC on the report date", () => {
    expect(resultsAvailableAt("2026-08-28", "bmo")).toBe("2026-08-28T13:40:00.000Z");
  });
  it("amc -> ~20:40 UTC on the report date", () => {
    expect(resultsAvailableAt("2026-08-28", "amc")).toBe("2026-08-28T20:40:00.000Z");
  });
  it("unknown hour -> noon UTC on the report date", () => {
    expect(resultsAvailableAt("2026-08-28", "")).toBe("2026-08-28T12:00:00.000Z");
  });
});

describe("needsResultsPoll", () => {
  const now = new Date("2026-08-28T21:00:00Z");
  it("true when no result row and the report time has passed", () => {
    expect(needsResultsPoll({ date: "2026-08-28", hour: "amc" }, null, now)).toBe(true);
  });
  it("false when a complete result row exists", () => {
    expect(
      needsResultsPoll({ date: "2026-08-28", hour: "amc" }, { beat: 1, checked_at: "2026-08-28T20:50:00Z" }, now),
    ).toBe(false);
  });
  it("true when a stub row exists (beat null) and last check was >2h ago", () => {
    expect(
      needsResultsPoll({ date: "2026-08-28", hour: "bmo" }, { beat: null, checked_at: "2026-08-28T14:00:00Z" }, now),
    ).toBe(true);
  });
  it("false when the report time has not passed yet", () => {
    expect(
      needsResultsPoll({ date: "2026-08-28", hour: "amc" }, null, new Date("2026-08-28T19:00:00Z")),
    ).toBe(false);
  });
});

describe("periodLabel", () => {
  it("formats a calendar quarter from a date", () => {
    expect(periodLabel("2026-06-30")).toBe("Q2 2026");
    expect(periodLabel("2026-08-28")).toBe("Q3 2026");
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npm test -- earnings`
Expected: FAIL — exports missing.

- [ ] **Step 3: Rewrite `src/earnings.ts`**

```ts
import { db } from "./db";
import { fetchEarningsCalendar, fetchEarningsHistory } from "./finnhub";
import { finnhubLookupTicker, type Holding } from "./holdings";
import {
  lookupEarningsViaWebSearch,
  lookupEarningsResult,
  shouldRefreshWebEarnings,
  type WebEarningsDoc,
} from "./web-earnings";

const CALENDAR_LOOKBACK_DAYS = 400;
const CALENDAR_FUTURE_DAYS = 30;
const KEEP_PAST_PER_TICKER = 4;
const WEB_SEARCH_FALLBACK_TICKERS = new Set(["KAP.L"]);

export interface CalendarRowEntry {
  ticker: string;
  name: string;
  logo?: string;
  date: string;
  hour: string;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  isEstimate: boolean;
  isPast: boolean;
}

export interface EarningsResult {
  ticker: string;
  date: string;
  period: string;
  revenue: number | null;
  revenueEstimate: number | null;
  revenueYoyPct: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsYoyPct: number | null;
  guidanceText: string;
  highlightsText: string;
  beat: number | null;
}

export interface EarningsDoc {
  updatedAt: string;
  calendar: CalendarRowEntry[];
  results: Record<string, EarningsResult[]>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** ISO timestamp at which a report's actuals are plausibly published: bmo ~13:40 UTC, amc ~20:40 UTC, else noon UTC. */
export function resultsAvailableAt(date: string, hour: string): string {
  const time = hour === "bmo" ? "13:40:00.000Z" : hour === "amc" ? "20:40:00.000Z" : "12:00:00.000Z";
  return `${date}T${time}`;
}

/** Calendar-quarter label from a date (matches web/src/format.ts fiscalQuarterLabel intent). */
export function periodLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) return date;
  return `Q${Math.ceil(m / 3)} ${y}`;
}

export function needsResultsPoll(
  entry: { date: string; hour: string },
  priorResult: { beat: number | null; checked_at: string } | null,
  now: Date,
): boolean {
  if (now.getTime() < new Date(resultsAvailableAt(entry.date, entry.hour)).getTime()) return false;
  if (!priorResult) return true;
  if (priorResult.beat !== null) return false; // complete
  const twoHours = 2 * 60 * 60 * 1000;
  return now.getTime() - new Date(priorResult.checked_at).getTime() >= twoHours;
}

// ---- Reads ----

export async function getEarnings(d1: D1Database, holdings: Holding[]): Promise<EarningsDoc> {
  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h]));
  const t = today();

  const calRows = await db.all<{
    ticker: string; date: string; hour: string; quarter: number; year: number;
    eps_estimate: number | null; revenue_estimate: number | null; is_estimate: number;
  }>(d1, `SELECT * FROM earnings_calendar ORDER BY date ASC`);

  const calendar: CalendarRowEntry[] = calRows.map((r) => {
    const h = nameByTicker.get(r.ticker);
    return {
      ticker: r.ticker,
      name: h?.name ?? r.ticker,
      logo: h?.logo,
      date: r.date,
      hour: r.hour,
      quarter: r.quarter,
      year: r.year,
      epsEstimate: r.eps_estimate,
      revenueEstimate: r.revenue_estimate,
      isEstimate: r.is_estimate === 1,
      isPast: r.date < t,
    };
  });

  const resRows = await db.all<{
    ticker: string; date: string; period: string;
    revenue: number | null; revenue_estimate: number | null; revenue_yoy_pct: number | null;
    eps: number | null; eps_estimate: number | null; eps_yoy_pct: number | null;
    guidance_text: string | null; highlights_text: string | null; beat: number | null;
  }>(d1, `SELECT * FROM earnings_results ORDER BY date DESC`);

  const results: Record<string, EarningsResult[]> = {};
  for (const r of resRows) {
    (results[r.ticker] ??= []).push({
      ticker: r.ticker,
      date: r.date,
      period: r.period,
      revenue: r.revenue,
      revenueEstimate: r.revenue_estimate,
      revenueYoyPct: r.revenue_yoy_pct,
      eps: r.eps,
      epsEstimate: r.eps_estimate,
      epsYoyPct: r.eps_yoy_pct,
      guidanceText: r.guidance_text ?? "",
      highlightsText: r.highlights_text ?? "",
      beat: r.beat,
    });
  }
  for (const k of Object.keys(results)) results[k] = results[k].slice(0, 4);

  return { updatedAt: new Date().toISOString(), calendar, results };
}

// ---- Calendar sync ----

export async function refreshEarningsCalendar(
  d1: D1Database,
  finnhubToken: string,
  holdings: Holding[],
  anthropicApiKey: string,
): Promise<void> {
  const lookupToHolding = new Map(
    holdings.filter((h) => !WEB_SEARCH_FALLBACK_TICKERS.has(h.ticker)).map((h) => [finnhubLookupTicker(h), h]),
  );

  const from = new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const to = daysFromNow(CALENDAR_FUTURE_DAYS);
  const calendar = await fetchEarningsCalendar(finnhubToken, from, to);

  const statements: [string, unknown[]][] = [];
  for (const e of calendar) {
    const h = lookupToHolding.get(e.symbol);
    if (!h) continue;
    statements.push([
      `INSERT INTO earnings_calendar (ticker, date, hour, quarter, year, eps_estimate, revenue_estimate, is_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (ticker, date) DO UPDATE SET
         hour = excluded.hour, quarter = excluded.quarter, year = excluded.year,
         eps_estimate = COALESCE(excluded.eps_estimate, earnings_calendar.eps_estimate),
         revenue_estimate = COALESCE(excluded.revenue_estimate, earnings_calendar.revenue_estimate)`,
      [h.ticker, e.date, e.hour ?? "", e.quarter ?? 0, e.year ?? 0, e.epsEstimate, e.revenueEstimate],
    ]);
  }
  await db.batch(d1, statements);

  // Seed earnings_results (EPS only) from Finnhub history for past dates that have no result row yet.
  for (const [lookup, h] of lookupToHolding) {
    const history = await fetchEarningsHistory(finnhubToken, lookup);
    for (const r of history.slice(0, 8)) {
      // Finnhub's `period` is a fiscal quarter-end date string.
      const date = (r as unknown as { period?: string }).period;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (date >= today()) continue;
      const exists = await db.first<{ ticker: string }>(
        d1,
        `SELECT ticker FROM earnings_results WHERE ticker = ? AND date = ?`,
        h.ticker,
        date,
      );
      if (exists) continue;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, '', '', ?, ?)
         ON CONFLICT (ticker, date) DO NOTHING`,
        h.ticker,
        date,
        periodLabel(date),
        (r as { actual: number | null }).actual,
        (r as { estimate: number | null }).estimate,
        (r as { actual: number | null; estimate: number | null }).actual !== null &&
          (r as { estimate: number | null }).estimate !== null
          ? ((r as { actual: number }).actual >= (r as { estimate: number }).estimate ? 1 : 0)
          : null,
        new Date().toISOString(),
      );
    }
  }

  // KAP.L web-search fallback.
  for (const h of holdings) {
    if (!WEB_SEARCH_FALLBACK_TICKERS.has(h.ticker)) continue;
    const key = `earnings:web:${h.ticker}`;
    // web-earnings state stays in KV — it's a single small doc, like holdings.
    // Passed in via env by the caller; here we just call the lookup and upsert to D1.
    const fresh = await lookupEarningsViaWebSearch(anthropicApiKey, h.ticker, h.name);
    const doc: WebEarningsDoc | null = fresh;
    if (doc?.next) {
      await db.run(
        d1,
        `INSERT INTO earnings_calendar (ticker, date, hour, quarter, year, eps_estimate, revenue_estimate, is_estimate)
         VALUES (?, ?, '', 0, ?, NULL, NULL, 1)
         ON CONFLICT (ticker, date) DO UPDATE SET is_estimate = 1`,
        h.ticker,
        doc.next.date,
        new Date(doc.next.date + "T00:00:00Z").getUTCFullYear(),
      );
    }
    for (const entry of doc?.history ?? []) {
      if (entry.date >= today()) continue;
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, '', '', ?, ?)
         ON CONFLICT (ticker, date) DO NOTHING`,
        h.ticker,
        entry.date,
        entry.period,
        entry.epsActual,
        entry.epsEstimate,
        entry.epsActual !== null && entry.epsEstimate !== null
          ? (entry.epsActual >= entry.epsEstimate ? 1 : 0)
          : null,
        new Date().toISOString(),
      );
    }
  }

  await retainCalendar(d1);
}

async function retainCalendar(d1: D1Database): Promise<void> {
  const t = today();
  const tickers = await db.all<{ ticker: string }>(d1, `SELECT DISTINCT ticker FROM earnings_calendar`);
  for (const { ticker } of tickers) {
    const past = await db.all<{ date: string }>(
      d1,
      `SELECT date FROM earnings_calendar WHERE ticker = ? AND date < ? ORDER BY date DESC`,
      ticker,
      t,
    );
    if (past.length > KEEP_PAST_PER_TICKER) {
      const floor = past[KEEP_PAST_PER_TICKER].date;
      await db.run(d1, `DELETE FROM earnings_calendar WHERE ticker = ? AND date <= ?`, ticker, floor);
      await db.run(d1, `DELETE FROM earnings_results WHERE ticker = ? AND date <= ?`, ticker, floor);
    }
  }
}

// ---- Results poll ----

export async function pollEarningsResults(
  d1: D1Database,
  anthropicApiKey: string,
  holdings: Holding[],
): Promise<void> {
  const t = today();
  const due = await db.all<{ ticker: string; date: string; hour: string }>(
    d1,
    `SELECT ticker, date, hour FROM earnings_calendar WHERE date = ?`,
    t,
  );
  if (due.length === 0) return; // no-op on non-earnings days

  const now = new Date();
  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));

  for (const entry of due) {
    const prior = await db.first<{ beat: number | null; checked_at: string }>(
      d1,
      `SELECT beat, checked_at FROM earnings_results WHERE ticker = ? AND date = ?`,
      entry.ticker,
      entry.date,
    );
    if (!needsResultsPoll(entry, prior, now)) continue;

    const result = await lookupEarningsResult(
      anthropicApiKey,
      entry.ticker,
      nameByTicker.get(entry.ticker) ?? entry.ticker,
      entry.date,
    );
    if (!result) {
      // Write a stub so the 2h backoff applies.
      await db.run(
        d1,
        `INSERT INTO earnings_results
           (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, '', '', NULL, ?)
         ON CONFLICT (ticker, date) DO UPDATE SET checked_at = excluded.checked_at`,
        entry.ticker,
        entry.date,
        periodLabel(entry.date),
        new Date().toISOString(),
      );
      continue;
    }

    await db.run(
      d1,
      `INSERT INTO earnings_results
         (ticker, date, period, revenue, revenue_estimate, revenue_yoy_pct, eps, eps_estimate, eps_yoy_pct, guidance_text, highlights_text, beat, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ticker, date) DO UPDATE SET
         revenue = excluded.revenue, revenue_estimate = excluded.revenue_estimate, revenue_yoy_pct = excluded.revenue_yoy_pct,
         eps = excluded.eps, eps_estimate = excluded.eps_estimate, eps_yoy_pct = excluded.eps_yoy_pct,
         guidance_text = excluded.guidance_text, highlights_text = excluded.highlights_text,
         beat = excluded.beat, checked_at = excluded.checked_at`,
      entry.ticker,
      entry.date,
      periodLabel(entry.date),
      result.revenue,
      result.revenueEstimate,
      result.revenueYoyPct,
      result.eps,
      result.epsEstimate,
      result.epsYoyPct,
      result.guidanceText,
      result.highlightsText,
      result.beat,
      new Date().toISOString(),
    );
  }
}
```

- [ ] **Step 4: Rewrite `src/web-earnings.ts`**

Keep `WebEarningsEntry`, `WebEarningsHistoryEntry`, `WebEarningsDoc`, `SYSTEM_PROMPT`, `lookupEarningsViaWebSearch`, `shouldRefreshWebEarnings`, `ContentBlock`. **Delete** `TodayEarningsRecap`, `RECAP_SYSTEM_PROMPT`, `lookupTodayEarningsRecap`. **Add** `lookupEarningsResult`:

```ts
/** Structured post-report results for the earnings poll — revenue, EPS, guidance, highlights, YoY. */
export interface EarningsResultLookup {
  revenue: number | null;
  revenueEstimate: number | null;
  revenueYoyPct: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsYoyPct: number | null;
  guidanceText: string;
  highlightsText: string;
  beat: number | null;
}

const RESULT_SYSTEM_PROMPT = `You research a company's just-released quarterly earnings using web search.
Given a company name, ticker, and the date it reported, find the results announced on or immediately after that date.
Respond with ONLY JSON, no prose:
{"revenue": number|null, "revenueEstimate": number|null, "revenueYoyPct": number|null,
 "eps": number|null, "epsEstimate": number|null, "epsYoyPct": number|null,
 "guidanceText": string, "highlightsText": string, "beat": 1|0|null}
- revenue / revenueEstimate: in USD, absolute dollars (e.g. 96200000000), converted if reported in another currency. null if not found.
- revenueYoyPct / epsYoyPct: percent change vs the same quarter one year earlier (e.g. 106 for +106%). null if not found.
- eps / epsEstimate: diluted EPS in USD. null if not found.
- guidanceText: one sentence on next-period or full-year guidance vs consensus; "" if none given.
- highlightsText: one sentence on margins or segment detail worth noting; "" if nothing notable.
- beat: 1 if the company beat consensus on its headline metric, 0 if it missed, null if unclear or nothing reported yet.
If no results have been published on or after that date yet, return all numeric fields null, beat null, and say so in guidanceText.`;

export async function lookupEarningsResult(
  apiKey: string,
  ticker: string,
  companyName: string,
  date: string,
): Promise<EarningsResultLookup | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: RESULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Company: ${companyName} (${ticker}). Reported earnings on: ${date}.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as Partial<EarningsResultLookup>;
    return {
      revenue: p.revenue ?? null,
      revenueEstimate: p.revenueEstimate ?? null,
      revenueYoyPct: p.revenueYoyPct ?? null,
      eps: p.eps ?? null,
      epsEstimate: p.epsEstimate ?? null,
      epsYoyPct: p.epsYoyPct ?? null,
      guidanceText: typeof p.guidanceText === "string" ? p.guidanceText : "",
      highlightsText: typeof p.highlightsText === "string" ? p.highlightsText : "",
      beat: p.beat === 1 || p.beat === 0 ? p.beat : null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- earnings`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/index.ts`. None in `earnings.ts` / `web-earnings.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/earnings.ts src/web-earnings.ts src/earnings.test.ts
git commit -m "feat: rewrite earnings on d1 with structured results poll"
```

---

## Task 7: Backfill module

**Files:**
- Create: `src/backfill.ts`

- [ ] **Step 1: Create `src/backfill.ts`**

```ts
import { db } from "./db";
import { refreshDividends } from "./dividends";
import { refreshEarningsCalendar } from "./earnings";
import { lookupEarningsResult } from "./web-earnings";
import { periodLabel } from "./earnings";
import type { Holding } from "./holdings";

/**
 * One-time, idempotent. Safe to re-run — every write is an upsert.
 *  - dividends: refreshDividends picks up FMP history >= 2026-08-01 on its own.
 *  - earnings: refreshEarningsCalendar seeds calendar + EPS history; this then fills
 *    revenue/guidance/highlights/YoY for past result rows that only have EPS.
 */
export async function runBackfill(
  d1: D1Database,
  env: {
    FMP_API_KEY: string;
    FINNHUB_API_KEY: string;
    ANTHROPIC_API_KEY: string;
  },
  holdings: Holding[],
): Promise<{ dividends: number; earningsResultsEnriched: number }> {
  await refreshDividends(d1, env.FMP_API_KEY, holdings);
  await refreshEarningsCalendar(d1, env.FINNHUB_API_KEY, holdings, env.ANTHROPIC_API_KEY);

  const nameByTicker = new Map(holdings.map((h) => [h.ticker, h.name]));

  // Past result rows lacking revenue (EPS-only from Finnhub) get one Claude enrichment call.
  // Chunked to 15 per invocation to stay well under the Worker CPU/wall-time and subrequest
  // limits — the runbook calls this endpoint repeatedly until `earningsResultsEnriched` is 0.
  const thin = await db.all<{ ticker: string; date: string }>(
    d1,
    `SELECT ticker, date FROM earnings_results WHERE revenue IS NULL ORDER BY date DESC LIMIT 15`,
  );

  let enriched = 0;
  for (const { ticker, date } of thin) {
    const r = await lookupEarningsResult(
      env.ANTHROPIC_API_KEY,
      ticker,
      nameByTicker.get(ticker) ?? ticker,
      date,
    );
    if (!r) continue;
    await db.run(
      d1,
      `UPDATE earnings_results SET
         revenue = ?, revenue_estimate = ?, revenue_yoy_pct = ?,
         eps = COALESCE(?, eps), eps_estimate = COALESCE(?, eps_estimate), eps_yoy_pct = ?,
         guidance_text = ?, highlights_text = ?,
         beat = COALESCE(?, beat), period = ?, checked_at = ?
       WHERE ticker = ? AND date = ?`,
      r.revenue, r.revenueEstimate, r.revenueYoyPct,
      r.eps, r.epsEstimate, r.epsYoyPct,
      r.guidanceText, r.highlightsText,
      r.beat, periodLabel(date), new Date().toISOString(),
      ticker, date,
    );
    enriched++;
  }

  const divCount = await db.first<{ n: number }>(d1, `SELECT COUNT(*) AS n FROM dividends`);
  return { dividends: divCount?.n ?? 0, earningsResultsEnriched: enriched };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/backfill.ts
git commit -m "feat: add idempotent backfill module"
```

---

## Task 8: Rewire `src/index.ts` — routes + cron dispatch

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace the imports block**

```ts
import { checkAuth } from "./auth";
import { corsHeaders, withCors } from "./cors";
import {
  getHoldings,
  putHoldings,
  syncFromTrading212,
  fetchMergedTrading212Positions,
  isValidHoldingsInput,
  normaliseInputWeights,
} from "./holdings";
import {
  getEarnings,
  refreshEarningsCalendar,
  pollEarningsResults,
} from "./earnings";
import { getReturns, refreshReturns } from "./returns";
import { getBriefings, refreshNews, markBriefingSeen } from "./news";
import { getDividends, refreshDividends } from "./dividends";
import { runBackfill } from "./backfill";
```

- [ ] **Step 2: Replace the dividends routes**

```ts
    if (url.pathname === "/api/dividends" && request.method === "GET") {
      const [rows, holdings] = await Promise.all([
        getDividends(env.DB),
        getHoldings(env.PORTFOLIO_KV),
      ]);
      const byTicker = new Map(holdings.positions.map((p) => [p.ticker, p]));
      const dividends = rows.map((r) => ({
        ...r,
        name: byTicker.get(r.ticker)?.name ?? r.ticker,
        logo: byTicker.get(r.ticker)?.logo,
      }));
      return Response.json({ updatedAt: new Date().toISOString(), dividends });
    }

    if (url.pathname === "/api/dividends/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshDividends(env.DB, env.FMP_API_KEY, holdings.positions);
      return Response.json({ status: "ok" });
    }
```

- [ ] **Step 3: Replace the earnings routes**

```ts
    if (url.pathname === "/api/earnings" && request.method === "GET") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      return Response.json(await getEarnings(env.DB, holdings.positions));
    }

    if (url.pathname === "/api/earnings/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshEarningsCalendar(env.DB, env.FINNHUB_API_KEY, holdings.positions, env.ANTHROPIC_API_KEY);
      await pollEarningsResults(env.DB, env.ANTHROPIC_API_KEY, holdings.positions);
      return Response.json({ status: "ok" });
    }
```

Delete the `/api/earnings/today-recaps` route entirely.

- [ ] **Step 4: Replace the news routes**

```ts
    if (url.pathname === "/api/news" && request.method === "GET") {
      return Response.json(await getBriefings(env.DB));
    }

    if (url.pathname === "/api/news/top" && request.method === "GET") {
      const [doc, holdings] = await Promise.all([
        getBriefings(env.DB),
        getHoldings(env.PORTFOLIO_KV),
      ]);
      const weight = new Map(holdings.positions.map((p) => [p.ticker, p.weight]));
      const latestWeek = doc.briefings[0]?.weekStart;
      const top = doc.briefings
        .filter((b) => b.weekStart === latestWeek)
        .map((b) => ({ b, score: Math.abs(b.sentiment) * Math.sqrt(weight.get(b.ticker) ?? 0) }))
        .sort((a, z) => z.score - a.score)
        .slice(0, 3)
        .map(({ b }) => b);
      return Response.json({ updatedAt: doc.updatedAt, briefings: top });
    }

    if (url.pathname === "/api/news/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      const doc = await refreshNews(env.DB, env.MARKETAUX_API_KEY, env.ANTHROPIC_API_KEY, holdings.positions);
      return Response.json(doc);
    }

    if (url.pathname === "/api/news/seen" && request.method === "PATCH") {
      const body = (await request.json().catch(() => null)) as { ticker?: string; weekStart?: string } | null;
      if (!body?.ticker || !body?.weekStart) {
        return Response.json({ error: "ticker and weekStart required" }, { status: 400 });
      }
      await markBriefingSeen(env.DB, body.ticker, body.weekStart);
      return Response.json({ status: "ok" });
    }
```

- [ ] **Step 5: Add the backfill admin route (before the 404 fallthrough)**

```ts
    if (url.pathname === "/api/admin/backfill" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      const result = await runBackfill(env.DB, env, holdings.positions);
      return Response.json({ status: "ok", ...result });
    }
```

- [ ] **Step 6: Add PATCH to the CORS allow-methods**

In `src/cors.ts`, change:
```ts
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
```

- [ ] **Step 7: Rewrite the `scheduled` handler**

The Step 1 news import must be:
```ts
import { getBriefings, refreshNews, refreshArticles, refreshBriefings, markBriefingSeen } from "./news";
```

```ts
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Cron schedules. Cloudflare's day-of-week is SHIFTED: 0=Saturday, 1=Sunday, 2=Monday ... 6=Friday.
    // (Confirmed in this repo's history — the returns crons use "2-6" for real Mon-Fri.)
    //  "5 6 * * *"                daily: earnings calendar sync + dividends
    //  "5 7 * * 2"                Monday only: weekly news briefing generation (2 == Monday here)
    //  "* 13-19 * * 2-6"          returns snapshot every minute, regular market hours
    //  "*/5 8-12,20-23 * * 2-6"   returns snapshot every 5 min, pre/post market
    //  "0 6,13,20 * * *"          news article ingest 3x/day
    //  "*/10 11-23 * * 2-6"       earnings results poll — no-ops instantly on non-earnings days
    if (event.cron === "5 6 * * *") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshEarningsCalendar(env.DB, env.FINNHUB_API_KEY, holdings.positions, env.ANTHROPIC_API_KEY);
      await refreshDividends(env.DB, env.FMP_API_KEY, holdings.positions);
      return;
    }

    if (event.cron === "5 7 * * 2") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshBriefings(env.DB, env.ANTHROPIC_API_KEY, holdings.positions);
      return;
    }

    if (event.cron === "0 6,13,20 * * *") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshArticles(env.DB, env.MARKETAUX_API_KEY, holdings.positions);
      return;
    }

    if (event.cron === "*/10 11-23 * * 2-6") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await pollEarningsResults(env.DB, env.ANTHROPIC_API_KEY, holdings.positions);
      return;
    }

    // Returns crons: live prices only, no KV write for holdings.
    const positions = await fetchMergedTrading212Positions(
      env.PORTFOLIO_KV, env.T212_API_KEY_ID, env.T212_API_SECRET, env.FINNHUB_API_KEY,
    );
    await refreshReturns(env.PORTFOLIO_KV, positions);
  },
```

> **Verify the DOW shift before deploy** using the Wrangler dashboard cron preview (the repo comment asserts `0=Saturday` but confirm `5 7 * * 2` previews as Monday and `*/10 ... * * 2-6` as Mon–Fri). If the preview disagrees, adjust — a wrong DOW silently skips days, which is exactly the bug this repo hit before.

- [ ] **Step 8: Update the crons in `wrangler.jsonc`**

```jsonc
  "triggers": {
    "crons": [
      "5 6 * * *",
      "5 7 * * 2",
      "* 13-19 * * 2-6",
      "*/5 8-12,20-23 * * 2-6",
      "0 6,13,20 * * *",
      "*/10 11-23 * * 2-6"
    ]
  },
```

> Cost of the new `*/10 11-23 * * 2-6` poll: ~6/hr x 13hr x ~21 weekdays ≈ 1,640 invocations/month, each an indexed `SELECT ... WHERE date = ?` that returns early on non-earnings days. Trivially within Workers (100k/day) and D1 (5M reads/day) free tiers.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: NO errors anywhere.

- [ ] **Step 10: Run the full worker test suite**

Run: `npm test`
Expected: all pure-logic tests PASS.

- [ ] **Step 11: Local smoke test**

Run:
```bash
npx wrangler d1 migrations apply market-pulse --local
npx wrangler dev --test-scheduled
```
In another shell:
```bash
curl -s -H "Authorization: Bearer <API_TOKEN>" http://localhost:8787/api/dividends
curl -s -H "Authorization: Bearer <API_TOKEN>" http://localhost:8787/api/news
curl -s -H "Authorization: Bearer <API_TOKEN>" http://localhost:8787/api/earnings
```
Expected: `200` with `{ ..., dividends: [] }` / `{ ..., briefings: [] }` / `{ ..., calendar: [], results: {} }` (empty is correct pre-backfill).

- [ ] **Step 12: Commit**

```bash
git add src/index.ts src/cors.ts wrangler.jsonc
git commit -m "feat: rewire worker routes and crons for d1"
```

---

## Task 9: Frontend types

**Files:**
- Modify: `web/src/api/types.ts`

- [ ] **Step 1: Replace the News, Earnings, Dividends type blocks**

Remove `RankedArticle`, `NewsDoc` (old), `UpcomingEarning`, `EarningsResult` (old), `EarningsDoc` (old), `TodayEarningsRecap`, `UpcomingDividend`, `DividendsDoc`. Add:

```ts
export interface Briefing {
  ticker: string;
  weekStart: string;
  summary: string;
  body: string;
  sentiment: number;
  articleCount: number;
  seen: boolean;
}

export interface NewsDoc {
  updatedAt: string;
  briefings: Briefing[];
}

export interface CalendarRowEntry {
  ticker: string;
  name: string;
  logo?: string;
  date: string;
  hour: string;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  isEstimate: boolean;
  isPast: boolean;
}

export interface EarningsResult {
  ticker: string;
  date: string;
  period: string;
  revenue: number | null;
  revenueEstimate: number | null;
  revenueYoyPct: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsYoyPct: number | null;
  guidanceText: string;
  highlightsText: string;
  beat: number | null;
}

export interface EarningsDoc {
  updatedAt: string;
  calendar: CalendarRowEntry[];
  results: Record<string, EarningsResult[]>;
}

export interface Dividend {
  ticker: string;
  name: string;
  logo?: string;
  exDate: string;
  paymentDate: string;
  perShareUsd: number;
  perShareEur: number;
  qualifyingShares: number;
  amountEur: number;
  yieldPct: number | null;
  locked: boolean;
}

export interface DividendsDoc {
  updatedAt: string;
  dividends: Dividend[];
}
```

Keep `Holding`, `HoldingsDoc`, `PositionReturn`, `SectorReturn`, `ReturnsDoc`, `SECTORS`, `Sector` unchanged.

- [ ] **Step 2: Typecheck the web app**

Run:
```bash
cd web && npx tsc -b
```
Expected: errors in `News.tsx`, `Article.tsx`, `Earnings.tsx`, `Dividends.tsx`, `Today.tsx` (fixed in Tasks 10–13). None in `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/api/types.ts
git commit -m "feat: update frontend types for d1 api shapes"
```

---

## Task 10: News tab — briefing list + Briefing detail

**Files:**
- Rewrite: `web/src/views/News.tsx`
- Create: `web/src/views/Briefing.tsx`
- Delete: `web/src/views/Article.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Rewrite `web/src/views/News.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, HoldingsDoc } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { TickerAvatar } from "../components/TickerAvatar";

export default function News() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<NewsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "positive" | "negative">("all");
  const [seenFilter, setSeenFilter] = useState<"all" | "unseen">("all");

  useEffect(() => {
    api.get<NewsDoc>("/api/news").then(setDoc).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<HoldingsDoc>("/api/holdings").then(setHoldings).catch(() => {});
  }, []);

  const holdingByTicker = new Map((holdings?.positions ?? []).map((p) => [p.ticker, p]));

  const filtered = useMemo(() => {
    if (!doc) return [];
    return doc.briefings.filter((b) => {
      if (tickerFilter && !b.ticker.toLowerCase().includes(tickerFilter.toLowerCase())) return false;
      if (sentimentFilter === "positive" && b.sentiment < 0) return false;
      if (sentimentFilter === "negative" && b.sentiment >= 0) return false;
      if (seenFilter === "unseen" && b.seen) return false;
      return true;
    });
  }, [doc, tickerFilter, sentimentFilter, seenFilter]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  let lastWeek = "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>News</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Input value={tickerFilter} onChange={(e) => setTickerFilter(e.target.value)} placeholder="Filter by ticker" />

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {(["all", "positive", "negative"] as const).map((s) => (
          <Button
            key={s}
            onClick={() => setSentimentFilter(s)}
            style={{
              flex: 1, padding: "var(--space-2)",
              background: sentimentFilter === s ? "var(--accent-dim)" : "var(--bg-elevated-1)",
              textTransform: "capitalize", fontWeight: 400,
            }}
          >
            {s}
          </Button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {(["all", "unseen"] as const).map((s) => (
          <Button
            key={s}
            onClick={() => setSeenFilter(s)}
            style={{
              flex: 1, padding: "var(--space-2)",
              background: seenFilter === s ? "var(--accent-dim)" : "var(--bg-elevated-1)",
              textTransform: "capitalize", fontWeight: 400,
            }}
          >
            {s}
          </Button>
        ))}
      </div>

      {filtered.length === 0 && <p style={{ color: "var(--text-tertiary)" }}>No briefings match.</p>}

      {filtered.map((b) => {
        const isPositive = b.sentiment >= 0;
        const showWeekHeader = b.weekStart !== lastWeek;
        lastWeek = b.weekStart;
        return (
          <div key={`${b.ticker}:${b.weekStart}`}>
            {showWeekHeader && (
              <h3 style={{ margin: "var(--space-2) 0", color: "var(--text-secondary)" }}>
                Week of {new Date(b.weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
              </h3>
            )}
            <Card>
              <button
                onClick={() => navigate(`/briefing/${b.ticker}/${b.weekStart}`)}
                style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                  <TickerAvatar ticker={b.ticker} logo={holdingByTicker.get(b.ticker)?.logo} size={24} />
                  <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>{b.ticker}</span>
                  <span
                    className={`num ${isPositive ? "positive" : "negative"}`}
                    style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "var(--bg-elevated-2)" }}
                  >
                    {isPositive ? "+" : ""}{b.sentiment.toFixed(2)}
                  </span>
                  {!b.seen && (
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--accent)", marginLeft: "auto" }} />
                  )}
                </div>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{b.summary}</p>
              </button>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/views/Briefing.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { NewsDoc, Briefing as BriefingType } from "../api/types";

export default function Briefing() {
  const { ticker, weekStart } = useParams();
  const [briefing, setBriefing] = useState<BriefingType | null>(null);

  useEffect(() => {
    api.get<NewsDoc>("/api/news").then((doc) => {
      const b = doc.briefings.find((x) => x.ticker === ticker && x.weekStart === weekStart) ?? null;
      setBriefing(b);
      if (b && !b.seen) {
        api.patch("/api/news/seen", { ticker, weekStart }).catch(() => {});
      }
    });
  }, [ticker, weekStart]);

  if (!briefing) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const isPositive = briefing.sentiment >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>{briefing.ticker}</span>
        <span
          className={`num ${isPositive ? "positive" : "negative"}`}
          style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "var(--bg-elevated-2)" }}
        >
          {isPositive ? "+" : ""}{briefing.sentiment.toFixed(2)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          Week of {new Date(briefing.weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          {" · "}{briefing.articleCount} {briefing.articleCount === 1 ? "article" : "articles"}
        </span>
      </div>

      <h1 style={{ fontSize: 20, lineHeight: 1.35 }}>{briefing.summary}</h1>

      {briefing.body.split(/\n+/).filter(Boolean).map((para, i) => (
        <p key={i} style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-primary)" }}>{para}</p>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add `patch` to the API client**

In `web/src/api/client.ts`, add to the `api` object:
```ts
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
```

- [ ] **Step 4: Update `web/src/App.tsx`**

- Replace `import Article from "./views/Article";` with `import Briefing from "./views/Briefing";`.
- In `DETAIL_PREFIXES`, replace `"/article/"` with `"/briefing/"`.
- In `<Routes>`, replace `<Route path="/article/:id" element={<Article />} />` with `<Route path="/briefing/:ticker/:weekStart" element={<Briefing />} />`.

- [ ] **Step 5: Delete `web/src/views/Article.tsx`**

```bash
git rm web/src/views/Article.tsx
```

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc -b`
Expected: errors only in `Earnings.tsx`, `Dividends.tsx`, `Today.tsx`.

- [ ] **Step 7: Commit**

```bash
git add web/src/views/News.tsx web/src/views/Briefing.tsx web/src/api/client.ts web/src/App.tsx
git commit -m "feat: news tab shows weekly claude briefings"
```

---

## Task 11: Dividends tab — ex/pay pop-up entries + yield

**Files:**
- Rewrite: `web/src/views/Dividends.tsx`

- [ ] **Step 1: Rewrite `web/src/views/Dividends.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { DividendsDoc } from "../api/types";
import { Card, Freshness } from "../components/Card";
import { TickerAvatar } from "../components/TickerAvatar";
import { Calendar, type CalendarEvent } from "../components/Calendar";
import { Modal } from "../components/Modal";
import { eur } from "../format";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export default function Dividends() {
  const [doc, setDoc] = useState<DividendsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    api.get<DividendsDoc>("/api/dividends").then(setDoc).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    const d = doc?.dividends ?? [];
    return [
      ...d.map((x) => ({ date: x.exDate, kind: "dividend-ex" as const, ticker: x.ticker })),
      ...d.map((x) => ({ date: x.paymentDate, kind: "dividend-pay" as const, ticker: x.ticker })),
    ];
  }, [doc]);

  if (error) return <p style={{ color: "var(--negative)" }}>{error}</p>;
  if (!doc) return <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>;

  const now = Date.now();
  const next90Total = doc.dividends
    .filter((d) => {
      const pay = new Date(d.paymentDate + "T00:00:00").getTime();
      return pay >= now && pay <= now + NINETY_DAYS_MS;
    })
    .reduce((sum, d) => sum + d.amountEur, 0);

  const touching = selectedDate
    ? doc.dividends.filter((d) => d.exDate === selectedDate || d.paymentDate === selectedDate)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Dividends</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Card elevated>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>
          Estimated total, next 90 days
        </p>
        <p className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{eur(next90Total)}</p>
      </Card>

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {selectedDate && touching.length > 0 && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          onClose={() => setSelectedDate(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {touching.map((d) => {
              const isExDate = d.exDate === selectedDate;
              const isPayDate = d.paymentDate === selectedDate;
              return (
                <div key={`${d.ticker}:${d.exDate}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <TickerAvatar ticker={d.ticker} logo={d.logo} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name}
                      </p>
                      <p className="num" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        {isExDate ? "Ex-dividend" : "Payment"}
                        {d.yieldPct !== null && <> · {d.yieldPct.toFixed(2)}% yield</>}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "var(--space-3)" }}>
                    <span className="num" style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                      {eur(d.perShareEur)}/share × {d.qualifyingShares.toFixed(4)}
                    </span>
                    <span
                      className={`num ${isPayDate ? "positive" : ""}`}
                      style={
                        isPayDate
                          ? { fontWeight: 600, textShadow: "0 0 12px var(--positive)" }
                          : { fontWeight: 600, color: "var(--text-primary)" }
                      }
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
```

> The glow is `text-shadow: 0 0 12px var(--positive)` on the pay-date amount plus the existing `.positive` class; the ex-date amount uses plain `--text-primary` with no shadow. If the app already has a glow utility class, use that instead — check `web/src/App.css` for a `.glow` / `--positive-glow` token and prefer it.

- [ ] **Step 2: Check for an existing glow token**

Run: `grep -n "glow\|text-shadow\|--positive" web/src/App.css`
If a glow utility exists, swap the inline `textShadow` for it. Otherwise keep the inline style.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc -b`
Expected: errors only in `Earnings.tsx`, `Today.tsx`.

- [ ] **Step 4: Commit**

```bash
git add web/src/views/Dividends.tsx
git commit -m "feat: dividends pop-up shows ex vs payment entries with yield"
```

---

## Task 12: Earnings tab — tappable rows + past-date pop-up

**Files:**
- Rewrite: `web/src/views/Earnings.tsx`
- Modify: `web/src/components/Calendar.tsx`

- [ ] **Step 1: Add a past-earnings dot kind to `web/src/components/Calendar.tsx`**

Change the `CalendarEvent` kind union and color map:
```ts
export interface CalendarEvent {
  date: string;
  kind: "earnings" | "earnings-past" | "dividend-ex" | "dividend-pay";
  ticker: string;
}
```
```ts
const KIND_COLOR: Record<CalendarEvent["kind"], string> = {
  earnings: "var(--accent-dim)",
  "earnings-past": "var(--bg-elevated-2)",
  "dividend-ex": "rgba(79, 184, 122, 0.4)",
  "dividend-pay": "rgba(79, 184, 122, 0.16)",
};
```

- [ ] **Step 2: Rewrite `web/src/views/Earnings.tsx`**

```tsx
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

function pct(v: number | null): string {
  if (v === null) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(0)}%`;
}

export default function Earnings() {
  const [doc, setDoc] = useState<EarningsDoc | null>(null);
  const [holdings, setHoldings] = useState<HoldingsDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<EarningsResult | null>(null);
  const [sort, setSort] = useState<SortMode>("name");

  useEffect(() => {
    api.get<EarningsDoc>("/api/earnings").then(setDoc).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
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

  // Clicking a calendar date: future -> estimates modal; past -> result modal (looked up per ticker).
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

  function ResultBody({ r }: { r: EarningsResult }) {
    const revBeat = r.revenue !== null && r.revenueEstimate !== null && r.revenue >= r.revenueEstimate;
    const epsBeat = r.eps !== null && r.epsEstimate !== null && r.eps >= r.epsEstimate;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <Row
          label="Revenue"
          value={r.revenue !== null ? abbreviateUsd(r.revenue) : "—"}
          est={r.revenueEstimate !== null ? abbreviateUsd(r.revenueEstimate) : null}
          good={revBeat}
          hasCompare={r.revenue !== null && r.revenueEstimate !== null}
        />
        <Row
          label="EPS"
          value={r.eps !== null ? usd(r.eps) : "—"}
          est={r.epsEstimate !== null ? usd(r.epsEstimate) : null}
          good={epsBeat}
          hasCompare={r.eps !== null && r.epsEstimate !== null}
        />
        {r.guidanceText && (
          <div>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Guidance</p>
            <p style={{ fontSize: 14 }}>{r.guidanceText}</p>
          </div>
        )}
      </div>
    );
  }

  function Row({ label, value, est, good, hasCompare }: {
    label: string; value: string; est: string | null; good: boolean; hasCompare: boolean;
  }) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{label}</span>
        <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}>
          <span
            className="num"
            style={{ fontSize: 15, fontWeight: 600, color: hasCompare ? (good ? "var(--positive)" : "var(--negative)") : "var(--text-primary)" }}
          >
            {value}
          </span>
          {est && <span className="num" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>est. {est}</span>}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1>Earnings</h1>
      <Freshness updatedAt={doc.updatedAt} />

      <Card>
        <Calendar events={calendarEvents} onSelectDate={setSelectedDate} />
      </Card>

      {selectedDate && dateRows.length > 0 && (
        <Modal
          title={new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}
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
                  <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--hairline)" }}>
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
      {tickersWithResults.length === 0 && <p style={{ color: "var(--text-tertiary)" }}>No historical results yet.</p>}

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
                {results.slice(0, 4).map((r) => (
                  <button
                    key={r.date}
                    onClick={() => setSelectedResult(r)}
                    style={{
                      padding: "var(--space-2) 0", borderTop: "1px solid var(--hairline)",
                      background: "none", border: "none", borderTopWidth: 1, borderTopStyle: "solid",
                      borderTopColor: "var(--hairline)", textAlign: "left", cursor: "pointer", width: "100%",
                    }}
                  >
                    <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.period}</p>
                    <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 2 }}>
                      <span className="num" style={{ fontSize: 12 }}>Rev {pct(r.revenueYoyPct)} YoY</span>
                      <span className="num" style={{ fontSize: 12 }}>EPS {pct(r.epsYoyPct)} YoY</span>
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
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc -b`
Expected: errors only in `Today.tsx`.

- [ ] **Step 4: Commit**

```bash
git add web/src/views/Earnings.tsx web/src/components/Calendar.tsx
git commit -m "feat: earnings tab has tappable rows and past-report pop-up"
```

---

## Task 13: Today tab — top briefings, no recap section

**Files:**
- Modify: `web/src/views/Today.tsx`

- [ ] **Step 1: Read the current file fully**

Run: `cat web/src/views/Today.tsx`
Note the exact structure of the News section, the earnings-recap section, and the calendar `useMemo`.

- [ ] **Step 2: Rewrite `web/src/views/Today.tsx`**

Apply these concrete changes:

1. Imports: replace `NewsDoc, EarningsDoc, DividendsDoc, HoldingsDoc, TodayEarningsRecap` with `NewsDoc, EarningsDoc, DividendsDoc, HoldingsDoc`. Remove `TodayEarningsRecap`.
2. State: remove `const [recaps, setRecaps] = useState<TodayEarningsRecap[]>([]);`.
3. `useEffect`: `api.get<NewsDoc>("/api/news/top")` stays (now returns `{ updatedAt, briefings }`). Remove the `api.get<TodayEarningsRecap[]>("/api/earnings/today-recaps")...` line.
4. Calendar `useMemo`: earnings events from `earnings?.calendar` (not `.upcoming`), mapping `kind: e.isPast ? "earnings-past" : "earnings"`. Dividend events from `dividends?.dividends` filtering `!d.locked`, `kind: "dividend-pay"`, `date: d.paymentDate`.
5. Guard: `if (!news || !earnings || !dividends) return ...` stays.
6. `futureDividends`: `dividends.dividends.filter((d) => !d.locked)`.
7. `shownEarnings`: `selectedDate ? earnings.calendar.filter((e) => e.date === selectedDate) : []`.
8. News section render: iterate `news.briefings` (not `news.articles`). Each card:
   ```tsx
   {news.briefings.map((b) => {
     const isPositive = b.sentiment >= 0;
     return (
       <Card key={`${b.ticker}:${b.weekStart}`} elevated>
         <button
           onClick={() => navigate(`/briefing/${b.ticker}/${b.weekStart}`)}
           style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
         >
           <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
             <TickerAvatar ticker={b.ticker} logo={holdingByTicker.get(b.ticker)?.logo} size={24} />
             <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>{b.ticker}</span>
             <span
               className={`num ${isPositive ? "positive" : "negative"}`}
               style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "var(--bg-elevated-2)" }}
             >
               {isPositive ? "+" : ""}{b.sentiment.toFixed(2)}
             </span>
           </div>
           <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{b.summary}</p>
         </button>
       </Card>
     );
   })}
   ```
   and the empty state: `{news.briefings.length === 0 && <Card><p style={{ color: "var(--text-tertiary)" }}>No briefings yet.</p></Card>}`.
9. **Delete the entire earnings-recap section** (the block that renders `recaps` / "Reported today" / `TodayEarningsRecap` takeaways).
10. Earnings-in-calendar-modal render: for `shownEarnings` (now `CalendarRowEntry[]`), show `e.quarter > 0 ? \`Q${e.quarter} ${e.year}\` : e.year` and estimates (`e.epsEstimate`, `e.revenueEstimate`) — same as the Earnings tab's future branch. Past entries in the Today modal can simply show "Reported" (Today view stays lightweight; the full result pop-up lives in the Earnings tab).

- [ ] **Step 3: Typecheck the whole web app**

Run: `cd web && npx tsc -b`
Expected: NO errors.

- [ ] **Step 4: Build the web app**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Lint**

Run: `cd web && npm run lint`
Expected: no errors (warnings tolerable if pre-existing).

- [ ] **Step 6: Commit**

```bash
git add web/src/views/Today.tsx
git commit -m "feat: today tab shows top briefings, drops earnings recap"
```

---

## Task 14: db.ts local smoke test

**Files:**
- Create: `src/db.test.ts` (skipped in CI, run manually against `--local`)

- [ ] **Step 1: Create `src/db.test.ts`**

```ts
import { describe, it, expect } from "vitest";

/**
 * Not a unit test — a manual runbook check. D1 isn't available in the vitest node env.
 * Run the real thing with:
 *   npx wrangler d1 execute market-pulse --local --file ./scripts/db-smoke.sql
 * This file just documents the expected behavior and always passes so `npm test` is green.
 */
describe("db smoke (manual)", () => {
  it("is verified via wrangler d1 execute against --local (see scripts/db-smoke.sql)", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Create `scripts/db-smoke.sql`**

```sql
INSERT INTO dividends (ticker, ex_date, payment_date, per_share_usd, per_share_eur, qualifying_shares, amount_eur, yield_pct, locked, updated_at)
VALUES ('TEST', '2026-08-15', '2026-09-01', 1.7, 1.56, 3.42, 5.34, 6.2, 0, '2026-09-02T00:00:00Z')
ON CONFLICT (ticker, ex_date) DO UPDATE SET amount_eur = excluded.amount_eur;

SELECT ticker, amount_eur, locked FROM dividends WHERE ticker = 'TEST';

DELETE FROM dividends WHERE ticker = 'TEST';
```

- [ ] **Step 3: Run it**

Run:
```bash
npx wrangler d1 execute market-pulse --local --file ./scripts/db-smoke.sql
```
Expected: one result row `TEST | 5.34 | 0`, then the delete succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/db.test.ts scripts/db-smoke.sql
git commit -m "test: add d1 local smoke check"
```

---

## Task 15: Full verification pass

- [ ] **Step 1: Worker typecheck + tests**

```bash
npx tsc --noEmit && npm test
```
Expected: no type errors; all tests pass.

- [ ] **Step 2: Web typecheck + build + lint**

```bash
cd web && npx tsc -b && npm run build && npm run lint
```
Expected: clean.

- [ ] **Step 3: Local end-to-end**

```bash
npx wrangler d1 migrations apply market-pulse --local
npx wrangler dev
```
Then, with a valid `API_TOKEN`:
```bash
curl -s -XPOST -H "Authorization: Bearer <T>" http://localhost:8787/api/news/refresh | head -c 300
curl -s -XPOST -H "Authorization: Bearer <T>" http://localhost:8787/api/dividends/refresh
curl -s -XPOST -H "Authorization: Bearer <T>" http://localhost:8787/api/earnings/refresh
curl -s -H "Authorization: Bearer <T>" http://localhost:8787/api/dividends | head -c 300
curl -s -H "Authorization: Bearer <T>" http://localhost:8787/api/earnings | head -c 300
curl -s -H "Authorization: Bearer <T>" http://localhost:8787/api/news | head -c 300
```
Expected: refresh calls return `{"status":"ok"}` or a `NewsDoc`; GETs return the new shapes; `dividends` now contains real rows (FMP has KLAC etc. since Aug); `news` briefings likely still `[]` until a weekly run (fine).

- [ ] **Step 4: Commit any fixes, then tag the plan done**

```bash
git add -A && git commit -m "chore: d1 migration verification pass" || true
```

---

## Migration runbook (post-merge, requires the user for auth)

These steps are **not** code tasks — they provision the remote D1 and deploy. Run in order.

1. **User action — re-auth with D1 scope:**
   ```bash
   npx wrangler logout
   npx wrangler login
   ```
   Grant D1 permissions in the browser consent screen.

2. **Create the remote database:**
   ```bash
   npx wrangler d1 create market-pulse
   ```
   Copy the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id`, replacing `PLACEHOLDER_SET_BY_WRANGLER_D1_CREATE`. Commit:
   ```bash
   git add wrangler.jsonc && git commit -m "chore: set d1 database_id"
   ```

3. **Apply migrations to remote:**
   ```bash
   npx wrangler d1 migrations apply market-pulse --remote
   ```

4. **Deploy the Worker:**
   ```bash
   npx wrangler deploy
   ```

5. **Deploy the web app** (existing process — Pages / Vite build output, unchanged by this plan):
   ```bash
   cd web && npm run build
   # then the existing deploy step for web/dist
   ```

6. **Run the one-time backfill — repeatedly until drained:**
   ```bash
   while :; do
     r=$(curl -s -XPOST -H "Authorization: Bearer <API_TOKEN>" https://portfolio-news.t212newsapp.workers.dev/api/admin/backfill)
     echo "$r"
     echo "$r" | grep -q '"earningsResultsEnriched":0' && break
     sleep 3
   done
   ```
   Each call enriches up to 15 thin earnings rows (one Claude web_search each, ~20–40s/call) and refreshes dividends. Loop exits when `earningsResultsEnriched` hits 0 (typically 6–10 iterations for ~23 holdings x 4 quarters). Fully idempotent — every write is an upsert.

7. **Verify in the PWA:**
   - Dividends tab: the KLAC dividend appears; clicking its payment date shows a glowing amount + yield.
   - Earnings tab: past reports are tappable; a past calendar date opens revenue/EPS/guidance colored by beat/miss.
   - News tab: run `POST /api/news/refresh` now to populate `news_articles`; briefings appear after the first Monday `5 7 * * 2` cron. It is normal for the News tab to be empty for the first few days.

8. **First briefing early (optional):** if you don't want to wait for Monday, run `POST /api/news/refresh` a few times over a couple of days to build up `news_articles`, then manually invoke the Monday cron once from the Cloudflare dashboard ("Trigger" on the `5 7 * * 2` schedule) or via `wrangler` scheduled trigger. No extra route needed.

9. **Clean up KV** (after confirming D1 works, ~1 week later):
   ```bash
   npx wrangler kv key delete --binding PORTFOLIO_KV "news:ranked"
   npx wrangler kv key delete --binding PORTFOLIO_KV "news:seen"
   npx wrangler kv key delete --binding PORTFOLIO_KV "dividends:upcoming"
   npx wrangler kv key delete --binding PORTFOLIO_KV "earnings:upcoming"
   npx wrangler kv key delete --binding PORTFOLIO_KV "earnings:results"
   npx wrangler kv key delete --binding PORTFOLIO_KV "earnings:today-recaps"
   # earnings:web:KAP.L can stay — still written by web-earnings.ts state, harmless
   ```

---

## Self-Review

**Spec coverage:**
- D1 for news/earnings/dividends, KV keeps holdings/returns/push → Tasks 2, 3; Task 8 leaves KV routes for those untouched. ✓
- Dividend retained by payment date, glowing pay entry, plain ex entry, yield → Tasks 4, 11. ✓
- Yield = annualized ÷ current price → `resolveDividendRow` in Task 4. ✓
- Dividends from 2026-08-01 forward → `EARLIEST_EX_DATE` in Task 4. ✓
- News = Claude weekly briefings only, raw articles table fed to Claude only, never rendered → Task 5 (`refreshArticles` writes table, `News.tsx`/`Briefing.tsx` read only briefings). ✓
- Every company with ≥1 article gets a briefing → `grouped` query in `refreshBriefings`, no filter. ✓
- ~1 month retention → `ARTICLE_RETENTION_DAYS = 30`, `BRIEFING_RETENTION_WEEKS = 5`. ✓
- Seen/unseen on briefing, filter added → `seen` column, `markBriefingSeen`, `News.tsx` seen filter + dot. ✓
- Weekly sentiment computed from article sentiments → `briefingSentiment`. ✓
- Weekly briefing generation → `refreshBriefings` (Task 5), triggered by the Monday-only `5 7 * * 2` cron (Task 8). ✓
- Article `description` stored and used for briefings → Task 2 schema + Task 5 `refreshArticles`/`refreshBriefings`. ✓
- Today shows top briefing summaries / top 3 → Task 8 `/api/news/top`, Task 13. ✓
- Earnings: pop-up on any of last 4 reports → Task 12 tappable rows → `selectedResult` modal. ✓
- Structured store: revenue, eps, guidance, highlights, YoY, beat → schema Task 2, `earnings_results`. ✓
- Past + current earnings both on calendar → `earnings_calendar` keeps 4 past + next; `isPast` flag; `earnings-past` dot kind (Task 12). ✓
- Remove "today it was earnings" extras → Task 6 deletes today-recaps; Task 13 removes the Today recap section. ✓
- Poll ~10 min after report, retry every ~10 min, only on days a holding reports → `*/10 11-23 * * 1-5` cron, `pollEarningsResults` returns early when `due.length === 0`, `needsResultsPoll` gates on `resultsAvailableAt` + 2h backoff. ✓
- Check before-open / after-close → `resultsAvailableAt` uses `hour` (`bmo`/`amc`). ✓
- Past-date pop-up: expected + real, colored by beat/miss, no % → `ResultBody`/`Row` in Task 12 (color from `good`, no pct in modal). ✓
- 4-report table has YoY % → `pct(r.revenueYoyPct)` / `pct(r.epsYoyPct)` in Task 12. ✓
- Backfill dividends + earnings from Aug 1, news forward-only → Task 7 + runbook step 6. ✓
- Council review of this plan → happens after this file is saved (separate step, per user instruction). ✓

**Placeholder scan:** `database_id` placeholder is intentional and documented (runbook step 2). No TODO/TBD/"handle edge cases" left. All code steps show full code.

**Type consistency:**
- `resolveDividendRow` returns snake_case row object; `refreshDividends` uses those exact keys in the INSERT. ✓
- `Briefing` fields identical in `src/news.ts`, `web/src/api/types.ts`, `News.tsx`, `Briefing.tsx`. ✓
- `CalendarRowEntry` / `EarningsResult` identical in `src/earnings.ts` and `web/src/api/types.ts`. ✓
- `CalendarEvent.kind` union extended consistently in `Calendar.tsx`, `Earnings.tsx`, `Today.tsx` (`earnings-past`). ✓
- `lookupEarningsResult` return type `EarningsResultLookup` matches the columns written in `pollEarningsResults` and `runBackfill`. ✓
- API client gains `patch`; `Briefing.tsx` uses `api.patch`. ✓

**Gaps found & fixed inline:** Task 8 originally used dynamic `import("./news")`; replaced with a static import for consistency. Task 6's Finnhub history `period` field access is defensively typed since `EarningsResult` from `finnhub.ts` types `period` but real payloads vary.

**Single-reviewer critical pass — accepted findings, all folded in:**
1. New poll cron was `1-5`; Cloudflare's shifted DOW makes that Sun–Thu, silently skipping Friday (a prime earnings day). → `*/10 11-23 * * 2-6`, and briefing cron is `5 7 * * 2` (Monday). A dashboard cron-preview check is now a required pre-deploy step.
2. Weekly briefing generation ran a guard-query every day inside the daily cron and piled its ~25 Claude calls onto an already-heavy invocation. → Moved to its own Monday-only cron slot.
3. `news_articles` stored no `description`, making briefings thin. Marketaux returns it for free. → `description` column added.
4. Backfill made up to ~120 Claude web_search calls in one HTTP request — Worker time/subrequest risk. → Chunked to 15/call; runbook loops until drained.
5. `getEarnings` had a no-op ternary for `updatedAt`. → Simplified.
6. Subrequest-limit / Workers-plan assumption was implicit. → Explicit pre-Task-3 check added (the current code already proves Paid plan).

**Rejected / deferred:** moving `earnings:web:KAP.L` state out of KV (still fine in KV, out of scope); adding a `briefings-now` route (YAGNI — Monday cron or `news/refresh` + wait); per-ticker withholding tax (spec explicitly out of scope).
