import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import {
  captureServerLandingStats,
  injectLandingStats,
  LANDING_STAT_PLACEHOLDER,
  landingStatPlaceholderTiles,
  landingStatsFromMarkup,
  landingStatsFromSources,
  nextHeroGlobal,
  publishedTradeUpCounts,
  formatLandingStat,
  renderLandingStatsHtml,
  serverLandingStats,
  visibleLandingStatTiles,
} from "../../src/preview/lib/landing-stats.js";
import { renderHomepageSeoBody } from "../../server/static-seo-pages.js";
import { HOMEPAGE_SEO } from "../../server/static-seo-pages.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const landing = read("../../src/preview/pages/PreviewLanding.tsx");
const app = read("../../src/preview/PreviewApp.tsx");
const main = read("../../src/main.tsx");
const css = read("../../src/preview/preview.css");
const server = read("../../server/index.ts");
const prerender = read("../../scripts/prerender.ts");
const seoPages = read("../../server/static-seo-pages.ts");

const ZERO_GLOBAL = {
  total_trade_ups: 0,
  profitable_trade_ups: 0,
  total_data_points: 0,
  total_cycles: 0,
};

const LIVE_GLOBAL = {
  total_trade_ups: 1842,
  profitable_trade_ups: 311,
  total_data_points: 2_405_119,
  total_cycles: 86,
};

const LIVE_BOARD = {
  trade_ups: [makeTradeUp({ id: 11 }), makeTradeUp({ id: 12 })],
  total: 1842,
  total_profitable: 311,
};

function prerenderedZeroHero(): string {
  return `<section class="preview-hero">
    <div class="preview-toolbar o-arrive"><a href="/trade-ups">Find Real Tradeups -&gt;</a></div>
    <div class="preview-stats o-arrive">
      <div><b>0</b><span>trade-ups</span></div>
      <div><b>0</b><span>profitable</span></div>
      <div><b>0</b><span>data points</span></div>
      <div><b>0</b><span>cycles analyzed</span></div>
    </div>
  </section>
  <div class="preview-laptop"></div>`;
}

describe("landing stats from the board + global-stats", () => {
  it("does not invent numbers when both sources are empty", () => {
    const stats = landingStatsFromSources({});
    expect(visibleLandingStatTiles(stats)).toEqual([]);
    expect(renderLandingStatsHtml(stats)).toBe("");
  });

  it("omits a tile rather than rendering 0", () => {
    const stats = landingStatsFromSources({ global: ZERO_GLOBAL });
    const html = renderLandingStatsHtml(stats);
    expect(html).toBe("");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(visibleLandingStatTiles(stats).map((tile) => tile.label)).toEqual([]);
  });

  it("fails if the four tiles render as 0 when the trade-ups API has live rows", () => {
    const stats = landingStatsFromSources({ board: LIVE_BOARD, global: ZERO_GLOBAL });
    const html = renderLandingStatsHtml(stats);
    expect(LIVE_BOARD.trade_ups.length).toBeGreaterThan(0);
    expect(html).toContain("1,842");
    expect(html).toContain("311");
    expect(html).toContain("trade-ups");
    expect(html).toContain("positive EV");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(html).not.toContain("data points");
    expect(html).not.toContain("cycles analyzed");
  });

  it("shows all four tiles only when those counts are real", () => {
    const html = renderLandingStatsHtml(landingStatsFromSources({ global: LIVE_GLOBAL }));
    expect(html).toContain('class="preview-stats"');
    expect(html).toContain("1,842");
    expect(html).toContain("311");
    expect(html).toContain("2,405,119");
    expect(html).toContain("86");
    expect(html).toContain("data points");
    expect(html).toContain("cycles analyzed");
    expect(html).not.toMatch(/<b>0<\/b>/);
  });

  it("prefers a live board total over a stubbed global-stats 0", () => {
    const stats = landingStatsFromSources({
      board: { total: 40, total_profitable: 7, trade_ups: [makeTradeUp()] },
      global: ZERO_GLOBAL,
    });
    expect(visibleLandingStatTiles(stats).map((tile) => tile.value)).toEqual([40, 7]);
  });

  it("does not publish the capped board total of 10001", () => {
    const stats = landingStatsFromSources({
      board: {
        total: 10001,
        total_profitable: 5000,
        trade_ups: [makeTradeUp(), makeTradeUp(), makeTradeUp()],
      },
    });
    expect(stats.total_trade_ups).toBeUndefined();
    expect(stats.profitable_trade_ups).toBeUndefined();
    expect(visibleLandingStatTiles(stats)).toEqual([]);
    const html = renderLandingStatsHtml(stats);
    expect(html).not.toContain("10,001");
    expect(html).not.toContain("10001");
    expect(html).not.toContain("5,000");
  });

  it("still shows a real board total under the cap", () => {
    const stats = landingStatsFromSources({ board: { total: 10000, total_profitable: 12 } });
    expect(visibleLandingStatTiles(stats).map((tile) => tile.value)).toEqual([10000, 12]);
  });

  it("uses the server global count when the board total is the cap", () => {
    const stats = landingStatsFromSources({
      global: {
        active_trade_ups: 820934,
        active_profitable_trade_ups: 84301,
        total_data_points: 100,
        total_cycles: 9,
      },
      board: { total: 10001, total_profitable: 0, trade_ups: [makeTradeUp()] },
    });
    const html = renderLandingStatsHtml(stats);
    expect(html).toContain("820,934");
    expect(html).toContain("84,301");
    expect(html).not.toContain("10,001");
    expect(html).not.toContain("10001");
    expect(landingStatsFromMarkup(html)?.total_trade_ups).toBe(820934);
    expect(landingStatsFromMarkup(html)?.profitable_trade_ups).toBe(84301);
  });

  it("placeholder labels reserve the hero row and do not invent a number", () => {
    expect(LANDING_STAT_PLACEHOLDER).not.toMatch(/\d/);
    expect(landingStatPlaceholderTiles().map((tile) => tile.label)).toEqual([
      "trade-ups",
      "positive EV",
      "data points",
      "cycles analyzed",
    ]);
    expect(landingStatPlaceholderTiles().map((tile) => tile.label).join(" ")).not.toMatch(/\d/);
  });

  it("keeps the server-rendered count when global-stats comes back empty", () => {
    const serverCounts = { total_trade_ups: 820934, profitable_trade_ups: 84301 };
    expect(nextHeroGlobal(serverCounts, null)).toEqual(serverCounts);
    expect(nextHeroGlobal(serverCounts, ZERO_GLOBAL)).toEqual(serverCounts);
    expect(nextHeroGlobal(null, null)).toBeNull();
    expect(nextHeroGlobal(serverCounts, { active_trade_ups: 820935 })?.active_trade_ups).toBe(820935);
  });

  it("reads the server-rendered count from hero HTML before React replaces it", () => {
    const html = renderLandingStatsHtml(landingStatsFromSources({
      global: { active_trade_ups: 820934, active_profitable_trade_ups: 84301 },
    }));
    captureServerLandingStats(`<div id="root">${html}</div>`);
    expect(serverLandingStats()?.total_trade_ups).toBe(820934);
    expect(serverLandingStats()?.profitable_trade_ups).toBe(84301);
    captureServerLandingStats(`<div id="root"></div>`);
    expect(serverLandingStats()).toBeNull();
  });

  it("QA 206 B1: a deduped board never fills the hero when global-stats is missing or 0", () => {
    const board = { total: 213, total_profitable: 1, deduped: true, raw_total: 10001, trade_ups: [makeTradeUp()] };
    for (const global of [null, { total_trade_ups: 0, profitable_trade_ups: 0 }]) {
      const stats = landingStatsFromSources({ global, board });
      expect(stats.total_trade_ups).toBeUndefined();
      expect(stats.profitable_trade_ups).toBeUndefined();
      const html = renderLandingStatsHtml(stats);
      expect(html).not.toContain("213");
      expect(html).not.toContain("positive EV");
      expect(visibleLandingStatTiles(stats)).toEqual([]);
    }
  });

  it("prints 10,000+ for the 10001 sentinel and leaves a real larger count alone", () => {
    expect(formatLandingStat(10_001)).toBe("10,000+");
    expect(formatLandingStat(10_001)).not.toContain("10,001");
    expect(formatLandingStat(10_001)).not.toContain("10001");
    expect(formatLandingStat(90_700)).toBe("90,700");
    expect(formatLandingStat(7_085)).toBe("7,085");

    const flagFalse = landingStatsFromSources({
      board: { total: 8000, total_profitable: 7085, total_profitable_capped: false, trade_ups: [makeTradeUp()] },
    });
    expect(renderLandingStatsHtml(flagFalse)).toContain("<b>7,085</b><span>positive EV</span>");
    expect(renderLandingStatsHtml(flagFalse)).not.toContain("10,000+");

    const globalWins = landingStatsFromSources({
      board: { total: 1000, total_profitable: 10001, total_profitable_capped: true, deduped: true, trade_ups: [makeTradeUp()] },
      global: { total_trade_ups: 120000, profitable_trade_ups: 90700 },
    });
    const globalHtml = renderLandingStatsHtml(globalWins);
    expect(globalHtml).toContain("90,700");
    expect(globalHtml).not.toContain("10,000+");
    expect(globalHtml).not.toContain("56");
  });

  it("does not present a deduped board total as the tracked trade-up count", () => {
    const missed = landingStatsFromSources({
      board: { total: 1_000, total_profitable: 400, trade_ups: [makeTradeUp()], deduped: true },
      global: null,
    });
    expect(missed.total_trade_ups).toBeUndefined();
    expect(missed.profitable_trade_ups).toBeUndefined();
    const html = renderLandingStatsHtml(missed);
    expect(html).not.toContain("1,000");
    expect(html).not.toContain("trade-ups");
    expect(visibleLandingStatTiles(missed)).toEqual([]);

    const live = landingStatsFromSources({
      global: LIVE_GLOBAL,
      board: { total: 1_000, total_profitable: 50, deduped: true, trade_ups: [makeTradeUp()] },
    });
    expect(live.total_trade_ups).toBe(1_842);
    expect(live.profitable_trade_ups).toBe(311);
  });

  it("still drops a capped (10001) non-deduped board total", () => {
    const stats = landingStatsFromSources({
      global: null,
      board: { total: 10_001, total_profitable: 52, trade_ups: [makeTradeUp()] },
    });
    expect(stats.total_trade_ups).toBeUndefined();
    expect(stats.profitable_trade_ups).toBeUndefined();
  });
});

describe("first-HTML injection", () => {
  it("replaces prerendered <b>0</b> tiles with live counts", () => {
    const html = injectLandingStats(prerenderedZeroHero(), landingStatsFromSources({ global: LIVE_GLOBAL }));
    expect(html).toContain("1,842");
    expect(html).toContain("311");
    expect(html).toContain("2,405,119");
    expect(html).toContain("86");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(html).toContain("preview-stats");
    expect(html).toContain("preview-toolbar");
  });

  it("removes zero tiles from first HTML when no live counts exist", () => {
    const html = injectLandingStats(prerenderedZeroHero(), landingStatsFromSources({ global: ZERO_GLOBAL }));
    expect(html).not.toContain("preview-stats");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(html).toContain("preview-toolbar");
  });

  it("inserts live tiles when prerender omitted the block", () => {
    const bare = `<section class="preview-hero">
      <div class="preview-toolbar"><a href="/trade-ups">Go</a></div>
    </section>`;
    const html = injectLandingStats(bare, landingStatsFromSources({ board: LIVE_BOARD }));
    expect(html).toContain("1,842");
    expect(html.indexOf("preview-stats")).toBeGreaterThan(html.indexOf("preview-toolbar"));
    expect(html).not.toMatch(/<b>0<\/b>/);
  });

  it("puts live counts in Googlebot first HTML and omits zeros from the static body", () => {
    expect(HOMEPAGE_SEO.bodyHtml).not.toMatch(/<b>0<\/b>/);
    expect(HOMEPAGE_SEO.bodyHtml).not.toContain("preview-stats");

    const withStats = renderHomepageSeoBody(landingStatsFromSources({ global: LIVE_GLOBAL }));
    expect(withStats).toContain("1,842");
    expect(withStats).toContain("311");
    expect(withStats).toContain("2,405,119");
    expect(withStats).toContain("86");
    expect(withStats).not.toMatch(/<b>0<\/b>/);

    const empty = renderHomepageSeoBody(landingStatsFromSources({ global: ZERO_GLOBAL }));
    expect(empty).not.toContain("preview-stats");
    expect(empty).not.toMatch(/<b>0<\/b>/);
  });
});

describe("wiring: hero reads live counts, prerender does not bake zeros", () => {
  it("landing tiles come from visibleLandingStatTiles, not hardcoded zeros", () => {
    expect(landing).toContain("visibleLandingStatTiles");
    expect(landing).toContain("preview-stats");
    expect(landing).not.toContain("<b>0</b>");
    expect(landing).not.toMatch(/total_trade_ups\.toLocaleString\(\)/);
  });

  it("loads hero counts from global-stats and the landing teaser, not a second per_page=1 query", () => {
    expect(app).toContain("/api/global-stats");
    expect(app).not.toContain("/api/trade-ups");
    expect(app).toContain("onBoardCounts");
    expect(app).toContain("landingStatsFromSources");
    expect(landing).toContain("usePreviewTradeUps({ perPage: 3 })");
    expect(landing).toContain("onBoardCounts");
    expect(landing).toContain("live.total");
  });

  it("treats active 0 as present and hides the tiles instead of baking lifetime totals", () => {
    const stats = landingStatsFromSources({
      global: {
        total_trade_ups: 744031,
        profitable_trade_ups: 66368,
        active_trade_ups: 0,
        active_profitable_trade_ups: 0,
      },
      board: { total: 744031, total_profitable: 66368, trade_ups: [makeTradeUp()] },
    });
    expect(stats.total_trade_ups).toBe(0);
    expect(stats.profitable_trade_ups).toBe(0);
    const html = renderLandingStatsHtml(stats);
    expect(html).toBe("");
    expect(html).not.toContain("744,031");
    expect(html).not.toContain("66,368");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(visibleLandingStatTiles(stats)).toEqual([]);
    expect(publishedTradeUpCounts({
      total_trade_ups: 744031,
      profitable_trade_ups: 66368,
      active_trade_ups: 0,
      active_profitable_trade_ups: 0,
    })).toEqual({ total: 0, profitable: 0 });
  });

  it("hero tiles use the active-only counts when global-stats provides them", () => {
    const stats = {
      total_trade_ups: 744031,
      profitable_trade_ups: 66368,
      active_trade_ups: 629512,
      active_profitable_trade_ups: 24718,
    };
    expect(publishedTradeUpCounts(stats)).toEqual({ total: 629512, profitable: 24718 });
    const tiles = visibleLandingStatTiles(landingStatsFromSources({ global: stats }));
    expect(tiles.map((tile) => tile.value)).toEqual([629512, 24718]);
  });

  it("server injects live stats into human and Googlebot first HTML", () => {
    expect(server).toContain("injectLandingStats");
    expect(server).toContain("renderHomepageSeoBody");
    expect(server).toContain("landingStatsFromSources");
    expect(server).toContain("getGlobalStats");
    expect(server).not.toContain('text-muted-foreground">${label}');
    expect(seoPages).toContain("renderLandingStatsHtml");
  });

  it("shows the server count or a placeholder, never the capped 10,001", () => {
    expect(main.indexOf("captureServerLandingStats(")).toBeGreaterThan(-1);
    expect(main.indexOf("captureServerLandingStats(")).toBeLessThan(main.indexOf("createRoot("));
    expect(app).toContain("serverLandingStats");
    expect(app).toContain("nextHeroGlobal");
    expect(app).toContain("countsPending={countsPending}");
    expect(landing).toContain("countsPending && statTiles.length === 0");
    expect(landing).toContain("LANDING_STAT_PLACEHOLDER");
    expect(landing).toContain('aria-busy="true"');
    expect(landing).not.toContain("10,001");
    expect(landing).not.toContain("10001");
    expect(css).toMatch(/\.preview-hero \.preview-stats b \{[^}]*min-width:\s*9ch/s);
  });

  it("prerender stub does not feed the hero four zeros", () => {
    expect(prerender).not.toMatch(/total_trade_ups:\s*0/);
    expect(prerender).not.toMatch(/profitable_trade_ups:\s*0/);
    expect(prerender).not.toMatch(/total_data_points:\s*0/);
    expect(prerender).not.toMatch(/total_cycles:\s*0/);
  });
});
