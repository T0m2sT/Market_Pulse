# Portfolio News & Earnings — Build Plan

Cloudflare Worker + KV · PWA only · €0/year

---

## 0. What this is now

A news and earnings tracker for the 24 positions in your Trading 212 pie, ranked by how much each story actually matters to *your* portfolio.

**What got cut, and why it's the right call:** the portfolio value graph, the historical backfill engine, the daily-replay algorithm, split adjustment, FX reconstruction, TWR maths. That was two-thirds of the difficulty and it existed to rebuild history you can already see in the Trading 212 app. Cutting it takes this from a summer project to a few weeks of evenings.

**Also cut:** Scriptable widgets and the Telegram bot. This is a PWA-only app now — one surface, one thing to maintain. High-impact alerts still exist, just as native Web Push from the installed PWA instead of a second channel.

**No Apple Developer fee, no 7-day expiry, no Mac dependency.** Works from Mirandela with the laptop shut.

```
Cloudflare Worker (cron + KV)
  ├── Trading 212 → holdings sync + P&L   (read-only key, sync on demand + every 30 min)
  ├── holdings sectors                    (you sort, Unassigned by default)
  ├── Finnhub → earnings calendar         (daily)
  ├── Marketaux → articles                (every 30 min, market hours)
  ├── Claude Haiku → impact ranking       (same cadence)
  ├── Web Push → high-impact alerts       (VAPID, toggleable in Settings)
  └── serves /api/* behind a bearer token

iPhone
  └── PWA, Add to Home Screen             → full UI + push notifications
```

---

## 1. Holdings, without Trading 212 write access

**No trading, no withdrawal, no order placement — anywhere in this system.** The Trading 212 API key used is scoped to **read-only**. It's used two ways: seeding/refreshing the position list (this section) and the live returns snapshot (§1c).

### Sectors: full GICS 11

Not a 4-bucket shortcut — the real GICS sector list, since that's what the returns view and news filters should be organized by:

```
Energy, Materials, Industrials, Consumer Discretionary, Consumer Staples,
Health Care, Financials, Information Technology, Communication Services,
Utilities, Real Estate
```

Plus one synthetic bucket, **Unassigned**, for anything pulled from T212 that hasn't been sorted yet.

### Seeding from Trading 212

`POST /api/holdings/sync` calls T212's `/equity/portfolio`, and for each position not already in `holdings:current`, adds it with `sector: "Unassigned"` and `weight` derived from position value (`quantity × currentPrice`, normalised against total portfolio value). Ticker and display name come straight from T212 — no Finnhub validation needed on this path, since a real T212 position is by definition a real ticker.

Existing positions (already sectored) are left alone on sync — it only adds what's new and updates weight, never overwrites a sector you've already assigned. Re-run it whenever the pie changes instead of hand-typing.

### Holdings editor

A view in the PWA, backed by `GET`/`PUT /api/holdings` plus the sync action above:

- **Sync from Trading 212** — the button that runs the above. Primary way positions enter the list now.
- **Tap to sort into sectors.** New positions land in an "Unassigned" section at the top; tap a card, a bottom sheet lists the 11 GICS sectors, tap one to assign. This *is* the sector-assignment UI, not bulk paste or drag-and-drop — one thumb, no gesture library, no desktop/mobile fork.
- **Manual positions**, for anything T212 doesn't carry — private/unlisted shares (e.g. a direct stake bought outside any broker), a watchlist ticker, whatever. Entered as ticker, display name, sector, quantity, and `averagePrice` (cost basis). **Ticker validation is skipped** for these — Finnhub's symbol lookup only makes sense for public tickers, and a private company has no public symbol to validate against.
- **`tickerOverride`** — optional, set per-position (T212-sourced or manual) when the position's own ticker doesn't match what Finnhub/Marketaux know it by (a post-rename symbol, for instance). News and earnings lookups use this instead of the raw ticker when it's set. See §1b.
- Weights **auto-normalise** — enter them however you like and the Worker divides by the total. Only relative weight is used, so they never need to sum to 100.
- **Validate the ticker on manual save** against Finnhub's symbol lookup, *except* for manual positions explicitly marked private/unlisted (see above). Reject unknown public symbols at entry.

### Manual positions and live pricing

A manual position has no T212 feed, so its `currentPrice` **isn't refreshed by any cron** — it stays whatever it was last set to. When a funding round changes the valuation (an unlisted company's cost basis per share going up, say), edit `currentPrice` by hand in Holdings; P&L then recomputes off the new number exactly like a listed position: `pnl = (currentPrice - averagePrice) * quantity`. No live-price fetch is attempted for these, and none should be — there's no exchange to fetch a live price from.

### Why the weight accuracy barely matters

Weight feeds exactly one thing: the `sqrt(weight)` term in the impact ranking. It decides whether an NVDA story outranks an OVV story, not any number you'd act on. If NVDA sits at 14% in the app while reality has drifted to 15% between syncs, the ranking is unchanged.

Note that `PUT /api/holdings` (and `/sync`) makes the bearer token a write credential rather than read-only. It still can't touch anything financial — worst case someone rearranges your news ranking.

---

## 1b. Ticker mismatches (`tickerOverride`)

T212 sometimes keeps using a company's pre-rename ticker after the market has moved on (e.g. Oasis Petroleum traded as `OAS` until its 2022 rename to Chord Energy, `CHRD` — T212's API still reports the position as `OAS`, but Finnhub/Marketaux only know it as `CHRD`). Rather than hardcode a rename table that inevitably misses the next one, `tickerOverride` is a per-position field you set once in Holdings when you notice a mismatch (no news, no earnings, for a position you know is actively covered).

Once set, every external lookup (Finnhub earnings, Marketaux news) uses the override instead of the raw ticker; the position still *displays* under its original ticker everywhere else in the app, so it still matches what you see in T212. Preserved across `/holdings/sync` re-runs like sector and name.

---

## 1c. Returns: total value, sector pie, position list

The **Returns** view, top to bottom:

1. **Total portfolio value** — one number at the top, the sum of every position's current value (T212 live price × quantity, or a manual position's hand-set `currentPrice` × quantity). Includes manual/unlisted positions, so this is the one place the whole portfolio — public and private — is represented as a single figure.
2. **Sector pie chart** — one slice per GICS sector present in your holdings, sized by value, colored distinctly per sector. Tap a slice to jump to that sector's group in the list below.
3. **Positions, grouped by sector** — under the chart, each sector heading with its positions listed beneath: ticker, value, P&L in currency and percent, color by sign.

**Deliberately not built:** time-weighted return, historical performance, a value-*over-time* chart (i.e. no line graph of your net worth across days/weeks). Those need a backfill/replay engine with split adjustment and FX reconstruction — the exact complexity §0 cut to keep this a few-weeks project. The pie chart above is a snapshot breakdown of *right now*, not a history — that distinction is what's still cut, not charts in general. If a value-over-time graph is wanted later, it's the v2 line in §6, not this.

### Fetch

One call to `https://live.trading212.com/api/v0/equity/portfolio` per cron cycle (same 30-min news/earnings cadence — no separate schedule). Auth is HTTP Basic: `Authorization: Basic base64(keyId:secret)`, built from two Worker secrets (`T212_API_KEY_ID`, `T212_API_SECRET`), never exposed to the PWA — T212 issues these as a pair, not a single token, secret shown once at creation.

Response is an array of positions: `ticker` (T212 suffixes these, e.g. `NVDA_US_EQ` — strip `_US_EQ` etc. to match the plain ticker used everywhere else in this app), `quantity`, `averagePrice`, `currentPrice`, and `ppl` (unrealized P&L in account currency, already computed server-side by T212 — no need to recompute it from price/quantity).

**Manual positions are never fetched from T212** — their `currentPrice` is whatever was last hand-set in Holdings (see §1). The returns computation treats a manual position exactly like a T212 one once it has `quantity`, `averagePrice`, `currentPrice` — it just skips the network call for it.

### Compute

For T212 positions, use T212's own `ppl` directly rather than recomputing: `pnlPercent = ppl / (averagePrice * quantity)`. For manual positions, compute directly: `pnl = (currentPrice - averagePrice) * quantity`, `pnlPercent = pnl / (averagePrice * quantity)`. Group by the `sector` field already on each holding in `holdings:current` (matched by ticker), sum P&L per sector, weight each sector's percent return by its share of total portfolio value.

### Store

`returns:current` — one document, overwritten each cycle. `updatedAt` shown in the view like everywhere else in this app.

### Display

Total value header, pie chart, then one section per GICS sector present in your holdings (an 11-sector list, but you'll only ever populate the handful you're actually invested in — no empty sections for sectors you don't hold), each with its positions listed underneath: value, P&L in currency and percent, color by sign.

**Unassigned positions show up here too**, as their own section, so an unsorted sync result is visible as a nudge to go sort it in Holdings rather than silently missing from the sector breakdown.

---

## 1d. Dividends

A **Dividends** section: ex-dividend dates, per-share amounts, and a running estimate of how much each upcoming payment is actually worth to you — scaled by real shares held, not a flat per-share number.

**New provider: Financial Modeling Prep.** Neither Finnhub nor Marketaux carries dividend data on their free tiers — Finnhub's `/stock/dividend` and `/stock/dividend2` are outright paywalled (`"error":"You don't have access to this resource"`), and `/calendar/dividend` returns empty even for known dividend payers, meaning it's not functional on the free key either. FMP's free tier (250 calls/day) has both a per-symbol dividends endpoint and a dividend calendar, confirmed working against real holdings.

**Fetch:** `GET /stable/dividends?symbol=TICKER` per holding — same per-ticker pattern as Marketaux, for the same reason: a global calendar call returns everything on the market, not filtered to your 25 tickers, and there's no batched `symbols=` param on this endpoint. At 25 calls/day (once daily is enough — dividend dates don't change hour to hour) this sits comfortably inside FMP's 250/day cap.

**The `date` field is the ex-dividend date** — confirmed by cross-checking FMP's response against Yahoo Finance's own ex-div history for the same ticker (rows matched exactly on date and per-share amount). Not obvious from the field name alone (FMP doesn't call it `exDividendDate`), so this was worth verifying against a second source rather than assuming.

### Qualification: live-tracked, then locked

Whether you'll actually receive a given dividend depends on how many shares you held *on the ex-dividend date* — not today's share count, and T212's API only exposes current holdings, no position history. Rather than build a full transaction ledger (real scope, a new T212 endpoint, a history KV store) or accept a flat "assume today's count always applied" proxy (wrong the moment you trade), this does the cheap thing that's actually correct for the common case:

- While a dividend's ex-date is still in the future, `qualifyingShares` is **overwritten every cron cycle** with the holding's current `quantity`. It tracks your live position right up to the deadline.
- Once the ex-date passes, `qualifyingShares` **stops updating** — it's whatever it was on the last cycle before the date passed, which is exactly the number of shares you held at the moment that mattered.

This means a payment estimate can shift while the date is still upcoming (you bought or sold — the estimate should shift), but freezes to the real answer the instant it's no longer editable. No separate transaction history needed; the existing holdings-sync cron does the work for free.

### Compute

`estimatedPayment = perShareAmount × qualifyingShares`. Sum across all holdings with an ex-date inside the display window for a portfolio-level total. Manual positions (private/unlisted, §1) are skipped entirely — no public ticker means no dividend data to fetch, and estimating one would be inventing a number this app has no basis for.

### Store

`dividends:upcoming` — `[{ ticker, exDate, paymentDate, perShare, qualifyingShares, estimatedPayment, locked }]`, `locked: true` once the ex-date has passed. Refreshed daily alongside the earnings cron (06:05 UTC) — same cadence rationale, dividend dates don't move hour to hour.

### Display

A **Dividends card** in Returns (§3), summing the total estimated upcoming payment — tap it to push a **Dividends detail screen** (back button returns to Returns, same pattern as tapping a sector), sorted by ex-date proximity: ticker, ex-date with a countdown, per-share amount, your qualifying share count, and the estimated payment in currency. A small badge distinguishes a locked-in (post-ex-date) estimate from one still tracking your live position. No new tab — the bottom bar stays at five destinations.

---

## 2. Backend

### Stack

Cloudflare Workers + KV + Cron Triggers, all on the free plan. Usage sits far inside it: roughly 20 KV writes and a few hundred reads per day against limits of 1,000 and 100,000.

### KV schema

```
holdings:current      { updatedAt, positions: [{ ticker, name, weight, sector, quantity, averagePrice, currentPrice, isManual, tickerOverride? }] }
news:ranked           { updatedAt, articles: [...] }        // top ~60, pre-scored
news:seen             { ids: [...] }                        // dedup, 7-day window
earnings:upcoming     [{ ticker, date, hour, epsEst, revEst }]
earnings:results      { [ticker]: [{ date, epsAct, epsEst, revAct, revEst, surprise }] }
notes:{ticker}        { body, flagged, updatedAt }
push:subscriptions    [{ endpoint, keys: { p256dh, auth } }]  // Web Push subscriptions
push:settings         { enabled, impactThreshold }
returns:current        { updatedAt, totalValue, totalPnl, totalPnlPercent, sectors: [{ sector, value, pnl, pnlPercent, positions: [{ ticker, quantity, avgPrice, currentPrice, pnl, pnlPercent, isManual }] }] }
```

One document per concern, updated as a unit. Don't split `news:ranked` into per-article keys — that turns one read into sixty.

### Cron schedule

| Job | Cadence | Calls |
|---|---|---|
| Earnings calendar | Daily 06:05 UTC | 1 Finnhub |
| Returns snapshot | `*/30` during 13:00–21:30 UTC, weekdays | 1 Trading 212 |
| News + ranking | 06:00, 13:30, 20:00 UTC daily (overnight, open, close) | 25 Marketaux (one per ticker) + 1 Haiku |

Returns stays frequent — it's one cheap call. News dropped from `*/30` to 3×/day: **Marketaux's free tier caps every response at 3 articles regardless of the `limit` param** (confirmed by testing, not documented up front — `x-usagelimit-limit: 100`/day, `x-ratelimit-limit: 30`/min), so one batched call for all 25 tickers returns only 3 articles total, mostly missing whichever tickers happen not to be in that day's top 3 globally. Calling per-ticker instead (25 calls) actually guarantees each holding gets checked, but 25 calls × 17 cycles blows the 100/day cap — so cadence drops to 3 cycles (75 calls/day, leaving headroom) aligned to when news actually happens: pre-market, close, and the overnight session between.

### Routes

All behind `Authorization: Bearer <token>`, one static token stored as a Worker secret. Single user, single token — this doesn't need OAuth.

```
GET /api/holdings
PUT /api/holdings          → validates tickers, normalises weights
POST /api/holdings/sync    → pulls positions from Trading 212, adds new ones as Unassigned
GET /api/returns           → sector-grouped live P&L snapshot
GET /api/dividends         → upcoming dividends with per-holding estimated payment
GET /api/earnings?window=30d
GET /api/news?tickers=&sentiment=&window=&sector=&type=
GET /api/news/top          → the 3 highlighted, for the Today view
GET /api/notes/:ticker
PUT /api/notes/:ticker
GET /api/push/vapid-public-key
POST /api/push/subscribe
POST /api/push/unsubscribe
GET /api/push/settings
PUT /api/push/settings   → { enabled, impactThreshold }
```

Every response carries `updatedAt`. The PWA shows freshness — a stale number rendered with total confidence is the failure mode that matters most in a finance app.

### News pipeline

1. **Fetch, per ticker.** One Marketaux call per holding (25 calls/cycle, 3 articles each — the free tier's real per-call cap). Not a batched `symbols=` call — see the cron table above for why.
2. **Dedup** against `news:seen` by article ID, across all 25 tickers' results.
3. **Pre-score** from Marketaux's own per-entity `match_score` and `sentiment_score`.
4. **Re-rank** the candidates with Claude Haiku in one call (at most 75 articles/cycle now, still one Haiku call — well within its context). Prompt carries each ticker's actual weight and asks for `[{id, impact, reason}]`, JSON only. Parse defensively; on failure fall back to the pre-score ordering rather than showing nothing.
5. **Store** ranked, keep top 60.

**Impact formula:**

```
impact = |sentiment| × relevance × recency_decay × sqrt(weight)
recency_decay = exp(-hours_old / 48)
```

`sqrt(weight)` so NVDA at 14% doesn't permanently own all three highlight slots.

Cost: 3 Haiku calls a day at up to ~5k tokens each now (larger batch, still one call per cycle). Still cents per month.

### Earnings

Finnhub `/calendar/earnings?from=&to=` for upcoming dates and estimates, plus `/stock/earnings` for historical surprises. Free tier, 60 calls/minute.

**Verify Finnhub's free tier still covers both endpoints in Phase 1** before building the UI on top of them — free tiers move, and this is the one external assumption the earnings half of the app rests on. If `/calendar/earnings` has moved behind a paywall, fall back to scraping dates from Marketaux article metadata or maintaining them manually for 24 tickers.

---

## 3. PWA

Static site on Cloudflare Pages. Plain React + Vite — your `apple-design` skill is web-scoped, so it applies directly here with no translation layer, which is the first time in this project that's been true.

**Five views:**

**Today** — the landing screen. Top 3 ranked stories as full cards, each showing which holding it affects, its weight, sentiment, and the one-line reason Haiku gave for the ranking. Below: next earnings date with a countdown.

**News** — search by ticker. Filters: time window (24h/7d/30d), sentiment, sector (GICS 11, only the ones you hold shown), event type (analyst / regulatory / M&A / guidance). Chronological feed underneath, 2–3 per holding.

**Earnings** — upcoming, sorted by proximity, weighted by position size. Past results with reported vs. estimated EPS and revenue and the surprise percentage. A **flagged** section fed by thesis notes, so a position you marked as a live question resurfaces automatically when its report lands. This is the PODD case: the note and the date find each other without you remembering.

**Returns** — total portfolio value, sector pie chart, positions grouped by sector underneath, from §1c. A **Dividends card** (§1d) sits below the sector breakdown — tap it to push the Dividends detail screen. No history in either — a snapshot of right now, not a graph over time.

**Holdings** — the editor from §1. **Sync from Trading 212** button up top. An "Unassigned" section holds anything freshly synced; tap a card to open a sector-picker sheet (the 11 GICS sectors) and assign it. Everything else lists grouped by sector once assigned. Inline weight editing, manual add/remove for anything T212 doesn't carry, ticker validation on manual save. Rarely opened after the first sort, but it's the only place your portfolio is defined, so it shouldn't be buried in Settings.

**Settings** — bearer token, manual refresh, push notification toggle + impact threshold, cache clear.

**Design:** dark only, financial rather than electric. Near-black base (#0B0D11), two elevation steps by luminance not borders, desaturated steel accent, muted green/red. `font-variant-numeric: tabular-nums` everywhere — non-tabular figures in a scrolling list look broken, and the skill doesn't mention it.

**PWA specifics:** web app manifest with `display: standalone`, apple-touch-icon, `theme-color`, service worker caching the last API response so opening it on the metro with no signal still shows yesterday's news rather than a blank screen.

---

## 4. Alerts (Web Push)

No second channel, no bot token. The installed PWA subscribes to Web Push directly.

**Setup:** Worker generates a VAPID key pair once (`web-push` library or manual, stored as Worker secrets). Service worker registers a `PushSubscription` on first app open post-install, POSTs it to `/api/push/subscribe`, stored in `push:subscriptions`.

**iOS constraint:** Web Push only fires for a PWA that's been Added to Home Screen — it does not work from a Safari tab. This is already true of the rest of the app, so nothing new to explain to yourself later.

**Trigger:** Worker cron (the same news/earnings cycles) checks each new ranked story's impact score and each earnings date crossing T-1 against `push:settings.impactThreshold`. Above threshold → `web-push` sends the payload to every stored subscription; service worker's `push` event shows the notification.

**Toggle + threshold, live in Settings:** a switch (`push:settings.enabled`) and a threshold slider, both read/write via `GET`/`PUT /api/push/settings`. Off means the cron still ranks and scores, it just skips the send.

Thresholds: impact above a tuned cutoff (start high, lower it once you see the volume), earnings T-1 for any position above 3% weight, and any story flagged against a thesis note.

---

## 5. Phases

**Phase 0 — Worker skeleton.** Wrangler project, KV namespace, secrets, bearer auth middleware, deploy, one health endpoint. *Milestone: authenticated hello-world in production.*

**Phase 1 — Holdings + earnings.** Trading 212 read-only key, `/equity/portfolio` client, holdings document, `GET`/`PUT /api/holdings`, `POST /api/holdings/sync` (positions in as Unassigned, weight from position value), Finnhub client for manual-add ticker validation, earnings cron, `/api/earnings`. Sync your real positions via curl before the editor UI exists. **Verify Finnhub free-tier coverage before proceeding.** *Milestone: real earnings dates for your real holdings, over HTTP.*

**Phase 2 — News.** Marketaux client, dedup, Haiku ranker, impact scoring, `/api/news` and `/api/news/top`. *Milestone: ranked news over HTTP. The backend is now done.*

**Phase 2a — Returns.** `/equity/portfolio` reused from Phase 1, sector aggregation, `returns:current`, `/api/returns`. *Milestone: real sector P&L over HTTP.*

**Phase 3 — PWA.** Vite + React, five views (Today, News, Earnings, Returns, Holdings, Settings), filters, search, tap-to-sort sector sheet, manifest, service worker, offline cache. Invoke `apple-design` explicitly here. *Milestone: the app is usable.*

**Phase 4 — Push alerts and notes.** VAPID keys, service worker push subscription, `/api/push/*` routes, Settings toggle + threshold, cron-triggered sends, thesis notes with earnings-linked flags. *Milestone: a high-impact story or T-1 earnings date reaches your phone without opening the app.*

**v2 —** forward-building value graph from daily KV snapshots of `returns:current` (cheap now — the snapshot already exists every cycle, only the history accumulation is new), watchlist for AAOI and the quantum ETFs.

Phases 0–2a are the whole backend and are the most self-contained work here. Phase 3 is the longest. Realistically a couple weeks of evenings.

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Finnhub earnings behind paywall | **High** — it's half the app | Verify in Phase 1 before building UI. Fallback: manual dates for 24 tickers |
| T212 read-only key leaks | **Medium** — exposes real portfolio value and P&L, unlike the other keys in this system | Worker secret only, never sent to the PWA; key scoped to read-only at creation so it can't trade or withdraw even if leaked; rotate via `wrangler secret put` |
| T212 API rate limits / shape changes | Low | One call per 30-min cycle; defensive parse with fallback to last-known `returns:current` on failure |
| Marketaux 100/day | Low | One batched call per cycle, 17/day |
| Haiku returns malformed JSON | Low | Strict prompt, defensive parse, fall back to pre-score order |
| iOS Web Push requires home-screen install | Low | Already true of the rest of the app; Settings can show subscription status so a browser-tab visit is obviously not enough |
| Bearer token leaks | Low | Now a write credential via `PUT /api/holdings`. Rotate with `wrangler secret put`. No broker credential exists in this system, so the worst case is a scrambled news ranking |
| Mistyped ticker returns no news silently | Medium | Validate against Finnhub symbol lookup on save; reject unknown symbols at entry |
| Cron doesn't fire | Low | `updatedAt` on every response; PWA shows staleness rather than pretending |

**The one thing to check first:** Finnhub's earnings endpoints on the free tier. Everything else has a workaround; that one determines whether the earnings half exists as designed. Spend twenty minutes with curl before Phase 1 proper.