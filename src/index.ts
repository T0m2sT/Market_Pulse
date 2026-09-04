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
import { getEarnings, refreshEarnings } from "./earnings";
import { getReturns, refreshReturns } from "./returns";
import { getBriefings, refreshNews, refreshArticles, refreshBriefings, markBriefingSeen } from "./news";
import { getDividends, refreshDividends } from "./dividends";
import { runBackfill } from "./backfill";

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
      const [rows, holdings] = await Promise.all([
        getDividends(env.DB),
        getHoldings(env.PORTFOLIO_KV),
      ]);
      const byTicker = new Map(holdings.positions.map((p) => [p.ticker, p]));
      const dividends = rows.map((r) => ({
        ...r,
        name: byTicker.get(r.ticker)?.name ?? r.ticker,
        logo: byTicker.get(r.ticker)?.logo,
      }));
      return Response.json({ updatedAt: new Date().toISOString(), dividends });
    }

    if (url.pathname === "/api/dividends/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshDividends(env.DB, env.EODHD_API_KEY, holdings.positions);
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/api/earnings" && request.method === "GET") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      return Response.json(await getEarnings(env.DB, holdings.positions));
    }

    if (url.pathname === "/api/earnings/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshEarnings(env.DB, env.FINNHUB_API_KEY, holdings.positions, env.ANTHROPIC_API_KEY);
      return Response.json({ status: "ok" });
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
      return Response.json(await getBriefings(env.DB));
    }

    if (url.pathname === "/api/news/top" && request.method === "GET") {
      const [doc, holdings] = await Promise.all([
        getBriefings(env.DB),
        getHoldings(env.PORTFOLIO_KV),
      ]);
      const weight = new Map(holdings.positions.map((p) => [p.ticker, p.weight]));
      const latestWeek = doc.briefings[0]?.weekStart;
      const top = doc.briefings
        .filter((b) => b.weekStart === latestWeek)
        .map((b) => ({ b, score: Math.abs(b.sentiment) * Math.sqrt(weight.get(b.ticker) ?? 0) }))
        .sort((a, z) => z.score - a.score)
        .slice(0, 3)
        .map(({ b }) => b);
      return Response.json({ updatedAt: doc.updatedAt, briefings: top });
    }

    if (url.pathname === "/api/news/refresh" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      const doc = await refreshNews(env.DB, env.MARKETAUX_API_KEY, env.ANTHROPIC_API_KEY, holdings.positions);
      return Response.json(doc);
    }

    if (url.pathname === "/api/news/seen" && request.method === "PATCH") {
      const body = (await request.json().catch(() => null)) as { ticker?: string; weekStart?: string } | null;
      if (!body?.ticker || !body?.weekStart) {
        return Response.json({ error: "ticker and weekStart required" }, { status: 400 });
      }
      await markBriefingSeen(env.DB, body.ticker, body.weekStart);
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/api/admin/backfill" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      const result = await runBackfill(env.DB, env, holdings.positions);
      return Response.json({ status: "ok", ...result });
    }



    if (url.pathname === "/api/admin/briefings" && request.method === "POST") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshBriefings(env.DB, env.ANTHROPIC_API_KEY, holdings.positions);
      const doc = await getBriefings(env.DB);
      return Response.json({ status: "ok", briefings: doc.briefings.length });
    }

    return Response.json({ error: "not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withCors(await handle(request, env), request);
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Cron schedules. Cloudflare's day-of-week is SHIFTED: 0=Saturday, 1=Sunday, 2=Monday ... 6=Friday
    // (confirmed empirically in this repo's history — the returns crons use "2-6" for real Mon-Fri;
    // the standard "1-5" silently skipped Friday and fired Sun-Thu instead).
    //
    // Workers FREE tier: max 5 cron triggers per account, 50 subrequests per invocation.
    //  "5 6 * * *"                daily: earnings calendar sync + dividends + up to 8 weekly briefings
    //                             (briefings are guarded to companies with news that week and no
    //                             briefing row yet — a full week drains over ~2 daily runs, keeping
    //                             any one invocation's Claude-call count bounded)
    //  "* 13-19 * * 2-6"          returns snapshot, every minute, regular market hours (9:30am-4pm ET)
    //  "*/5 0-12,20-23 * * 2-6"   returns snapshot, every 5 min, overnight + pre/post market
    //                             (both fetch live T212 prices but do NOT write the holdings doc —
    //                             holdings only change on a manual sync — so each tick is 1 KV write)
    //  "0 6,13,20 * * *"          news article ingest to D1, 3x/day (~25 Marketaux calls/cycle)
    if (event.cron === "5 6 * * *") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshEarnings(env.DB, env.FINNHUB_API_KEY, holdings.positions, env.ANTHROPIC_API_KEY);
      await refreshDividends(env.DB, env.EODHD_API_KEY, holdings.positions);
      await refreshBriefings(env.DB, env.ANTHROPIC_API_KEY, holdings.positions);
      return;
    }

    if (event.cron === "0 6,13,20 * * *") {
      const holdings = await getHoldings(env.PORTFOLIO_KV);
      await refreshArticles(env.DB, env.MARKETAUX_API_KEY, holdings.positions);
      return;
    }

    // Returns crons: live prices only, no KV write for holdings.
    const positions = await fetchMergedTrading212Positions(env.PORTFOLIO_KV, env.T212_API_KEY_ID, env.T212_API_SECRET, env.FINNHUB_API_KEY);
    await refreshReturns(env.PORTFOLIO_KV, positions);
  },
} satisfies ExportedHandler<Env>;
