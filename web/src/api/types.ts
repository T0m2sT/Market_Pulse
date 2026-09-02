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

export interface UpcomingEarning {
  ticker: string;
  name: string;
  logo?: string;
  date: string;
  hour: string;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  isEstimate?: boolean;
}

export interface EarningsResult {
  symbol: string;
  period: string;
  year: number;
  quarter: number;
  estimate: number | null;
  actual: number | null;
  surprisePercent: number | null;
}

export interface EarningsDoc {
  updatedAt: string;
  upcoming: UpcomingEarning[];
  results: Record<string, EarningsResult[]>;
}

export interface TodayEarningsRecap {
  ticker: string;
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  takeaway: string;
  checkedAt: string;
}

export interface RankedArticle {
  id: string;
  ticker: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: number;
  impact: number;
  reason: string;
}

export interface NewsDoc {
  updatedAt: string;
  articles: RankedArticle[];
}

export interface UpcomingDividend {
  ticker: string;
  name: string;
  logo?: string;
  exDate: string;
  paymentDate: string;
  perShare: number;
  qualifyingShares: number;
  estimatedPayment: number;
  locked: boolean;
}

export interface DividendsDoc {
  updatedAt: string;
  upcoming: UpcomingDividend[];
}
