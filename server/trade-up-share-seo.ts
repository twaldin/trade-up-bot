import type { Express, NextFunction, Request, Response } from "express";
import type pg from "pg";
import { tradeUpDescription, tradeUpDocumentTitle, tradeUpOgTitle, tradeUpPair } from "../shared/copy.js";
import { tradeUpDetailJsonLd } from "../shared/types.js";
import { inputsAreRedacted } from "./routes/trade-ups.js";
import { buildSeoHtml, deletedTradeUpStatus, injectMetaIntoSpa, isCrawler, renderTradeUpDetail } from "./seo.js";

/** Crawler and SPA-shell HTML for /trade-ups/:id. Fresh rows hide per-input price and source. */
export function registerTradeUpDetailRoute(app: Express, pool: pg.Pool): void {
  app.get("/trade-ups/:id", (req, res, next) => {
    void handleTradeUpShareSeo(pool, req, res, next);
  });
}

export function registerTradeUpShareSeo(app: Express, pool: pg.Pool): void {
  registerTradeUpDetailRoute(app, pool);
}

export async function handleTradeUpShareSeo(
  pool: pg.Pool,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ua = req.headers["user-agent"] || "";
  const id = String(req.params.id);
  try {
    if (!/^\d+$/.test(id)) {
      const status = deletedTradeUpStatus(id);
      res.status(status).set("X-Robots-Tag", "noindex").send("Trade-up not found");
      return;
    }
    const { rows: [row] } = await pool.query(
      "SELECT id, type, total_cost_cents, profit_cents, roi_percentage, chance_to_profit, listing_status, preserved_at, outcomes_json, created_at FROM trade_ups WHERE id = $1",
      [req.params.id],
    );
    if (!row) {
      const status = deletedTradeUpStatus(String(req.params.id));
      res.status(status).set("X-Robots-Tag", "noindex").send(
        status === 410 ? "Trade-up no longer available" : "Trade-up not found",
      );
      return;
    }
    const isStale = row.listing_status === "stale"
      || (row.preserved_at && Date.now() - new Date(row.preserved_at).getTime() > 7 * 24 * 60 * 60 * 1000);

    const { rows: inputs } = await pool.query(
      "SELECT skin_name, condition, collection_name, price_cents, source FROM trade_up_inputs WHERE trade_up_id = $1",
      [row.id],
    );
    const hideInputCommercials = await inputsAreRedacted(pool, req, row.id, row.created_at);

    const outcomes = JSON.parse(row.outcomes_json || "[]") as Array<{
      skin_name: string; probability: number; predicted_condition: string; estimated_price_cents: number;
    }>;

    const collections = [...new Set(inputs.map((i: { collection_name: string }) => i.collection_name))];
    const related = [
      ...collections.map((c: string) => ({
        label: `${c.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "")} Collection Trade-Ups`,
        url: `/trade-ups/collection/${c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      })).slice(0, 2),
      { label: "All CS2 Trade-Ups", url: "/trade-ups" },
      { label: "Browse CS2 Collections", url: "/collections" },
    ];

    const inputNames = inputs.map((i: { skin_name: string }) => i.skin_name);
    const collectionNames = inputs.map((i: { collection_name: string }) => i.collection_name);
    const pair = tradeUpPair(row.type, outcomes);

    const meta = {
      title: tradeUpDocumentTitle(row.type, outcomes, collectionNames),
      ogTitle: tradeUpOgTitle(row.type, row.profit_cents, outcomes),
      description: tradeUpDescription({
        type: row.type,
        profitCents: row.profit_cents,
        costCents: row.total_cost_cents,
        chanceToProfit: row.chance_to_profit ?? 0,
        outcomes,
        inputNames,
      }),
      url: `https://tradeupbot.app/trade-ups/${req.params.id}`,
      ogImage: `https://tradeupbot.app/og/trade-ups/${req.params.id}.png`,
      robots: isStale ? "noindex, follow" : "index, follow",
      includeLegal: true,
      jsonLd: tradeUpDetailJsonLd(id, pair),
      bodyHtml: renderTradeUpDetail(
        { id: row.id, type: row.type, total_cost_cents: row.total_cost_cents, profit_cents: row.profit_cents, roi_percentage: row.roi_percentage, chance_to_profit: row.chance_to_profit },
        inputs,
        outcomes,
        related,
        { hideInputCommercials },
      ),
    };

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie, Authorization");
    if (isCrawler(ua)) {
      res.send(buildSeoHtml(meta));
      return;
    }
    const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
    if (!shellHtmlLocal) {
      next();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.send(injectMetaIntoSpa(shellHtmlLocal, meta));
  } catch (err) {
    console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err);
    next();
  }
}
