-- Manual D1 round-trip check. Run against local:
--   npx wrangler d1 execute market-pulse --local --file ./scripts/db-smoke.sql
-- Expect: one row  TEST | 5.34 | 0  then the delete succeeds.
INSERT INTO dividends (ticker, ex_date, payment_date, per_share_usd, per_share_eur, qualifying_shares, amount_eur, yield_pct, locked, updated_at)
VALUES ('TEST', '2026-08-15', '2026-09-01', 1.7, 1.56, 3.42, 5.34, 6.2, 0, '2026-09-02T00:00:00Z')
ON CONFLICT (ticker, ex_date) DO UPDATE SET amount_eur = excluded.amount_eur;

SELECT ticker, amount_eur, locked FROM dividends WHERE ticker = 'TEST';

DELETE FROM dividends WHERE ticker = 'TEST';
