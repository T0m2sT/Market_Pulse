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
