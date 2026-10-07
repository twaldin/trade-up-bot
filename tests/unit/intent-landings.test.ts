import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeoHtml } from "../../server/seo.js";
import { mountIntentRoutes } from "../../server/intent-routes.js";
import {
  buildIntentSnapshotQuery,
  clearIntentSnapshotCache,
  loadIntentSnapshot,
} from "../../server/intent-snapshot.js";
import { shouldRedirectToNoTrailingSlash } from "../../server/canonical-redirects.js";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";
import { pageFor } from "../../src/preview/lib/console-routes.js";
import {
  BEST_TRADE_UPS_PATH,
  TRADE_UP_TIERS,
  TRADE_UP_TIERS_PATH,
  intentPageForPath,
  intentPages,
  renderIntentDocument,
  tierPath,
  type IntentRow,
  type IntentSnapshot,
} from "../../src/preview/lib/intent-landings.js";
import type pg from "pg";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const appSource = readFileSync(join(__dir, "../../src/App.tsx"), "utf-8");
const previewIntent = readFileSync(join(__dir, "../../src/preview/pages/PreviewIntent.tsx"), "utf-8");

const BANNED = /profitable CS2 trade-ups|\bodds\b|chance to profit|chance-to-profit|% chance|\brolls?\b|guaranteed|jackpot|gamble|\bbet\b|\bwin\b|case key|case opening|Find Profitable|Live Profitable/i;

function row(partial: Partial<IntentRow> & Pick<IntentRow, "id" | "type">): IntentRow {
  return {
    total_cost_cents: 2500,
    profit_cents: 1800,
    roi_percentage: 72,
    chance_to_profit: 0.41,
    ...partial,
  };
}

function snapshot(): IntentSnapshot {
  const byType: Record<string, IntentRow[]> = {};
  for (const tier of TRADE_UP_TIERS) {
    byType[tier.type] = [row({ id: 1000 + tier.inputCount, type: tier.type, profit_cents: tier.inputCount * 100 })];
  }
  return {
    active: 1200,
    profitable: 340,
    top: [
      row({ id: 42, type: "covert_knife", profit_cents: 250000, total_cost_cents: 400000, roi_percentage: 62.5, chance_to_profit: 0.33 }),
      row({ id: 43, type: "classified_covert", profit_cents: 4200 }),
    ],
    byType,
  };
}

describe("intent landing documents", () => {
  const pages = intentPages();

  it("covers the best-right-now page and every rarity tier", () => {
    expect(pages.map((page) => page.path)).toEqual([
      "/best-cs2-trade-ups",
      "/trade-ups/tiers",
      "/trade-ups/tiers/knife",
      "/trade-ups/tiers/covert",
      "/trade-ups/tiers/classified",
      "/trade-ups/tiers/restricted",
      "/trade-ups/tiers/mil-spec",
      "/trade-ups/tiers/industrial",
    ]);
    expect(intentPageForPath("/trade-ups/tiers/nope")).toBeNull();
    expect(intentPageForPath("/trade-ups/tiers/covert/extra")).toBeNull();
  });

  it("gives each page a unique title, description, canonical, and h1", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const page of pages) {
      const doc = renderIntentDocument(page, snapshot());
      expect(titles.has(doc.title), doc.title).toBe(false);
      expect(descriptions.has(doc.description), doc.description).toBe(false);
      titles.add(doc.title);
      descriptions.add(doc.description);
      const html = buildSeoHtml({
        title: doc.title,
        description: doc.description,
        url: doc.url,
        bodyHtml: doc.bodyHtml,
        jsonLd: doc.jsonLd,
      });
      expect(html).toContain(`<title>${doc.title}</title>`);
      expect(html).toContain(`<link rel="canonical" href="${doc.url}" />`);
      expect(html.match(/<h1>/g)).toHaveLength(1);
      expect(html).toContain(`<h1>${doc.h1}</h1>`);
      expect(html).toContain("CSFloat 2.8%");
      expect(html).toContain("Outcome prices are after CSFloat's 2% seller fee.");
      expect(html).toContain("Open the board");
      expect(html).toContain("The free view is delayed 3 hours.");
      expect(html).not.toContain("Open the live board");
      expect(html).toContain("Signing in with Steam is free.");
      expect(html).toContain('href="/pricing">See Pro plans</a>');
      expect(html).toContain("$6.99/mo");
      expect(html).not.toMatch(BANNED);
      const types = doc.jsonLd.map((block) => block["@type"]);
      expect(types).toContain("BreadcrumbList");
      expect(types).toContain("FAQPage");
    }
  });

  it("lists live rows on the best page and only that tier on a tier page", () => {
    const best = intentPageForPath(BEST_TRADE_UPS_PATH)!;
    const bestDoc = renderIntentDocument(best, snapshot());
    expect(bestDoc.bodyHtml).toContain('href="/trade-ups/42"');
    expect(bestDoc.bodyHtml).toContain("+$2500.00");
    expect(bestDoc.bodyHtml).toContain("1,200 active trade-ups");
    expect(bestDoc.bodyHtml).toContain("340 with positive expected profit after fees");
    const itemList = bestDoc.jsonLd.find((block) => block["@type"] === "ItemList");
    expect(itemList?.numberOfItems).toBe(2);

    const covert = intentPageForPath(tierPath("covert"))!;
    const covertDoc = renderIntentDocument(covert, snapshot());
    expect(covertDoc.bodyHtml).toContain("10 Classified skins");
    expect(covertDoc.bodyHtml).toContain("70% of the draw is a Recoil Covert");
    expect(covertDoc.bodyHtml).not.toContain('href="/trade-ups/42"');
    expect(covertDoc.h1).toBe("Covert trade-ups");

    const knife = intentPageForPath(tierPath("knife"))!;
    const knifeDoc = renderIntentDocument(knife, snapshot());
    expect(knifeDoc.bodyHtml).toContain("5 Covert skins, not 10");
    expect(knifeDoc.bodyHtml).toContain("60% of the draw");
  });

  it("still explains the draw when the board snapshot is empty", () => {
    const page = intentPageForPath(TRADE_UP_TIERS_PATH)!;
    const doc = renderIntentDocument(page, { active: null, profitable: null, top: [], byType: {} });
    expect(doc.bodyHtml).toContain("Gun tiers take 10 inputs");
    expect(doc.bodyHtml).toContain('href="/trade-ups/tiers/covert"');
    expect(doc.bodyHtml).not.toContain("active trade-ups,");
    expect(doc.jsonLd.some((block) => block["@type"] === "ItemList")).toBe(false);
  });

  it("is listed in the static sitemap and linked from the trade-up hub", () => {
    const xml = buildStaticSitemap("https://tradeupbot.app", "2026-10-05");
    for (const page of pages) {
      expect(xml).toContain(`<loc>https://tradeupbot.app${page.path}</loc>`);
    }
    expect(serverSource).toContain('href="/best-cs2-trade-ups"');
    expect(serverSource).toContain('href="/trade-ups/tiers"');
    expect(serverSource).toContain('href="/trade-ups/tiers/covert"');
  });
});

describe("intent snapshot query", () => {
  it("limits each branch and only asks for the six public tiers", () => {
    const query = buildIntentSnapshotQuery();
    expect(query.text).toContain("LIMIT 12");
    expect(query.text).toContain("LIMIT 8");
    expect(query.text).toContain("profit_cents > 100");
    expect(query.text).toContain("listing_status = 'active'");
    expect(query.text).toContain("is_theoretical = false");
    expect(query.text).toContain("INTERVAL '7 days'");
    expect(query.text).not.toContain("covert_knife");
    expect(query.values[0]).toEqual(TRADE_UP_TIERS.map((tier) => tier.type));
    expect(query.values).toHaveLength(TRADE_UP_TIERS.length + 1);
    expect(query.text.match(/UNION ALL/g)).toHaveLength(TRADE_UP_TIERS.length);
  });

  it("queries once, then serves the memory cache", async () => {
    clearIntentSnapshotCache();
    let calls = 0;
    const pool = {
      query: async () => {
        calls += 1;
        return { rows: [] };
      },
    } as unknown as pg.Pool;
    const stored = new Map<string, IntentSnapshot>();
    const deps = {
      loadCounts: async () => ({ active: 4, profitable: 2 }),
      cacheGet: async () => null,
      cacheSet: async (_key: string, data: IntentSnapshot) => { stored.set("hit", data); },
    };
    const first = await loadIntentSnapshot(pool, deps);
    const second = await loadIntentSnapshot(pool, deps);
    expect(calls).toBe(1);
    expect(first.active).toBe(4);
    expect(second.profitable).toBe(2);
    expect(stored.get("hit")?.top).toEqual([]);
    clearIntentSnapshotCache();
  });
});

describe("intent routes", () => {
  function appWith(snapshot: IntentSnapshot, shell = true) {
    const app = express();
    if (shell) {
      app.locals.shellHtml = "<!DOCTYPE html><html><head><title>old</title></head><body><div id=\"root\"><p>shell</p></div></body></html>";
    }
    mountIntentRoutes(app, async () => snapshot);
    return app;
  }

  it("sends Googlebot a document with the table and no app bundle", async () => {
    const response = await request(appWith(snapshot()))
      .get("/trade-ups/tiers/covert")
      .set("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/html/);
    expect(response.text).toContain("<h1>Covert trade-ups</h1>");
    expect(response.text).toContain('<link rel="canonical" href="https://tradeupbot.app/trade-ups/tiers/covert" />');
    expect(response.text).toContain('"@type":"FAQPage"');
    expect(response.text).toContain("Above cost");
    expect(response.text).not.toContain("/assets/");
    expect(response.text).not.toContain("<p>shell</p>");
    expect(response.text).not.toMatch(BANNED);
  });

  it("injects the same body into the shell for browsers", async () => {
    const response = await request(appWith(snapshot()))
      .get("/best-cs2-trade-ups")
      .set("User-Agent", "Mozilla/5.0")
      .expect(200);

    expect(response.text).toContain("<h1>Best CS2 trade-ups right now</h1>");
    expect(response.text).toContain('href="/trade-ups/42"');
    expect(response.text).not.toContain("<p>shell</p>");
    expect(response.text).toContain('rel="canonical" href="https://tradeupbot.app/best-cs2-trade-ups"');
  });

  it("404s an unknown tier instead of the trade-up detail route", async () => {
    const response = await request(appWith(snapshot()))
      .get("/trade-ups/tiers/not-a-tier")
      .set("User-Agent", "Googlebot")
      .expect(404);
    expect(response.headers["x-robots-tag"]).toBe("noindex");
    expect(response.text).toContain("Tier not found");
  });

  it("redirects trailing slashes and is registered before /trade-ups/:id", () => {
    expect(shouldRedirectToNoTrailingSlash("/best-cs2-trade-ups/")).toBe(true);
    expect(shouldRedirectToNoTrailingSlash("/trade-ups/tiers/")).toBe(true);
    expect(shouldRedirectToNoTrailingSlash("/trade-ups/tiers/covert/")).toBe(true);
    expect(shouldRedirectToNoTrailingSlash("/best-cs2-trade-ups")).toBe(false);
    const intentAt = serverSource.indexOf("registerIntentRoutes(app, pool)");
    const detailAt = serverSource.indexOf("registerTradeUpDetailRoute(app, pool)");
    expect(intentAt).toBeGreaterThan(-1);
    expect(intentAt).toBeLessThan(detailAt);
    expect(appSource).toContain('path="/best-cs2-trade-ups" element={<ConsoleApp page="intent" />}');
    expect(appSource).toContain('path="/trade-ups/tiers/:slug" element={<ConsoleApp page="intent" />}');
    expect(pageFor(undefined, "/best-cs2-trade-ups")).toBe("intent");
    expect(pageFor(undefined, "/trade-ups/tiers/covert")).toBe("intent");
    expect(pageFor(undefined, "/trade-ups/123")).toBe("share");
  });

  it("wires the signup and board clicks to the existing events", () => {
    expect(previewIntent).toContain('trackSteamContinue()');
    expect(previewIntent).toContain('trackEvent("sign_up_start", { location })');
    expect(previewIntent).toContain('trackCtaClick("intent_board")');
    expect(previewIntent).toContain("SIGN_IN_TO_CLAIM");
  });
});
