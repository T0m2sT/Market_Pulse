# D1 persistence for News, Earnings, Dividends — design

Date: 2026-09-02
Status: approved (pending council review of implementation plan)

## Problem

All three data tabs are backed by single KV documents that each cron **rebuilds from scratch**. Nothing accumulates. Concrete failures:

- **Dividends**: `refreshDividends` keeps a record only while its *ex-date* is within the last 14 days. Payment lands weeks after ex-date, so a real dividend (KLAC, ex mid-Aug, paid Sep 1) is dropped from KV before its payment date ever arrives. The tab is a "next 90 days estimate", not a record.
- **News**: `news:ranked` holds the current top 60 ranked articles. No history, no seen/unseen state surfaced, no full text — the app links out to external sites.
- **Earnings**: `earnings:results` is Finnhub's EPS history (estimate vs actual, no revenue, no guidance). The "today recap" feature is a bolt-on that only covers report day. No stored structured summary, no calendar history.

## Goal

Move News, Earnings, Dividends to **Cloudflare D1** (SQLite, bound to the Worker, no second vendor, €0). Holdings, returns, and push subscriptions stay in KV. Each tab keeps a bounded history in D1 and the UI reads from it.

Success criteria:

1. A dividend paid today shows on the Dividends calendar with a glowing payment-date entry, and stays visible for its full retention window regardless of ex-date age.
2. The News tab shows only Claude-written weekly company briefings stored in D1 — no external links, no raw article list.
3. Clicking any of the last-4 earnings reports, or any past earnings date on the calendar, opens a pop-up with revenue/EPS/guidance (real vs expected, colored by beat/miss).
4. D1 starts populated: dividends and earnings backfilled from ~2026-08-01; news accumulates forward.

## Architecture

### Storage split

| Data | Store | Why |
|---|---|---|
| Holdings, returns snapshot, push subs, news-seen sets → **stays** | KV | Single documents, no history/query need |
| News: raw articles + weekly briefings | **D1** | History, per-row seen flag, aggregate queries |
| Earnings: calendar + results | **D1** | 4-report history per ticker, structured columns |
| Dividends: one row per (ticker, ex-date) | **D1** | Retained by payment date, yield calc |

### D1 binding

`wrangler.jsonc` gains:
```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "market-pulse", "database_id": "<from wrangler d1 create>" }
]
```
`src/env.d.ts` gains `DB: D1Database`.

Schema lives in `migrations/0001_init.sql` (wrangler's built-in migrations dir). A tiny `src/db.ts` holds typed query helpers — no ORM. Each domain module (`news.ts`, `earnings.ts`, `dividends.ts`) owns its own SQL.

### Schema

```sql
-- Raw article feed. Fed to Claude only; NEVER rendered in the app.
CREATE TABLE news_articles (
  url          TEXT PRIMARY KEY,
  ticker       TEXT NOT NULL,           -- display ticker of the matched holding
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,
  published_at TEXT NOT NULL,           -- ISO 8601
  sentiment    REAL NOT NULL,           -- Marketaux entity sentiment_score, -1..1
  fetched_at   TEXT NOT NULL
);
CREATE INDEX idx_news_articles_ticker_week ON news_articles (ticker, published_at);

-- Claude-written weekly briefings. The ONLY thing the News tab shows.
CREATE TABLE news_briefings (
  ticker        TEXT NOT NULL,
  week_start    TEXT NOT NULL,          -- YYYY-MM-DD, Monday of the ISO week
  summary       TEXT NOT NULL,          -- 1-2 sentences, card
  body          TEXT NOT NULL,          -- full multi-paragraph write-up
  sentiment     REAL NOT NULL,          -- mean of that week's article sentiments for this ticker
  article_count INTEGER NOT NULL,
  seen          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (ticker, week_start)
);
CREATE INDEX idx_news_briefings_week ON news_briefings (week_start);

-- One row per known earnings date (past or upcoming) per ticker.
CREATE TABLE earnings_calendar (
  ticker         TEXT NOT NULL,
  date           TEXT NOT NULL,         -- YYYY-MM-DD
  hour           TEXT NOT NULL DEFAULT '',   -- 'bmo' | 'amc' | '' (Finnhub)
  quarter        INTEGER NOT NULL DEFAULT 0,
  year           INTEGER NOT NULL DEFAULT 0,
  eps_estimate   REAL,
  revenue_estimate REAL,
  is_estimate    INTEGER NOT NULL DEFAULT 0,  -- date came from web-search fallback
  PRIMARY KEY (ticker, date)
);

-- Structured actuals, filled by the post-report Claude poll (or backfill).
CREATE TABLE earnings_results (
  ticker          TEXT NOT NULL,
  date            TEXT NOT NULL,        -- matches earnings_calendar.date
  period          TEXT NOT NULL,        -- 'Q3 2026' or 'H1 2026'
  revenue         REAL,
  revenue_estimate REAL,
  revenue_yoy_pct REAL,                 -- from Claude directly
  eps             REAL,
  eps_estimate    REAL,
  eps_yoy_pct     REAL,
  guidance_text   TEXT,                 -- next-quarter/FY guidance, plain text, may be ''
  highlights_text TEXT,                 -- margin / segment color, plain text, may be ''
  beat            INTEGER,              -- 1 = beat on the headline metric, 0 = missed, NULL = unknown
  checked_at      TEXT NOT NULL,
  PRIMARY KEY (ticker, date)
);

-- One row per (ticker, ex-date). Retained by payment date, not ex-date.
CREATE TABLE dividends (
  ticker           TEXT NOT NULL,
  ex_date          TEXT NOT NULL,       -- YYYY-MM-DD
  payment_date     TEXT NOT NULL,
  per_share_usd    REAL NOT NULL,       -- FMP declared amount, USD
  per_share_eur    REAL NOT NULL,       -- converted; frozen once ex_date passes
  qualifying_shares REAL NOT NULL,      -- holding qty; frozen once ex_date passes
  amount_eur       REAL NOT NULL,       -- per_share_eur * qualifying_shares
  yield_pct        REAL,                -- (per_share_usd * payments_per_year) / currentPrice * 100
  locked           INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (ticker, ex_date)
);
```

### Retention

Each refresh, after upserting, deletes rows older than the window:

- `news_articles`: `published_at` older than 30 days.
- `news_briefings`: `week_start` older than ~5 weeks (keeps the current month plus a margin).
- `earnings_calendar` + `earnings_results`: keep the 5 most recent dates per ticker (4 past + next). Implemented as: keep rows where `date >= (5th-most-recent date for that ticker)`. Simpler equivalent used in code: keep `date >= today - 400 days` AND, per ticker, never more than the 4 latest past rows + all future rows.
- `dividends`: `payment_date` older than 60 days, and never anything with `ex_date < 2026-08-01`.

## Component: News

### Pipeline

1. **Article fetch** (existing Marketaux cron cadence, `0 6,13,20 * * *`): per-ticker Marketaux call, same batching/paywall/min-match-score filtering as today. Instead of ranking + writing `news:ranked`, upsert each surviving `(url, ticker, title, source, published_at, sentiment)` into `news_articles`. Then run article retention.
   - The Haiku per-article impact ranker (`haiku.ts` `rankArticles`) is **deleted**.
   - `news:seen` KV set and `SEEN_*` logic in `news.ts` are **deleted** (seen now lives on briefings).
2. **Weekly briefing generation** (in the daily `5 6 * * *` cron, guarded to run once per ISO week — e.g. only when `today` is a Monday, or when no briefing exists for last week):
   - Determine the just-completed ISO week `[weekStart, weekEnd]` (Mon–Sun).
   - `SELECT ticker, ... FROM news_articles WHERE published_at BETWEEN weekStart AND weekEnd GROUP BY ticker`.
   - For **every ticker with ≥1 article that week**: one Claude call (`claude-haiku-4-5`, no web_search), system prompt = "write a briefing on what's going on with this company this week from these articles", user content = the article titles + descriptions + sentiments + dates. Response: `{ "summary": "...", "body": "..." }`.
   - `sentiment` for the briefing = arithmetic mean of that week's article `sentiment` values for the ticker (computed in code, not asked of Claude).
   - Upsert into `news_briefings`. Then run briefing retention.
   - A failed Claude call for one ticker skips that ticker's briefing this run; it retries next run if still within the week-window guard, otherwise that week has no briefing for that ticker (acceptable).
3. **Backfill**: none. News accumulates from first deploy; briefings appear after the first weekly run.

### API

- `GET /api/news` → `{ updatedAt, briefings: Briefing[] }`, newest `week_start` first, then by `sentiment` magnitude. `Briefing = { ticker, weekStart, summary, body, sentiment, articleCount, seen }`.
- `GET /api/news/top` → `{ updatedAt, briefings: Briefing[] }` — top 3 by `abs(sentiment) * portfolioWeight` (weight joined in the Worker from KV holdings), current week only.
- `PATCH /api/news/seen` body `{ ticker, weekStart }` → sets `seen = 1`. (Or `POST /api/news/:ticker/:weekStart/seen` — pick in plan.)

### UI (`web/src/views/News.tsx`, `Article.tsx`, `Today.tsx`)

- News tab: list of briefing cards, grouped/ordered by week (newest first). Card = ticker avatar + name + week label + sentiment chip + `summary`. Tap → detail view showing `body` (full text, in-app, no external link). Opening a card fires the `seen` PATCH.
- `Article.tsx` becomes `Briefing.tsx` (route `/briefing/:ticker/:weekStart`), rendering `body` as paragraphs. The external-link button is removed.
- Filters kept: ticker filter. Sentiment filter (all/positive/negative) now operates on briefing sentiment. Unseen filter is **added** (all / unseen).
- `Today.tsx` News section: renders the top-3 briefing summaries from `/api/news/top` instead of articles. Tapping routes to `/briefing/...`.
- `types.ts`: `RankedArticle` / `NewsDoc` replaced by `Briefing` / `NewsDoc { updatedAt, briefings }`.

## Component: Earnings

### Pipeline

1. **Calendar sync** (existing `5 6 * * *` daily cron): Finnhub `calendar/earnings` from `today - 400d` to `today + 30d`, filtered to holdings. Upsert each into `earnings_calendar`. Web-search fallback for `KAP.L` (`web-earnings.ts`) unchanged in spirit — its `next` date upserts into `earnings_calendar` with `is_estimate = 1`, its history upserts into `earnings_results` (EPS only, other columns NULL). Then calendar retention.
2. **Results poll** — NEW dedicated cron `*/10 11-23 * * 1-5` (covers ~07:00–19:00 ET across DST). Each tick:
   - `SELECT ticker, date, hour FROM earnings_calendar WHERE date = today` (cheap). If empty → **return immediately, no Claude call**. This is how "only runs on days one of my stocks reports" is honored.
   - For each such ticker with **no row in `earnings_results` for that date** (or a row where `beat IS NULL` and `checked_at` older than ~2h — allows a later re-try if the first call got nothing):
     - Skip if the report time hasn't passed + 10 min: `bmo` → 13:40 UTC (~9:40 ET), `amc` → 20:40 UTC (~16:40 ET), `''`/unknown → treat as available any time after 12:00 UTC.
     - One Claude call (`claude-haiku-4-5` + `web_search`), prompt = "find the earnings released by {name} ({ticker}) on {date}: revenue, revenue estimate, revenue YoY %, EPS, EPS estimate, EPS YoY %, next-period guidance, and any margin/segment highlights". Response JSON → `earnings_results` columns. `beat` = Claude's judgment on the headline metric (revenue for most, EPS where that's the watched number), or derived `eps >= eps_estimate`.
     - If Claude returns nothing usable, write nothing (or write a stub with `checked_at` so the 2h re-try backoff applies) — next tick retries.
3. **The `earnings:today-recaps` feature is removed** entirely: `TODAY_RECAPS_KEY`, `refreshTodayEarningsRecaps`, `getTodayEarningsRecaps`, `lookupTodayEarningsRecap`, `TodayEarningsRecap`, the `/api/earnings/today-recaps` route, and the Today-view recap section. Its job is now done by `earnings_results` + the calendar pop-up.
4. **Backfill** (one-time script, see Migration): for each holding, Finnhub `stock/earnings` → last 4 `earnings_calendar` past rows + `earnings_results` EPS. Then one Claude web_search call per (ticker, past date) to fill revenue/guidance/highlights/YoY for those 4. `KAP.L` via the existing web-earnings path.

### API

- `GET /api/earnings` → `{ updatedAt, calendar: CalendarRowEntry[], results: Record<ticker, EarningsResult[]> }`.
  - `calendar` = all rows in `earnings_calendar` (4 past + next per ticker).
  - `results` = `earnings_results` rows keyed by ticker, newest first, max 4.
  - `EarningsResult = { ticker, date, period, revenue, revenueEstimate, revenueYoyPct, eps, epsEstimate, epsYoyPct, guidanceText, highlightsText, beat }`.
- Refresh routes unchanged in shape; `/api/earnings/refresh` runs calendar sync + results poll. `/api/earnings/today-recaps` deleted.

### UI (`web/src/views/Earnings.tsx`, `Today.tsx`)

- **Calendar**: events from `calendar` — every row becomes a dot. Past dot (date < today) and future dot both shown ("two earnings report dates, past and current"). Clicking:
  - **Future date** → pop-up with estimates only (EPS est., revenue est.) — same as today's modal.
  - **Past date** → pop-up with the `earnings_results` row: three rows — Revenue (real vs `est.`), EPS (real vs `est.`), Guidance (text). The real number is green if `>= estimate`, red if `<`. No percentages here. Highlights text NOT shown here (kept minimal per decision).
- **Past results grid** (`tickersWithResults`): keeps the 2-column card grid. Each card lists up to 4 rows; **each row is tappable** → opens the same past-date pop-up. Row shows: period label + `rev +X% YoY / EPS +Y% YoY` (from `revenue_yoy_pct` / `eps_yoy_pct`; "—" where null). The old EPS-surprise chip is replaced by the YoY figures.
- `Today.tsx`: the today-recap section is removed. The earnings calendar mini-view there uses the same `calendar` rows (past + future dots).
- `types.ts`: `EarningsResult` gains the new columns; `UpcomingEarning` → `CalendarRowEntry` with an explicit `isPast` (or derived from date). `TodayEarningsRecap` removed.

## Component: Dividends

### Pipeline

`refreshDividends` (existing `5 6 * * *` cron) rewritten to write D1:

1. FX: `usdToEurRate()` as today; on failure, abort (leave D1 untouched).
2. For each non-manual holding: FMP `fetchDividends`. For each FMP dividend with `ex_date >= 2026-08-01` and `payment_date >= today - 60d`:
   - `key = (ticker, ex_date)`. Look up existing D1 row.
   - `locked = existingRow?.locked || ex_date < today`.
   - `per_share_eur` = frozen from existing row if locked, else `dividend * usdToEur`.
   - `qualifying_shares` = frozen from existing row if locked, else `holding.quantity`.
   - `amount_eur = per_share_eur * qualifying_shares`.
   - `yield_pct`: `payments_per_year` inferred from spacing of this ticker's FMP dividend history (count of dividends in the trailing 365 days, clamped 1–12; default 4). `yield_pct = (per_share_usd * payments_per_year) / holding.currentPrice * 100`. Recomputed every run while unlocked; frozen with the row once locked.
   - Upsert.
3. On a per-ticker FMP failure: leave that ticker's existing rows untouched (don't delete).
4. Retention: delete `payment_date < today - 60d` or `ex_date < 2026-08-01`.
5. **Backfill**: the first run naturally picks up everything FMP still returns with `ex_date >= 2026-08-01`, so no separate script — but the one-time migration runs `refreshDividends` once explicitly after deploy.

### API

- `GET /api/dividends` → `{ updatedAt, dividends: Dividend[] }` sorted by `ex_date`.
  - `Dividend = { ticker, name, logo, exDate, paymentDate, perShareEur, qualifyingShares, amountEur, yieldPct, locked }` (name/logo joined from KV holdings in the Worker).
- `POST /api/dividends/refresh` unchanged in shape.

### UI (`web/src/views/Dividends.tsx`, `Today.tsx`)

- Summary card: "Estimated total" now sums a defined window — next 90 days of `payment_date` (unchanged intent), computed from D1 rows.
- Calendar: two events per dividend — `dividend-ex` dot (ex-date) and `dividend-pay` dot (payment date), exactly as today. Payment-date dot on `today` gets the existing today-highlight treatment.
- Pop-up (a date clicked): for each dividend touching that date, show up to two entries:
  - **Ex-dividend** entry (shown when the clicked date == ex_date): label "Ex-dividend", amount in **plain** style (no glow), plus the `€X/share × N shares` breakdown.
  - **Payment** entry (shown when clicked date == payment_date): label "Payment", amount in the **glowing** green style (the current `.positive` + glow), breakdown line, plus **yield %**.
- `types.ts`: `UpcomingDividend` → `Dividend` with `perShareEur`, `amountEur`, `yieldPct`; `locked` kept.
- `Today.tsx`: dividend calendar events unchanged (future payment dates).

## Crons — final set

```jsonc
"crons": [
  "5 6 * * *",            // daily: earnings calendar sync + weekly-briefing gen (guarded) + dividends refresh
  "* 13-19 * * 2-6",      // returns snapshot, every minute, regular market hours  (unchanged)
  "*/5 8-12,20-23 * * 2-6", // returns snapshot, pre/post market                    (unchanged)
  "0 6,13,20 * * *",      // news article fetch 3x/day  (was: news + today-recaps)
  "*/10 11-23 * * 1-5"    // NEW: earnings results poll — no-ops instantly on non-earnings days
]
```

Note the existing weekday-field quirk (Cloudflare `0=Saturday`): the new poll cron uses `1-5` deliberately here since `11-23` UTC with a same-day check tolerates the shift; validated in the plan against the dashboard cron preview before deploy. If the shift bites, it becomes `2-6`.

## Migration

`wrangler.jsonc` config change is not enough — D1 must be provisioned. Steps (some require the user; the OAuth token currently lacks D1 scope):

1. **User**: `npx wrangler login` granting D1 permission (or `wrangler logout` then login).
2. **User or automated**: `npx wrangler d1 create market-pulse` → paste `database_id` into `wrangler.jsonc`.
3. `npx wrangler d1 migrations apply market-pulse --remote` (applies `0001_init.sql`).
4. Deploy the Worker.
5. Run the one-time backfill: `POST /api/admin/backfill` (new, token-guarded, idempotent) which:
   - runs `refreshDividends` once (picks up FMP history ≥ 2026-08-01),
   - for each holding: Finnhub `stock/earnings` → last 4 into `earnings_calendar`/`earnings_results`, then a Claude web_search call per (ticker, date) to fill revenue/guidance/highlights/YoY,
   - `KAP.L` via `web-earnings.ts`.
   - Idempotent: upserts only, safe to re-run.
6. News needs no backfill; first weekly briefing appears after the next Monday `5 6 * * *` run (or the plan may trigger an immediate "last week" generation as part of backfill).

Local dev: `wrangler d1 migrations apply market-pulse --local` + `wrangler dev`.

## Error handling

- D1 write failure in a cron: log, leave prior rows, `updatedAt` on the API response reflects staleness (unchanged philosophy).
- Claude call failure: per-ticker skip, retry next run; never blocks the rest of the batch.
- FMP/Finnhub per-ticker failure: keep existing rows for that ticker, don't delete.
- FX failure: abort the dividends refresh entirely (don't write unconverted USD as EUR).
- Backfill partial failure: idempotent upserts mean re-running `/api/admin/backfill` fills the gaps.

## Testing

Each non-trivial module gets one runnable self-check (assert-based `demo()` / small `test_*.ts`), per the repo's existing light-testing norm:

- `dividends.ts`: lock/freeze logic — an unlocked row re-converts at today's FX; a locked row keeps its stored `per_share_eur` and `qualifying_shares`; `payments_per_year` inference from a synthetic FMP history; retention drops `ex_date < 2026-08-01`.
- `news.ts`: ISO-week boundary math (Mon–Sun for a given date); briefing sentiment = mean of article sentiments; weekly-run guard fires once per week.
- `earnings.ts`: results-poll "report time + 10 min" gate for bmo/amc/unknown; "no-op when no ticker reports today"; YoY passthrough; retention keeps 4 past + future per ticker.
- `db.ts`: a smoke test against `--local` D1 (create, upsert, select, retention delete).

Trivial one-liners (e.g. `mean([]) === 0`) are folded into a neighbouring assertion rather than given their own `it()`. Money and time logic (`resolveDividendRow`, `needsResultsPoll`, `resultsAvailableAt`, `paymentsPerYear`, `isoWeekBounds`) each keep dedicated cases.

Manual E2E after deploy: click a past earnings date → pop-up with real vs est.; a paid dividend → glowing payment entry; News tab shows briefings only.

## Out of scope

- Withholding-tax adjustment on dividends (shows gross; ~15–30% higher than net for US stocks — accepted).
- Real Trading 212 dividend/transaction ingestion.
- Moving holdings/returns/push to D1.
- The v2 returns value-graph.
- Historical news reconstruction.

## File-level change list

**New**: `migrations/0001_init.sql`, `src/db.ts`.
**Rewritten**: `src/dividends.ts`, `src/news.ts`, `src/earnings.ts`.
**Edited**: `src/index.ts` (routes + cron dispatch + `/api/admin/backfill`), `src/env.d.ts`, `wrangler.jsonc`, `src/haiku.ts` (delete `rankArticles`), `src/web-earnings.ts` (drop recap half, keep KAP.L date/history; write to D1).
**Frontend rewritten**: `web/src/views/News.tsx`, `web/src/views/Dividends.tsx`, `web/src/views/Earnings.tsx`; `web/src/views/Article.tsx` → `Briefing.tsx`.
**Frontend edited**: `web/src/views/Today.tsx`, `web/src/api/types.ts`, `web/src/App.tsx` (route rename), `web/src/components/Calendar.tsx` (past vs future earnings dot).
