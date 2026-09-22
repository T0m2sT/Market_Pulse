-- Store Finnhub's fiscal quarter + year on result rows so offset-fiscal-year companies
-- (NVDA, MSFT, AVGO, TJX) get labelled "Q2 FY2027" instead of a mis-derived calendar quarter.
-- Also add announced_date: the actual report date (from calendar/earnings) which aligns with the
-- calendar dot, distinct from `date` which is the fiscal quarter-end (can be a future date).
ALTER TABLE earnings_results ADD COLUMN fiscal_quarter INTEGER;
ALTER TABLE earnings_results ADD COLUMN fiscal_year INTEGER;
ALTER TABLE earnings_results ADD COLUMN announced_date TEXT;
