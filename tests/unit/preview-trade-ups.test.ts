import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";

const __dir = dirname(fileURLToPath(import.meta.url));

function readSrc(rel: string): string {
  return readFileSync(join(__dir, "../../", rel), "utf-8");
}

const app = readSrc("src/App.tsx");
const siteNav = readSrc("src/components/SiteNav.tsx");
const landing = readSrc("src/pages/LandingPage.tsx");
const tradeUpsPage = readSrc("src/pages/TradeUpsPage.tsx");
const tradeUpTable = readSrc("src/components/TradeUpTable.tsx");
const calculator = readSrc("src/pages/CalculatorPage.tsx");
const previewPage = readSrc("src/pages/PreviewTradeUpsPage.tsx");
const previewBoard = readSrc("src/components/preview/PreviewTradeUpBoard.tsx");
const indexTs = readSrc("server/index.ts");
const dataTs = readSrc("server/routes/data.ts");
const prerender = readSrc("scripts/prerender.js");
const robots = readSrc("public/robots.txt");
const robotsRoute = readSrc("server/routes/sitemap.ts");

describe("isolated /preview/trade-ups route", () => {
  it("registers the preview page without a nav link or feature flag", () => {
    expect(app).toContain('path="/preview/trade-ups"');
    expect(app).toContain("PreviewTradeUpsPage");
    expect(app).not.toMatch(/to:\s*"\/preview\/trade-ups"/);
    expect(app).not.toMatch(/feature[_-]?flag/i);
    expect(siteNav).not.toContain("/preview/trade-ups");
    expect(siteNav).not.toContain("Preview");
    expect(landing).not.toContain("/preview/trade-ups");
  });

  it("keeps default product chrome on the existing list and calculator", () => {
    expect(tradeUpsPage).toContain("<TradeUpTable");
    expect(tradeUpsPage).not.toContain("PreviewTradeUp");
    expect(tradeUpsPage).not.toContain("/preview/trade-ups");
    expect(tradeUpTable).not.toContain("preview/trade-ups");
    expect(calculator).not.toContain("/preview/trade-ups");
    expect(calculator).toContain("Load example");
  });

  it("reuses the live TradeUpsPage fetch contract", () => {
    expect(previewPage).toContain('fetch(`/api/trade-ups?${params}`');
    expect(previewPage).toContain("AbortController");
    expect(previewPage).toContain("useDebouncedValue");
    expect(previewPage).toContain('const OWNED_PARAMS = ["skin", "collection", "min_profit"');
    expect(previewPage).toContain("delayed 3 hours");
    expect(previewPage).toContain("<FilterBar");
  });

  it("is noindex, nofollow on the page and the server SEO handler", () => {
    expect(previewPage).toContain('content="noindex, nofollow"');
    expect(previewPage).not.toContain("application/ld+json");
    expect(indexTs).toContain('app.get("/preview/trade-ups"');
    expect(indexTs).toContain('robots: "noindex, nofollow"');
    expect(indexTs).toContain('"X-Robots-Tag", "noindex, nofollow"');
    expect(indexTs).toContain("https://tradeupbot.app/preview/trade-ups");
  });
});

describe("preview board patterns", () => {
  it("shows an image-first rail and an inspect pane that reuses scoring UI", () => {
    expect(previewBoard).toContain("SkinThumb");
    expect(previewBoard).toContain("distinctiveSkinNames");
    expect(previewBoard).toContain("h-10");
    expect(previewBoard).toContain("OutcomeChart");
    expect(previewBoard).toContain("InputList");
    expect(previewBoard).toContain("OutcomeList");
    expect(previewBoard).toContain("VerifyResults");
    expect(previewBoard).toContain("/api/trade-up/");
    expect(previewBoard).toContain("/api/verify-trade-up/");
  });

  it("uses a compact 4-up KPI strip of real API numbers", () => {
    expect(previewBoard).toMatch(/Found|found/);
    expect(previewBoard).toMatch(/Profitable|profitable/);
    expect(previewBoard).toMatch(/Page|page/);
    expect(previewBoard).not.toContain("1.9M");
    expect(previewBoard).not.toContain("1,284");
  });

  it("stays on Quanta tokens: sharp rules, verdict-only green/red, no rarity rainbow tabs", () => {
    expect(previewBoard).toMatch(/rounded-\[2px\]|rounded-none/);
    expect(previewBoard).not.toContain("shadow-");
    expect(previewBoard).not.toContain("border-yellow-500");
    expect(previewBoard).not.toContain("border-pink-500");
    expect(previewBoard).not.toContain("LATE");
    expect(previewBoard).not.toContain("ON TIME");
  });

  it("exposes cmd-k chrome to focus filters", () => {
    expect(previewBoard).toMatch(/metaKey|ctrlKey/);
    expect(previewBoard).toContain("k");
  });
});

describe("preview image lookup uses stored skin URLs", () => {
  it("adds a names batch lookup against skins.image_url without changing GET /api/trade-ups", () => {
    expect(dataTs).toContain('router.get("/api/skin-images"');
    expect(dataTs).toContain("image_url");
    expect(dataTs).toContain("FROM skins");
    const tradeUpsApi = readSrc("server/routes/trade-ups.ts");
    expect(tradeUpsApi).not.toContain("/api/skin-images");
  });
});

describe("preview stays out of real-route SEO", () => {
  it("is absent from the static sitemap, prerender list, and robots directives", () => {
    const sitemap = buildStaticSitemap("https://tradeupbot.app", "2026-08-18");
    expect(sitemap).not.toContain("/preview");
    expect(prerender).not.toContain("/preview/trade-ups");
    expect(robots).not.toContain("/preview");
    expect(robotsRoute).toContain('Disallow: /auth/');
    expect(robotsRoute).toContain('Disallow: /api/');
    expect(robotsRoute).not.toContain("/preview");
  });
});
