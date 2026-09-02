export interface FmpDividend {
  symbol: string;
  date: string; // ex-dividend date — confirmed against Yahoo Finance's ex-div history, not labeled as such in FMP's schema
  paymentDate: string;
  dividend: number;
}

export async function fetchDividends(apiKey: string, symbol: string): Promise<FmpDividend[]> {
  const url = `https://financialmodelingprep.com/stable/dividends?symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP error ${res.status} for ${symbol}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as FmpDividend[]) : [];
}
