/**
 * First HTML for the search landing pages. Crawlers get a document with no
 * JS bundle. Browsers get the same body injected into the SPA shell.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type pg from "pg";
import { buildSeoHtml, injectMetaIntoSpa, isCrawler } from "./seo.js";
import { loadIntentSnapshot, type IntentSnapshotDeps } from "./intent-snapshot.js";
import {
  BEST_TRADE_UPS_PATH,
  TRADE_UP_TIERS_PATH,
  intentPageForPath,
  renderIntentDocument,
  type IntentSnapshot,
} from "../src/preview/lib/intent-landings.js";

const PATHS = [BEST_TRADE_UPS_PATH, TRADE_UP_TIERS_PATH, `${TRADE_UP_TIERS_PATH}/:slug`];

function notFoundHtml(): string {
  return buildSeoHtml({
    title: "Trade-up tier not found | TradeUpBot",
    description: "That trade-up tier is not on TradeUpBot.",
    url: "https://tradeupbot.app/trade-ups/tiers",
    robots: "noindex, follow",
    bodyHtml: `<h1>Tier not found</h1><p><a href="/trade-ups/tiers">See trade-ups by rarity</a>.</p>`,
  });
}

export function mountIntentRoutes(
  app: Express,
  load: () => Promise<IntentSnapshot>,
): void {
  const handler = async (req: Request, res: Response, next: NextFunction) => {
    const page = intentPageForPath(req.path);
    if (!page) {
      res.status(404).set("X-Robots-Tag", "noindex").type("html").send(notFoundHtml());
      return;
    }
    try {
      const snapshot = await load();
      const doc = renderIntentDocument(page, snapshot);
      const ua = req.headers["user-agent"] || "";
      res.setHeader("Content-Type", "text/html");
      if (isCrawler(ua)) {
        res.send(buildSeoHtml({
          title: doc.title,
          description: doc.description,
          url: doc.url,
          bodyHtml: doc.bodyHtml,
          jsonLd: doc.jsonLd,
          includeLegal: true,
        }));
        return;
      }
      const shellHtml = req.app.locals.shellHtml;
      if (typeof shellHtml !== "string") {
        next();
        return;
      }
      res.send(injectMetaIntoSpa(shellHtml, {
        title: doc.title,
        description: doc.description,
        url: doc.url,
        bodyHtml: doc.bodyHtml,
        jsonLd: doc.jsonLd,
      }));
    } catch (err) {
      console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err);
      next();
    }
  };

  for (const path of PATHS) app.get(path, handler);
}

export function registerIntentRoutes(app: Express, pool: pg.Pool, deps?: IntentSnapshotDeps): void {
  mountIntentRoutes(app, () => loadIntentSnapshot(pool, deps));
}
