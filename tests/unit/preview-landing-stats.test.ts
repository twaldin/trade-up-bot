import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import {
  injectLandingStats,
  landingStatsFromSources,
  publishedTradeUpCounts,
  renderLandingStatsHtml,
  visibleLandingStatTiles,
} from "../../src/preview/lib/landing-stats.js";
import { renderHomepageSeoBody } from "../../server/static-seo-pages.js";
import { HOMEPAGE_SEO } from "../../server/static-seo-pages.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const landing = read("../../src/preview/pages/PreviewLanding.tsx");
const app = read("../../src/preview/PreviewApp.tsx");
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

  it("prerender stub does not feed the hero four zeros", () => {
    expect(prerender).not.toMatch(/total_trade_ups:\s*0/);
    expect(prerender).not.toMatch(/profitable_trade_ups:\s*0/);
    expect(prerender).not.toMatch(/total_data_points:\s*0/);
    expect(prerender).not.toMatch(/total_cycles:\s*0/);
  });
});
