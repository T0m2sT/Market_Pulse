# Market Pulse

A personal portfolio tracker: holdings synced from Trading212, weekly AI-written
news briefings per holding, an earnings calendar, and dividend tracking. Backend
is a Cloudflare Worker (D1 + KV); frontend is a React PWA.

## Architecture

- `src/`: Cloudflare Worker (API + cron jobs), data in D1 (`market-pulse`) and KV (`PORTFOLIO_KV`).
- `web/`: React PWA that talks to the Worker over HTTP.

All third-party API keys live **only** on the Worker, as Cloudflare secrets. The
browser never sees them, it only holds a bearer token that authenticates it to
your own Worker (see [Bearer token](#bearer-token) below).

## Setup

### 1. Cloudflare resources

```bash
npm install
npx wrangler kv namespace create PORTFOLIO_KV
npx wrangler d1 create market-pulse
```

Put the returned IDs into `wrangler.jsonc` (`kv_namespaces[0].id`, `d1_databases[0].database_id`).

Apply the schema:

```bash
npx wrangler d1 migrations apply market-pulse --remote
```

### 2. API keys: what you need and where to get them

Every key below is set as a Worker **secret** (`npx wrangler secret put <NAME>`),
never committed to the repo and never sent to the browser.

| Secret | Used for | Where to get it | Free tier |
| --- | --- | --- | --- |
| `API_TOKEN` | Your own bearer token, gates every request to your Worker | Make one up yourself, e.g. `openssl rand -hex 32` | n/a |
| `T212_API_KEY_ID` | Trading212, pulls your live portfolio positions | Trading212 app → Settings → API (Invest account) → generate key | Free, personal use |
| `T212_API_SECRET` | Trading212, paired with the key ID above | Same place as above | Free |
| `FINNHUB_API_KEY` | Earnings calendar + historical EPS results | [finnhub.io/register](https://finnhub.io/register) | Free tier, rate-limited |
| `MARKETAUX_API_KEY` | Raw news articles per holding, feeds the weekly briefing | [marketaux.com](https://www.marketaux.com/) → sign up → API token | Free tier: 100 requests/day |
| `ANTHROPIC_API_KEY` | Claude, writes the weekly news briefings | [console.anthropic.com](https://console.anthropic.com/) → API Keys | Pay-as-you-go, no free tier |
| `EODHD_API_KEY` | Dividend ex-date / pay-date / amount data | [eodhd.com](https://eodhd.com/) → register → API key | Free tier available |

Set each one:

```bash
npx wrangler secret put API_TOKEN
npx wrangler secret put T212_API_KEY_ID
npx wrangler secret put T212_API_SECRET
npx wrangler secret put FINNHUB_API_KEY
npx wrangler secret put MARKETAUX_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put EODHD_API_KEY
```

For local development, put the same values in a `.dev.vars` file at the repo
root (already gitignored, never commit this file):

```
API_TOKEN=...
T212_API_KEY_ID=...
T212_API_SECRET=...
FINNHUB_API_KEY=...
MARKETAUX_API_KEY=...
ANTHROPIC_API_KEY=...
EODHD_API_KEY=...
```

### 3. Deploy the Worker

```bash
npx wrangler deploy
```

### 4. Run the frontend

```bash
cd web
cp .env.example .env
# edit .env: set VITE_API_BASE to your deployed Worker URL (printed by wrangler deploy)
npm install
npm run dev
```

### Bearer token

The PWA's **Settings** page has a "Bearer token" field, this is the `API_TOKEN`
value you generated in step 2. It's stored in the browser's `localStorage` and
sent as an `Authorization: Bearer <token>` header on every API call. It's the
only credential that ever touches the browser; it authenticates *you* to *your*
Worker, and carries none of the provider API keys above.

## Development

```bash
npm test              # Worker unit tests (vitest)
cd web && npm run lint
```
