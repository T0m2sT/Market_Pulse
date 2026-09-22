-- Earnings rebuilt to a clean Finnhub-only model: EPS actual vs estimate + surprise %, 4 quarters
-- per ticker, revenue on the most recent quarter only. Add the surprise column; the Claude-era
-- columns (revenue_yoy_pct, eps_yoy_pct, guidance_text, highlights_text) are left in place but
-- no longer written.
ALTER TABLE earnings_results ADD COLUMN surprise_pct REAL;
