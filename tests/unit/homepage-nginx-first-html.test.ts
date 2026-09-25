import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import { injectLandingStats, landingStatsFromSources } from "../../src/preview/lib/landing-stats.js";
import { fetchLiveHomepageStats, materializeHomepageFirstHtml, writeHomepageFirstHtmlFile } from "../../server/homepage-first-html.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const LIVE_PRERENDER = read("../helpers/live-homepage-prerender.html");
const LIVE_GLOBAL = {
  total_trade_ups: 762_589,
  profitable_trade_ups: 109_885,
  total_data_points: 4_534_582,
  total_cycles: 7_718,
};
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER = "Mozilla/5.0";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const path = temps.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function nginxLikeRoot(): { root: string; indexPath: string } {
  const root = mkdtempSync(join(tmpdir(), "homepage-nginx-"));
  temps.push(root);
  const indexPath = join(root, "index.html");
  writeFileSync(indexPath, LIVE_PRERENDER);
  return { root, indexPath };
}

/** Same topology as tradeupbot.app: nginx serves dist/index.html for every UA. */
function serveStaticIndex(indexPath: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.end(readFileSync(indexPath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function get(url: string, ua: string): Promise<{ body: string; bytes: number }> {
  const res = await fetch(url, { headers: { "user-agent": ua } });
  const body = await res.text();
  return { body, bytes: Buffer.byteLength(body) };
}

describe("live nginx first HTML (the 2026-08-31 fail)", () => {
  it("matches the production prerender: toolbar + Discord, no .preview-stats, no baked zeros", () => {
    expect(LIVE_PRERENDER).toContain("preview-toolbar");
    expect(LIVE_PRERENDER).toContain("Join the Discord");
    expect(LIVE_PRERENDER).toContain("Find Real Tradeups");
    expect(LIVE_PRERENDER).toContain("discord.gg/gQ8cPqBq2a");
    expect(LIVE_PRERENDER).not.toContain("preview-stats");
    expect(LIVE_PRERENDER).not.toMatch(/<b>0<\/b>/);
    expect(LIVE_PRERENDER).toContain("name=\"robots\" content=\"index, follow\"");
    expect(LIVE_PRERENDER).not.toContain("noindex");
  });

  it("reproduces the live fail: static nginx in front of Node serves the uninjected prerender to both UAs", async () => {
    const { indexPath } = nginxLikeRoot();
    const host = await serveStaticIndex(indexPath);
    try {
      const browser = await get(host.url, BROWSER);
      const bot = await get(host.url, GOOGLEBOT);
      expect(browser.body).toBe(LIVE_PRERENDER);
      expect(bot.body).toBe(browser.body);
      expect(browser.body).not.toContain("preview-stats");
      expect(bot.body).not.toContain("762,589");
    } finally {
      await host.close();
    }
  });
});

describe("prod-like path: rewrite the file nginx serves", () => {
  it("first HTML on the static prerender contains live tiles for humans and Googlebot", async () => {
    const { indexPath } = nginxLikeRoot();
    const stats = landingStatsFromSources({ global: LIVE_GLOBAL });
    const wrote = writeHomepageFirstHtmlFile(indexPath, stats);
    expect(wrote).toBe(true);

    const host = await serveStaticIndex(indexPath);
    try {
      const browser = await get(host.url, BROWSER);
      const bot = await get(host.url, GOOGLEBOT);

      for (const page of [browser.body, bot.body]) {
        expect(page).toContain('class="preview-stats"');
        expect(page).toContain("762,589");
        expect(page).toContain("109,885");
        expect(page).toContain("4,534,582");
        expect(page).toContain("7,718");
        expect(page).toContain("trade-ups");
        expect(page).toContain("profitable");
        expect(page).toContain("data points");
        expect(page).toContain("cycles analyzed");
        expect(page).not.toMatch(/<b>0<\/b>/);
        expect(page).toContain("Join the Discord");
        expect(page).toContain("Find Real Tradeups");
        expect(page).toContain("name=\"robots\" content=\"index, follow\"");
        expect(page).not.toContain("noindex");
      }

      expect(bot.body).not.toBe(LIVE_PRERENDER);
      expect(browser.body).not.toBe(LIVE_PRERENDER);
      expect(bot.body).toContain("preview-stats");
    } finally {
      await host.close();
    }
  });

  it("injectLandingStats against the live prerender inserts after the hero toolbar", () => {
    const html = injectLandingStats(LIVE_PRERENDER, landingStatsFromSources({ global: LIVE_GLOBAL }));
    const toolbarAt = html.indexOf("preview-toolbar");
    const statsAt = html.indexOf("preview-stats");
    expect(statsAt).toBeGreaterThan(toolbarAt);
    expect(html.indexOf("preview-laptop")).toBeGreaterThan(statsAt);
    expect(html).not.toMatch(/<b>0<\/b>/);
  });

  it("omits tiles instead of writing zeros, and never shows 0 when the board has rows", () => {
    const { indexPath } = nginxLikeRoot();
    writeHomepageFirstHtmlFile(indexPath, landingStatsFromSources({ global: {
      total_trade_ups: 0,
      profitable_trade_ups: 0,
      total_data_points: 0,
      total_cycles: 0,
    } }));
    expect(readFileSync(indexPath, "utf8")).not.toContain("preview-stats");
    expect(readFileSync(indexPath, "utf8")).not.toMatch(/<b>0<\/b>/);

    writeHomepageFirstHtmlFile(indexPath, landingStatsFromSources({
      board: { trade_ups: [makeTradeUp()], total: 40, total_profitable: 7 },
      global: { total_trade_ups: 0, profitable_trade_ups: 0, total_data_points: 0, total_cycles: 0 },
    }));
    const html = readFileSync(indexPath, "utf8");
    expect(html).toContain("<b>40</b>");
    expect(html).toContain("<b>7</b>");
    expect(html).not.toMatch(/<b>0<\/b>/);
    expect(html).not.toContain("data points");
  });
});

describe("build bakes active hero counts from global-stats", () => {
  it("bakes active_* when the payload has them, and falls back to totals only when they are absent", async () => {
    const html = `<section class="preview-hero"><div class="preview-toolbar"><a href="/trade-ups">Go</a></div></section>`;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const body = url.includes("global-stats")
        ? {
          total_trade_ups: 744031,
          profitable_trade_ups: 66368,
          active_trade_ups: 629512,
          active_profitable_trade_ups: 24718,
          total_data_points: 4_534_582,
          total_cycles: 7_718,
        }
        : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const active = await fetchLiveHomepageStats({
      globalUrl: "https://tradeupbot.test/api/global-stats",
      boardUrl: "https://tradeupbot.test/api/trade-ups",
      fetchImpl,
    });
    const baked = materializeHomepageFirstHtml(html, active);
    expect(baked).toContain("629,512");
    expect(baked).toContain("24,718");
    expect(baked).not.toContain("744,031");
    expect(baked).not.toContain("66,368");

    const totalsOnly: typeof fetch = async (input) => {
      const url = String(input);
      const body = url.includes("global-stats")
        ? { total_trade_ups: 1842, profitable_trade_ups: 311, total_data_points: 10, total_cycles: 2 }
        : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const fallback = await fetchLiveHomepageStats({
      globalUrl: "https://tradeupbot.test/api/global-stats",
      boardUrl: "https://tradeupbot.test/api/trade-ups",
      fetchImpl: totalsOnly,
    });
    expect(materializeHomepageFirstHtml(html, fallback)).toContain("1,842");
  });
});

describe("wiring: prerender and API startup rewrite dist/index.html", () => {
  it("does not rely on app.get('/') alone — that never ran behind nginx", () => {
    const prerender = read("../../scripts/prerender.ts");
    const server = read("../../server/index.ts");
    expect(prerender).toContain("writeHomepageFirstHtmlFile");
    expect(server).toContain("writeHomepageFirstHtmlFile");
    expect(prerender).toContain("fetchLiveHomepageStats");
    expect(server).toContain("getGlobalStats");
  });
});
