export const SECTORS = [
  "Energy",
  "Materials",
  "Industrials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Information Technology",
  "Communication Services",
  "Utilities",
  "Real Estate",
  "Unassigned",
] as const;

export type Sector = (typeof SECTORS)[number];

export interface Holding {
  ticker: string;
  displayTicker?: string;
  name: string;
  logo?: string;
  weight: number;
  sector: Sector;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  isManual: boolean;
  finnhubTicker?: string;
  marketauxTicker?: string;
}

export interface HoldingsDoc {
  updatedAt: string;
  positions: Holding[];
}

export interface PositionReturn {
  ticker: string;
  displayTicker?: string;
  name: string;
  logo?: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  isManual: boolean;
}

export interface SectorReturn {
  sector: Sector;
  value: number;
  pnl: number;
  pnlPercent: number;
  positions: PositionReturn[];
}

export interface ReturnsDoc {
  updatedAt: string;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  sectors: SectorReturn[];
}

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
  eps: number | null;
  epsEstimate: number | null;
  surprisePct: number | null;
  /** Revenue is only available for the most recently reported quarter (Finnhub free tier). */
  revenue: number | null;
  revenueEstimate: number | null;
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
