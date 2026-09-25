import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");

describe("collection page SEO crawler HTML", () => {
  it("uses the required collection title template", () => {
    expect(serverSource).toContain("`${displayName} Collection — CS2 Skins, Prices & Trade-Ups | TradeUpBot`");
  });

  it("renders an H1 ending in Collection and rarity tier headings with counts", () => {
    expect(serverSource).toContain("<h1>${e(displayName)} Collection</h1>");
    expect(serverSource).toContain("<h2>${e(rarity)} (${rs.length})</h2>");
  });

  it("always links collection pages to the collection trade-ups page", () => {
    expect(serverSource).toContain("Explore ${displayName} trade-up contracts");
    expect(serverSource).toContain("<a href=\"/trade-ups/collection/${req.params.slug}\">");
  });

  it("emits BreadcrumbList JSON-LD for collection pages", () => {
    expect(serverSource).toContain('"@type": "BreadcrumbList"');
    expect(serverSource).toContain('name: `${displayName} Collection`');
  });

  it("keeps the bare collection canonical query-free and ignores filter queries", () => {
    const start = serverSource.indexOf('app.get("/collections/:slug"');
    const end = serverSource.indexOf('app.get("/skins/:slug"');
    const handler = serverSource.slice(start, end);
    expect(handler).toContain("url: `https://tradeupbot.app/collections/${req.params.slug}`");
    expect(handler).not.toContain("req.query");
    expect(handler).not.toContain("collections/${req.params.slug}?");
    const unknown = handler.slice(handler.indexOf("if (!collectionName)"), handler.indexOf("const displayName"));
    expect(unknown).toContain('res.status(404).send("Collection not found")');
    expect(unknown).not.toContain("canonical");
  });

  it("allows collection set icons from raw.githubusercontent.com in img-src only", () => {
    const helmet = serverSource.slice(serverSource.indexOf("contentSecurityPolicy"), serverSource.indexOf("Stripe webhook"));
    expect(helmet).toContain('"https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/"');
    const imgLine = helmet.split("\n").find((line) => line.includes("imgSrc"));
    expect(imgLine).toContain("https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/");
    expect(imgLine).toContain("https://cdn.steamstatic.com/apps/730/icons/econ/set_icons/");
    expect(helmet.split("\n").filter((line) => line.includes("raw.githubusercontent.com") || line.includes("set_icons"))).toHaveLength(1);
  });

  it("does not inject a second client canonical on the collection page", () => {
    const page = readFileSync(join(__dir, "../../src/preview/pages/PreviewSkins.tsx"), "utf-8");
    const start = page.indexOf("export function PreviewCollectionPage");
    const body = page.slice(start);
    expect(body).not.toMatch(/<link[^>]*rel="canonical"/);
  });

  it("includes long-form collection body copy for crawler indexing", () => {
    expect(serverSource).toContain("collectionOverviewHtml");
    expect(serverSource).toContain("Collection trade-up research");
  });
});
