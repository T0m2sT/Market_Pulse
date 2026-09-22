export interface T212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
}

const US_TICKER = /_[A-Z]+_EQ$/;
const LSE_TICKER = /l_EQ$/;

export function stripTickerSuffix(t212Ticker: string): string {
  if (LSE_TICKER.test(t212Ticker)) {
    // T212 encodes LSE tickers as e.g. "KAPl_EQ" for "KAP.L" — no exchange code,
    // trailing "l" standing in for the dot.
    return `${t212Ticker.slice(0, -"l_EQ".length)}.L`;
  }
  return t212Ticker.replace(US_TICKER, "");
}

export async function fetchPortfolio(keyId: string, secret: string): Promise<T212Position[]> {
  const credentials = btoa(`${keyId}:${secret}`);
  const res = await fetch("https://live.trading212.com/api/v0/equity/portfolio", {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    throw new Error(`Trading 212 API error: ${res.status}`);
  }

  return res.json();
}
