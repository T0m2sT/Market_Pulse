export interface EarningsCalendarEntry {
  symbol: string;
  date: string;
  hour: string;
  quarter: number;
  year: number;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export interface EarningsResult {
  symbol: string;
  period: string;
  quarter: number;
  year: number;
  estimate: number | null;
  actual: number | null;
  surprise: number | null;
  surprisePercent: number | null;
}

async function finnhubGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${token}`);
  if (!res.ok) {
    throw new Error(`Finnhub error ${res.status} on ${path}`);
  }
  return res.json();
}

export async function fetchEarningsCalendar(
  token: string,
  from: string,
  to: string,
): Promise<EarningsCalendarEntry[]> {
  const data = (await finnhubGet(`/calendar/earnings?from=${from}&to=${to}`, token)) as {
    earningsCalendar?: EarningsCalendarEntry[];
  };
  return data.earningsCalendar ?? [];
}

export async function fetchEarningsHistory(token: string, ticker: string): Promise<EarningsResult[]> {
  try {
    const data = (await finnhubGet(`/stock/earnings?symbol=${ticker}`, token)) as unknown;
    return Array.isArray(data) ? (data as EarningsResult[]) : [];
  } catch {
    // Coverage gaps are expected for some tickers (e.g. non-US listings) — skip, don't fail the batch.
    return [];
  }
}

export interface CompanyProfile {
  name: string | null;
  logo: string | null;
}

export async function fetchCompanyProfile(token: string, ticker: string): Promise<CompanyProfile> {
  try {
    const data = (await finnhubGet(`/stock/profile2?symbol=${ticker}`, token)) as {
      name?: string;
      logo?: string;
    };
    return { name: data.name ?? null, logo: data.logo || null };
  } catch {
    // Coverage gap (e.g. non-US listings) — caller falls back to ticker + initials avatar.
    return { name: null, logo: null };
  }
}
