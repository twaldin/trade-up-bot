import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { CONSOLE_BASE, previewSkinHref } from "../../src/preview/lib/board.js";
import { consoleTargetFor, pageFor } from "../../src/preview/lib/console-routes.js";
import { ROBOTS_TXT, buildStaticSitemap } from "../../server/routes/sitemap.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE } from "../../src/preview/lib/copy.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(testDir, "../../src/App.tsx"), "utf8");
const siteNavSource = readFileSync(resolve(testDir, "../../src/components/SiteNav.tsx"), "utf8");
const landingSource = readFileSync(resolve(testDir, "../../src/pages/LandingPage.tsx"), "utf8");
const tradeUpsSource = readFileSync(resolve(testDir, "../../src/pages/TradeUpsPage.tsx"), "utf8");
const calculatorSource = readFileSync(resolve(testDir, "../../src/pages/CalculatorPage.tsx"), "utf8");
const previewAppSource = readFileSync(resolve(testDir, "../../src/preview/PreviewApp.tsx"), "utf8");
const shellSource = readFileSync(resolve(testDir, "../../src/preview/PreviewShell.tsx"), "utf8");
const publicRobots = readFileSync(resolve(testDir, "../../public/robots.txt"), "utf8");

describe("console cutover", () => {
  it("serves the console routes from the kit shell", () => {
    const pages: [string, string][] = [
      ["/", "landing"],
      ["/trade-ups", "board"],
      ["/skins", "skins"],
      ["/skins/:slug", "skin"],
      ["/collections", "collections"],
      ["/collections/:name", "collection"],
      ["/calculator", "calculator"],
      ["/account", "account"],
      ["/my-trade-ups", "account"],
    ];
    for (const [path, page] of pages) {
      expect(appSource, `App missing ${path}`).toContain(`path="${path}" element={<ConsoleApp page="${page}" />}`);
      expect(previewAppSource, `shell cannot render ${page}`).toContain(`case "${page}"`);
    }
    // the page comes from the outer match, so useParams reads the real route
    expect(previewAppSource).toContain("pageFor(props.page");
  });

  it("redirects the retired preview prefix instead of serving it", () => {
    expect(appSource).toContain('path="/preview/*"');
    expect(appSource).toContain("RetiredPreviewPrefixRedirect");
    expect(consoleTargetFor("/preview/trade-ups")).toBe("/trade-ups");
    expect(consoleTargetFor("/preview/skins/ak-47-redline")).toBe("/skins/ak-47-redline");
    expect(consoleTargetFor("/preview")).toBe("/");
    expect(consoleTargetFor("/preview/")).toBe("/");
  });

  it("reads the page off the path when no page is passed", () => {
    expect(pageFor(undefined, "/trade-ups")).toBe("board");
    expect(pageFor(undefined, "/skins/ak-47-redline")).toBe("skin");
    expect(pageFor(undefined, "/skins")).toBe("skins");
    expect(pageFor(undefined, "/collections/dreams-nightmares")).toBe("collection");
    expect(pageFor(undefined, "/collections")).toBe("collections");
    expect(pageFor(undefined, "/my-trade-ups")).toBe("account");
    expect(pageFor(undefined, "/")).toBe("landing");
    expect(pageFor("board", "/")).toBe("board");
  });

  it("no longer noindexes the console now that it is production", () => {
    expect(previewAppSource).not.toMatch(/noindex/);
    expect(shellSource).not.toMatch(/noindex/);
  });

  it("links inside the console carry no preview prefix", () => {
    const files = [
      "PreviewApp.tsx",
      "PreviewShell.tsx",
      "pages/PreviewBoard.tsx",
      "pages/PreviewSkins.tsx",
      "pages/PreviewLanding.tsx",
      "pages/PreviewAccount.tsx",
      "pages/PreviewCalculator.tsx",
      "lib/my-trade-ups.ts",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(testDir, `../../src/preview/${file}`), "utf8");
      const links = [...source.matchAll(/to="(\/preview[^"]*)"/g)].map((match) => match[1]);
      expect(links, `${file} still links into /preview`).toEqual([]);
    }
    expect(CONSOLE_BASE).toBe("");
    expect(previewSkinHref("AK-47 | Nightwish")).toBe("/skins/ak-47-nightwish");
  });

  it("keeps the shared CurrencyPicker untouched and ships the lime mark", () => {
    const favicon = readFileSync(resolve(testDir, "../../public/favicon.svg"), "utf8");
    const picker = readFileSync(resolve(testDir, "../../src/components/CurrencyPicker.tsx"), "utf8");
    expect(favicon).toContain("#d7fe52");
    expect(favicon).not.toContain("<rect");
    expect(picker).toContain("rounded-md");
  });

  it("leaves the engine, fees, scoring and D&N untouched", () => {
    const files = [
      "../../server/engine/scoring.ts",
      "../../server/engine/ev.ts",
      "../../server/engine/math.ts",
    ];
    for (const file of files) {
      const path = resolve(testDir, file);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("preview");
    }
  });

  it("does not iframe production chrome", () => {
    const previewDir = resolve(testDir, "../../src/preview");
    const shell = readFileSync(resolve(previewDir, "PreviewShell.tsx"), "utf8");
    const app = readFileSync(resolve(previewDir, "PreviewApp.tsx"), "utf8");
    const board = readFileSync(resolve(previewDir, "pages/PreviewBoard.tsx"), "utf8");
    expect(app).not.toContain("pv-embed");
    expect(shell).not.toContain("pv-embed");
    expect(shell).toContain("o-nav-item");
    expect(board).not.toContain("/skins/${");
    expect(board).not.toContain("`/trade-ups/");
  });

  it("does not change production landing, trade-ups, or calculator sources", () => {
    expect(landingSource).toContain("CS2 trade-ups built from");
    expect(landingSource).toContain("<DemoAnimation");
    expect(tradeUpsSource).toContain("TradeUpTable");
    expect(calculatorSource).toContain("export function CalculatorPage");
  });

  it("keeps production headlines and FAQ copy in the preview landing", () => {
    expect(PREVIEW_HEADLINE).toBe("CS2 trade-ups built from real, buyable listings");
    expect(PREVIEW_FAQ).toHaveLength(5);
    expect(PREVIEW_FAQ[0]?.q).toBe("How does TradeUpBot find profitable trade-ups?");
    expect(previewAppSource).toContain("PREVIEW_HEADLINE");
    expect(previewAppSource).toContain("PREVIEW_FAQ");
  });

  it("says trade-up, not contract, on the preview surface", () => {
    const files = [
      "PreviewApp.tsx",
      "PreviewShell.tsx",
      "lib/copy.ts",
      "lib/board.ts",
      "pages/PreviewBoard.tsx",
      "pages/PreviewCalculator.tsx",
      "pages/PreviewAccount.tsx",
      "pages/PreviewLanding.tsx",
      "pages/PreviewSkins.tsx",
      "lib/my-trade-ups.ts",
      "components/DeviceScreen.tsx",
      "components/PreviewCurrency.tsx",
      "components/PreviewMark.tsx",
      "components/PreviewFilters.tsx",
      "components/PreviewTable.tsx",
      "components/PriceScatter.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(testDir, `../../src/preview/${file}`), "utf8");
      expect(source, file).not.toMatch(/\b[Cc]ontracts?\b/);
    }
    expect(PREVIEW_HEADLINE).toBe("CS2 trade-ups built from real, buyable listings");
  });

  it("keeps the retired preview prefix out of the sitemap", () => {
    expect(ROBOTS_TXT).toContain("Disallow: /preview");
    expect(publicRobots).toContain("Disallow: /preview");
    const xml = buildStaticSitemap("https://tradeupbot.app", "2026-08-18");
    expect(xml).not.toContain("/preview");
    // the real console routes stay crawlable
    expect(xml).toContain("/trade-ups");
    expect(xml).toContain("/skins");
  });
});
