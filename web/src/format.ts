/** Portfolio-derived money (Returns, Dividends) is always in the T212 account currency (EUR). */
export function eur(value: number): string {
  return `€${value.toFixed(2)}`;
}

/** Provider financial data (EPS, revenue estimates) stays in the company's own reporting currency — not converted. */
export function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Revenue figures come back as raw dollars (e.g. 93,634,391,959) — abbreviate for a readable card. */
export function abbreviateUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/** Finnhub's `period` is the fiscal quarter-end date (e.g. "2026-06-30"), not the announcement
 * date — most US large-caps share calendar-quarter boundaries, so this looks identical across
 * unrelated tickers. Label it as a calendar quarter (derived from `period`'s own date, not
 * Finnhub's internal fiscal year/quarter numbering) so it reads as "the quarter ending this date"
 * — e.g. a quarter ending 2026-06-30 is Q2 2026, regardless of what fiscal quarter number the
 * company itself calls it (NVDA's fiscal calendar is offset from the calendar year, so its own
 * "Q2 FY2027" fiscal label would otherwise show as "Q2 2027" here, which is confusing next to
 * every other holding's calendar-quarter labels). */
export function fiscalQuarterLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return `Q${Math.ceil(month / 3)} ${year}`;
}
