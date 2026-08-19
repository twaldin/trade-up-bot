import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROBOTS_TXT, buildStaticSitemap } from "../../server/routes/sitemap.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE } from "../../src/preview/lib/copy.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(testDir, "../../src/App.tsx"), "utf8");
const siteNavSource = readFileSync(resolve(testDir, "../../src/components/SiteNav.tsx"), "utf8");
const landingSource = readFileSync(resolve(testDir, "../../src/pages/LandingPage.tsx"), "utf8");
const tradeUpsSource = readFileSync(resolve(testDir, "../../src/pages/TradeUpsPage.tsx"), "utf8");
const calculatorSource = readFileSync(resolve(testDir, "../../src/pages/CalculatorPage.tsx"), "utf8");
const previewAppSource = readFileSync(resolve(testDir, "../../src/preview/PreviewApp.tsx"), "utf8");
const publicRobots = readFileSync(resolve(testDir, "../../public/robots.txt"), "utf8");

describe("preview isolation", () => {
  it("mounts the kit app only under /preview/*", () => {
    expect(appSource).toContain('path="/preview/*"');
    expect(previewAppSource).toContain('path="/preview"');
    expect(previewAppSource).toContain('path="/preview/trade-ups"');
    expect(previewAppSource).toContain('path="/preview/calculator"');
    expect(previewAppSource).toContain('path="/preview/account"');
    expect(previewAppSource).toContain('path="/preview/skins"');
    expect(previewAppSource).toContain('path="/preview/collections"');
    expect(previewAppSource).toMatch(/noindex/);
    expect(siteNavSource).not.toContain("/preview");
  });

  it("leaves the production favicon and shared CurrencyPicker alone", () => {
    const favicon = readFileSync(resolve(testDir, "../../public/favicon.svg"), "utf8");
    const picker = readFileSync(resolve(testDir, "../../src/components/CurrencyPicker.tsx"), "utf8");
    expect(favicon).toContain("#22c55e");
    expect(favicon).toContain("<rect");
    expect(picker).toContain("rounded-md");
  });

  it("does not iframe or restyle production chrome", () => {
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

  it("noindexes preview in robots.txt and keeps it out of the sitemap", () => {
    expect(ROBOTS_TXT).toContain("Disallow: /preview");
    expect(publicRobots).toContain("Disallow: /preview");
    const xml = buildStaticSitemap("https://tradeupbot.app", "2026-08-18");
    expect(xml).not.toContain("/preview");
  });
});
