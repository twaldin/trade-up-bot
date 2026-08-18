import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";
import { makeTradeUp } from "../helpers/fixtures.js";
import { expandInputSlots, pickHeroOutcome } from "../../shared/preview-board.js";
import { parseFaceIds, facesFromOutcomeRows } from "../../server/preview/contract-faces.js";
import { resetBymykelCatalogCache, resolveSkinImageMap } from "../../server/preview/skin-images.js";

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
const indexTs = readSrc("server/index.ts");
const dataTs = readSrc("server/routes/data.ts");
const tradeUpsApi = readSrc("server/routes/trade-ups.ts");
const prerender = readSrc("scripts/prerender.js");
const robots = readSrc("public/robots.txt");
const robotsRoute = readSrc("server/routes/sitemap.ts");
const previewApp = readSrc("src/preview/PreviewApp.tsx");
const previewLanding = readSrc("src/preview/pages/PreviewLandingPage.tsx");
const previewShell = readSrc("src/preview/chrome/PreviewShell.tsx");
const previewBoard = readSrc("src/preview/board/PreviewTradeUpBoard.tsx");
const previewCard = readSrc("src/preview/board/PreviewContractCard.tsx");
const previewInspect = readSrc("src/preview/board/PreviewInspectDrawer.tsx");
const previewTradeUps = readSrc("src/preview/pages/PreviewTradeUpsPage.tsx");
const previewCalc = readSrc("src/preview/pages/PreviewCalculatorPage.tsx");
const previewAccount = readSrc("src/preview/pages/PreviewAccountPage.tsx");
const previewCss = readSrc("src/preview/preview.css");
const skinImages = readSrc("server/preview/skin-images.ts");

describe("preview is a separate app mounted only under /preview/*", () => {
  it("mounts PreviewApp at /preview/* and keeps preview out of AppShell", () => {
    expect(app).toContain('path="/preview/*"');
    expect(app).toContain("PreviewApp");
    expect(app).not.toContain("PreviewTradeUpsPage");
    expect(app).not.toContain("PreviewTradeUpsMainPage");
    expect(app).not.toContain('path="/preview/trade-ups"');
    expect(app).not.toMatch(/to:\s*"\/preview/);
    expect(app).not.toMatch(/feature[_-]?flag/i);
  });

  it("does not add preview to prod nav, landing, or SiteNav", () => {
    expect(siteNav).not.toContain("/preview");
    expect(siteNav).not.toContain("Preview");
    expect(landing).not.toContain("/preview");
  });

  it("does not restyle prod trade-ups or calculator", () => {
    expect(tradeUpsPage).toContain("<TradeUpTable");
    expect(tradeUpsPage).not.toContain("PreviewTradeUp");
    expect(tradeUpsPage).not.toContain("/preview");
    expect(tradeUpTable).not.toContain("preview/");
    expect(calculator).not.toContain("/preview");
    expect(calculator).toContain("Load example");
    expect(calculator).toContain("useState<InputSlot[]>([{ ...EMPTY_INPUT }])");
  });

  it("deletes the v1 cards-only restyle that lived inside AppShell", () => {
    expect(existsSync(join(__dir, "../../src/pages/PreviewTradeUpsPage.tsx"))).toBe(false);
    expect(existsSync(join(__dir, "../../src/components/preview/PreviewTradeUpBoard.tsx"))).toBe(false);
  });
});

describe("preview routes live under one coherent app", () => {
  it("registers landing, board, calculator, and account", () => {
    expect(previewApp).toContain("PreviewLandingPage");
    expect(previewApp).toContain("PreviewTradeUpsPage");
    expect(previewApp).toContain("PreviewCalculatorPage");
    expect(previewApp).toContain("PreviewAccountPage");
    expect(previewApp).toContain("noindex, nofollow");
    expect(previewApp).not.toContain('classList.add("app-shell")');
    expect(previewApp).not.toMatch(/className="[^"]*app-shell/);
  });

  it("uses a sidebar shell on app pages, not the prod top-tab bar", () => {
    expect(previewShell).toContain("pv-sidebar");
    expect(previewShell).toContain("/preview/trade-ups");
    expect(previewShell).toContain("/preview/calculator");
    expect(previewShell).toContain("/preview/account");
    expect(previewShell).toContain("PreviewAccountMenu");
    expect(previewShell).not.toContain("CS2 Trade-Up Bot");
    expect(previewShell).not.toContain("Listing Sniper");
  });
});

describe("preview landing is a TradeUpBot marketing page", () => {
  it("uses a laptop-in-hero product mock, not a pasted dashboard-saas page", () => {
    expect(previewLanding).toContain("pv-laptop");
    expect(previewLanding).toContain("PreviewHeroMock");
    expect(previewLanding).toMatch(/TradeUpBot|trade-up/i);
    expect(previewLanding).not.toContain("Net cash position");
    expect(previewLanding).not.toContain("evals/s");
    expect(previewLanding).not.toContain("Halcyon");
    expect(previewLanding).not.toContain("ledger graphite");
  });
});

describe("preview trade-ups board is image-first cards", () => {
  it("reuses the live list API and a preview-only face batch", () => {
    expect(previewTradeUps).toContain('fetch(`/api/trade-ups?${params}`');
    expect(previewTradeUps).toContain("AbortController");
    expect(previewTradeUps).toContain("useDebouncedValue");
    expect(previewTradeUps).toContain('const OWNED_PARAMS = ["skin", "collection", "min_profit"');
    expect(previewTradeUps).toContain("delayed 3 hours");
    expect(previewTradeUps).toContain("/api/preview/contract-faces");
  });

  it("renders cards with an output hero and a 10-slot input strip", () => {
    expect(previewCard).toContain("pv-card");
    expect(previewCard).toContain("expandInputSlots");
    expect(previewCard).toContain("pickHeroOutcome");
    expect(previewCard).toMatch(/Cost/);
    expect(previewCard).toMatch(/EV|Profit/);
    expect(previewCard).toMatch(/Chance/);
    expect(previewBoard).not.toContain("h-10");
    expect(previewBoard).not.toContain("Found");
    expect(previewBoard).not.toContain("Profitable");
    expect(previewBoard).not.toContain("1.9M");
    expect(previewBoard).not.toContain("1,284");
  });

  it("does not auto-select the first row or lead inspect with the histogram", () => {
    expect(previewBoard).not.toMatch(/setSelectedId\(tradeUps\[0\]/);
    expect(previewBoard).not.toMatch(/selectedId == null && tradeUps\[0\]/);
    const inspectJsx = previewInspect.slice(previewInspect.indexOf("return ("));
    expect(inspectJsx).toContain("<details");
    expect(inspectJsx).toContain("Distribution");
    expect(inspectJsx.indexOf("OutcomeChart")).toBeGreaterThan(inspectJsx.indexOf("Distribution"));
    expect(previewBoard).toContain("/api/verify-trade-up/");
    expect(previewInspect).toContain("/api/trade-ups/");
  });

  it("stays on Quanta tokens: sharp rules, verdict-only green/red", () => {
    expect(previewCss).toMatch(/--pv-rule|#262626/);
    expect(previewBoard + previewCard).not.toContain("shadow-");
    expect(previewBoard).not.toContain("LATE");
    expect(previewBoard).not.toContain("ON TIME");
    expect(previewCard).not.toContain("border-yellow-500");
    expect(previewCard).not.toContain("border-pink-500");
  });
});

describe("preview calculator keeps the Load example product rule", () => {
  it("uses the same APIs without first-load prefill or auto-run", () => {
    expect(previewCalc).toContain("Load example");
    expect(previewCalc).toContain("/api/calculator/example");
    expect(previewCalc).toContain("/api/calculator");
    expect(previewCalc).toContain("/api/calculator/search");
    expect(previewCalc).toContain("emptyCalculatorSlots");
    expect(previewCalc).toContain("Price (cents)");
    expect(previewCalc).not.toMatch(/useEffect\([^)]*\/api\/calculator\/example/);
    const loadExampleFn = previewCalc.slice(previewCalc.indexOf("loadExample"));
    const nextFn = loadExampleFn.search(/\n  const [a-zA-Z]/);
    const loadBody = nextFn === -1 ? loadExampleFn : loadExampleFn.slice(0, nextFn);
    expect(loadBody).not.toContain("calculator_run");
    expect(loadBody).not.toContain("calculate(");
    const calculateFn = previewCalc.slice(previewCalc.indexOf("const calculate"));
    expect(calculateFn).toContain('trackEvent("calculator_run"');
  });
});

describe("preview account uses existing auth and billing", () => {
  it("themes account / plan / sign-in against live endpoints", () => {
    expect(previewAccount).toContain("/api/auth/me");
    expect(previewAccount).toContain("/api/subscribe");
    expect(previewAccount).toContain("/api/billing-portal");
    expect(previewAccount).toContain("authHref");
    expect(previewAccount).toContain("PreviewModal");
    expect(previewShell).toContain("PreviewAccountMenu");
  });
});

describe("preview images resolve stored URL then Steam/ByMykel", () => {
  it("extends GET /api/skin-images with the catalog fallback and leaves GET /api/trade-ups alone", () => {
    expect(dataTs).toContain('router.get("/api/skin-images"');
    expect(dataTs).toContain("resolveSkinImageMap");
    expect(dataTs).toContain('router.get("/api/preview/contract-faces"');
    expect(dataTs).toContain("outcomes_json");
    expect(tradeUpsApi).not.toContain("/api/skin-images");
    expect(tradeUpsApi).not.toContain("/api/preview/contract-faces");
    expect(skinImages).toContain("ByMykel");
    expect(skinImages).toContain("skins.json");
  });

  it("allows Steam economy image hosts in CSP", () => {
    expect(indexTs).toContain("community.akamai.steamstatic.com");
    expect(indexTs).toContain("cdn.steamstatic.com");
    expect(indexTs).toContain("steamcdn-a.akamaihd.net");
  });

  it("resolves catalog URLs when the stored image is missing", async () => {
    resetBymykelCatalogCache();
    const images = await resolveSkinImageMap(
      ["AK-47 | Redline", "Unknown Skin | Invented"],
      { "AK-47 | Redline": null, "Unknown Skin | Invented": null },
      async () => new Response(JSON.stringify([
        { name: "AK-47 | Redline", image: "https://community.akamai.steamstatic.com/economy/image/redline" },
      ]), { status: 200 }),
    );
    expect(images["AK-47 | Redline"]).toBe("https://community.akamai.steamstatic.com/economy/image/redline");
    expect(images["Unknown Skin | Invented"]).toBe(null);
  });
});

describe("preview contract faces and board helpers", () => {
  it("caps face ids at 50 and reads stored outcomes only", () => {
    const ids = parseFaceIds(["1", "2", "nope", "-3", ...Array.from({ length: 60 }, (_, i) => String(i + 10))].join(","));
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe(1);
    const faces = facesFromOutcomeRows([
      { id: 9, outcomes_json: JSON.stringify([{ skin_name: "AK-47 | Fire Serpent", probability: 1, estimated_price_cents: 10000 }]) },
      { id: 10, outcomes_json: "not-json" },
    ]);
    expect(faces[9][0]?.skin_name).toBe("AK-47 | Fire Serpent");
    expect(faces[10]).toEqual([]);
  });

  it("expands named inputs into a slot strip and picks the distinctive output hero", () => {
    const tu = makeTradeUp({
      input_summary: {
        skins: [
          { name: "AK-47 | Redline", count: 6, condition: "Field-Tested" },
          { name: "M4A4 | Desert-Strike", count: 4, condition: "Minimal Wear" },
        ],
        collections: ["The Phoenix Collection"],
        input_count: 10,
      },
      outcomes: [
        {
          skin_id: "out-1",
          skin_name: "AK-47 | Fire Serpent",
          collection_name: "The Bravo Collection",
          probability: 0.4,
          predicted_float: 0.2,
          predicted_condition: "Field-Tested",
          estimated_price_cents: 80000,
        },
        {
          skin_id: "out-2",
          skin_name: "M4A4 | Howl",
          collection_name: "The Huntsman Collection",
          probability: 0.6,
          predicted_float: 0.18,
          predicted_condition: "Field-Tested",
          estimated_price_cents: 120000,
        },
      ],
    });
    expect(expandInputSlots(tu)).toEqual([
      "AK-47 | Redline", "AK-47 | Redline", "AK-47 | Redline",
      "AK-47 | Redline", "AK-47 | Redline", "AK-47 | Redline",
      "M4A4 | Desert-Strike", "M4A4 | Desert-Strike",
      "M4A4 | Desert-Strike", "M4A4 | Desert-Strike",
    ]);
    expect(pickHeroOutcome(tu.outcomes)?.skin_name).toBe("M4A4 | Howl");
  });
});

describe("preview stays out of real-route SEO", () => {
  it("noindexes /preview and /preview/* and stays out of sitemap/robots/prerender", () => {
    expect(indexTs).toContain('app.get("/preview"');
    expect(indexTs).toContain('app.get("/preview/*"');
    expect(indexTs).toContain('robots: "noindex, nofollow"');
    expect(indexTs).toContain('"X-Robots-Tag", "noindex, nofollow"');
    const sitemap = buildStaticSitemap("https://tradeupbot.app", "2026-08-18");
    expect(sitemap).not.toContain("/preview");
    expect(prerender).not.toContain("/preview");
    expect(robots).not.toContain("/preview");
    expect(robotsRoute).toContain("Disallow: /auth/");
    expect(robotsRoute).toContain("Disallow: /api/");
    expect(robotsRoute).not.toContain("/preview");
  });
});
