import { describe, expect, it } from "vitest";
import { buildSeoHtml, renderCollectionsHub } from "../../server/seo.js";

const collections = [
  "Dreams & Nightmares",
  "Norse",
  "Gallery",
  "Spectrum",
  "Chroma",
  "Prisma",
  "Clutch",
  "Recoil",
  "Fracture",
  "Gamma",
  "Operation Broken Fang",
  "Operation Riptide",
].map((name) => ({
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
}));

describe("collections hub crawler HTML", () => {
  it("renders at least 200 characters of visible body text with collection and trade-up links", () => {
    const html = buildSeoHtml({
      title: "CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot",
      description: "Browse CS2 collections with skins, float ranges, and trade-up opportunities.",
      url: "https://tradeupbot.app/collections",
      bodyHtml: renderCollectionsHub(collections),
    });

    const bodyText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const collectionLinks = html.match(/href="\/collections\/[a-z0-9-]+"/g) ?? [];

    expect(bodyText.length).toBeGreaterThanOrEqual(200);
    expect(html).toContain("<h1>CS2 Skin Collections</h1>");
    expect(collectionLinks).toHaveLength(12);
    expect(html).toContain('href="/trade-ups"');
  });
});
