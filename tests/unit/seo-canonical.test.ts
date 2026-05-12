import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSeoHtml, injectMetaIntoSpa } from "../../server/seo.js";

const __dir = dirname(fileURLToPath(import.meta.url));

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("canonical and robots SEO helpers", () => {
  it("buildSeoHtml emits exactly one title, description, and canonical", () => {
    const html = buildSeoHtml({
      title: "Profitable CS2 Trade-Ups | TradeUpBot",
      description: "Find profitable CS2 trade-up contracts from real listings.",
      url: "https://tradeupbot.app/trade-ups",
    });

    expect(countMatches(html, /<title\b/g)).toBe(1);
    expect(countMatches(html, /<meta name="description"/g)).toBe(1);
    expect(countMatches(html, /<link rel="canonical"/g)).toBe(1);
    expect(html).toContain('href="https://tradeupbot.app/trade-ups"');
    expect(html).not.toContain("noindex");
  });

  it("injectMetaIntoSpa replaces duplicate template tags with one self-referencing canonical", () => {
    const html = `<!DOCTYPE html><html><head>
<title>Template</title><title>Duplicate</title>
<meta name="description" content="Template" />
<meta name="description" content="Duplicate" />
<link rel="canonical" href="https://tradeupbot.app/" />
<link rel="canonical" href="https://tradeupbot.app/old" />
</head><body><div id="root">app</div></body></html>`;

    const out = injectMetaIntoSpa(html, {
      title: "CS2 Skin Prices | TradeUpBot",
      description: "Browse live CS2 skin prices and float data.",
      url: "https://tradeupbot.app/skins",
    });

    expect(countMatches(out, /<title\b/g)).toBe(1);
    expect(countMatches(out, /<meta name="description"/g)).toBe(1);
    expect(countMatches(out, /<link rel="canonical"/g)).toBe(1);
    expect(out).toContain('href="https://tradeupbot.app/skins"');
  });
});

describe("server route canonical/noindex/404 behavior", () => {
  const source = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");

  it("dynamic collection, skin, and trade-up routes return 404 instead of falling through to SPA", () => {
    expect(source).toContain('res.status(404).send("Collection trade-up page not found")');
    expect(source).toContain('res.status(404).send("Collection not found")');
    expect(source).toContain('res.status(404).send("Skin not found")');
    expect(source).toContain('res.status(404).send("Trade-up not found")');
  });

  it("non-crawler dynamic pages inject route-specific canonical metadata into the SPA", () => {
    expect(source).toContain("https://tradeupbot.app/collections/${req.params.slug}");
    expect(source).toContain("https://tradeupbot.app/skins/${req.params.slug}");
    expect(source).toContain("https://tradeupbot.app/trade-ups/${req.params.id}");
    expect(countMatches(source, /injectMetaIntoSpa\(fs\.readFileSync\(indexPath, "utf-8"\), meta\)/g)).toBeGreaterThanOrEqual(3);
  });

  it("noindex remains limited to low-listing skins and stale trade-up details", () => {
    expect(source).toContain('const robots = listingCount < 5 ? "noindex, follow" : "index, follow"');
    expect(source).toContain('robots: isStale ? "noindex, follow" : "index, follow"');
    expect(countMatches(source, /noindex, follow/g)).toBe(2);
  });
});
