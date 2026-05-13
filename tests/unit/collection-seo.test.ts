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

  it("includes long-form collection body copy for crawler indexing", () => {
    expect(serverSource).toContain("collectionOverviewHtml");
    expect(serverSource).toContain("Collection trade-up research");
  });
});
