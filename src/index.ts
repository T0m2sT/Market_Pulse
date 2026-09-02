import { checkAuth } from "./auth";
import { corsHeaders, withCors } from "./cors";
import {
  getHoldings,
  putHoldings,
  syncFromTrading212,
  fetchMergedTrading212Positions,
  isValidHoldingsInput,
  normaliseInputWeights,
} from "./holdings";
import {
  getUpcomingEarnings,
  getEarningsResults,
  refreshEarnings,
  getTodayEarningsRecaps,
  refreshTodayEarningsRecaps,
} from "./earnings";
import { getReturns, refreshReturns } from "./returns";
import { getRankedNews, refreshNews } from "./news";
import { getUpcomingDividends, refreshDividends } from "./dividends";

async function handle(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (!checkAuth(request, env.API_TOKEN)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok", updatedAt: new Date().toISOString() });
    }

    if (url.pathname === "/api/holdings" && request.method === "GET") {
      return Response.json(await getHoldings(env.PORTFOLIO_KV));
    }

    if (url.pathname === "/api/holdings" && request.method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!isValidHoldingsInput(body)) {
        return Response.json({ error: "invalid holdings payload" }, { status: 400 });
      }
      const doc = await putHoldings(env.PORTFOLIO_KV, normaliseInputWeights(body));
      return Response.json(doc);
    }

    if (url.pathname === "/api/holdings/sync" && request.method === "POST") {
      try {
        const doc = await syncFromTrading212(env.PORTFOLIO_KV, env.T212_API_KEY_ID, env.T212_API_SECRET, env.FINNHUB_API_KEY);
        return Response.json(doc);
      } catch (err) {
        return Response.json({ error: "trading212 sync failed" }, { status: 502 });
      }
    }

    if (url.pathname === "/api/dividends" && request.method === "GET") {
      const upcoming = await getUpcomingDividends(env.PORTFOLIO_KV);
      return Response.json({ updatedAt: new Date().toISOString(), upcoming });
    }

    if (url.pathname === "/api/dividends/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      const upcoming = await refreshDividends(env.PORTFOLIO_KV, env.FMP_API_KEY, holdings.positions);
      return Response.json({ updatedAt: new Date().toISOString(), upcoming });
    }

    if (url.pathname === "/api/earnings" && request.method === "GET") {
      const [upcoming, results] = await Promise.all([
        getUpcomingEarnings(env.PORTFOLIO_KV),
        getEarningsResults(env.PORTFOLIO_KV),
      ]);
      return Response.json({ updatedAt: new Date().toISOString(), upcoming, results });
    }

    if (url.pathname === "/api/earnings/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshEarnings(env.PORTFOLIO_KV, env.FINNHUB_API_KEY, holdings.positions, env.ANTHROPIC_API_KEY);
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/api/earnings/today-recaps" && request.method === "GET") {
      return Response.json(await getTodayEarningsRecaps(env.PORTFOLIO_KV));
    }

    if (url.pathname === "/api/returns" && request.method === "GET") {
      const doc = await getReturns(env.PORTFOLIO_KV);
      return doc
        ? Response.json(doc)
        : Response.json({ error: "no returns snapshot yet" }, { status: 404 });
    }

    if (url.pathname === "/api/returns/refresh" && request.method === "POST") {
      try {
        const holdingsDoc = await syncFromTrading212(env.PORTFOLIO_KV, env.T212_API_KEY_ID, env.T212_API_SECRET, env.FINNHUB_API_KEY);
        const doc = await refreshReturns(env.PORTFOLIO_KV, holdingsDoc.positions);
        return Response.json(doc);
      } catch (err) {
        // T212 hiccup — fall back to the last-known snapshot rather than erroring; updatedAt shows the staleness.
        const stale = await getReturns(env.PORTFOLIO_KV);
        return stale
          ? Response.json(stale)
          : Response.json({ error: "returns refresh failed, no prior snapshot" }, { status: 502 });
      }
    }

    if (url.pathname === "/api/news" && request.method === "GET") {
      const doc = await getRankedNews(env.PORTFOLIO_KV);
      return Response.json(doc);
    }

    if (url.pathname === "/api/news/top" && request.method === "GET") {
      const doc = await getRankedNews(env.PORTFOLIO_KV);
      return Response.json({ updatedAt: doc.updatedAt, articles: doc.articles.slice(0, 3) });
    }

    if (url.pathname === "/api/news/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      const doc = await refreshNews(
        env.PORTFOLIO_KV,
        env.MARKETAUX_API_KEY,
        env.ANTHROPIC_API_KEY,
        holdings.positions,
      );
      return Response.json(doc);
    }

    return Response.json({ error: "not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withCors(await handle(request, env), request);
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Four independent cron schedules, distinguished by cron expression:
    //  - "5 6 * * *"              daily earnings calendar (Finnhub)
    //  - "* 13-19 * * 2-6"        returns snapshot, every minute during regular market hours (9:30am-4pm ET)
    //  - "*/5 8-12,20-23 * * 2-6" returns snapshot, every 5min during pre/post-market (4am-9:30am, 4pm-8pm ET)
    //                             (both fetch live T212 prices for computing returns but do NOT write
    //                             the holdings doc — holdings only change on a manual sync, see
    //                             fetchMergedTrading212Positions vs syncFromTrading212 in holdings.ts —
    //                             so each tick costs exactly 1 KV write, not 2)
    //  - "0 6,13,20 * * *"        news, 3x/day (25 Marketaux calls/cycle — see marketaux.ts for why so infrequent);
    //                             also refreshes today's earnings recaps (cache-hit no-op once a ticker's recap exists)
    //
    // Weekday field is shifted vs standard cron — confirmed empirically in the dashboard's cron
    // preview: Cloudflare's day-of-week 0=Saturday (not Sunday), so real Mon-Fri is "2-6", NOT the
    // standard "1-5" (which silently skipped Fri and fired Sun-Thu instead — this is why the
    // every-minute/every-5min crons above went dark for hours despite looking correct and matching
    // the docs' Mon-Fri convention).
    if (event.cron === "5 6 * * *") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshEarnings(env.PORTFOLIO_KV, env.FINNHUB_API_KEY, holdings.positions, env.ANTHROPIC_API_KEY);
      await refreshDividends(env.PORTFOLIO_KV, env.FMP_API_KEY, holdings.positions);
      return;
    }

    if (event.cron === "0 6,13,20 * * *") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshNews(env.PORTFOLIO_KV, env.MARKETAUX_API_KEY, env.ANTHROPIC_API_KEY, holdings.positions);
      await refreshTodayEarningsRecaps(env.PORTFOLIO_KV, env.ANTHROPIC_API_KEY, holdings.positions);
      return;
    }

    // Live prices only, no KV write for holdings — holdings only change on a manual sync
    // (POST /api/returns/refresh or PUT /api/holdings), never automatically.
    const positions = await fetchMergedTrading212Positions(env.PORTFOLIO_KV, env.T212_API_KEY_ID, env.T212_API_SECRET, env.FINNHUB_API_KEY);
    await refreshReturns(env.PORTFOLIO_KV, positions);
  },
} satisfies ExportedHandler<Env>;
