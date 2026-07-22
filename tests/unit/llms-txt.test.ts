import { describe, it, expect } from "vitest";
import { LLMS_TXT } from "../../server/routes/llms.js";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";

describe("llms.txt", () => {
  it("follows the llmstxt.org shape: H1 title, blockquote summary, H2 sections", () => {
    expect(LLMS_TXT).toMatch(/^# TradeUpBot/);
    expect(LLMS_TXT).toMatch(/\n> /);
    expect(LLMS_TXT).toContain("\n## ");
  });

  it("states the differentiating facts an assistant should cite", () => {
    // Float-exact output pricing is the moat; live multi-market listings is the data claim.
    expect(LLMS_TXT.toLowerCase()).toContain("float");
    expect(LLMS_TXT).toContain("CSFloat");
    expect(LLMS_TXT).toContain("DMarket");
    expect(LLMS_TXT).toContain("Skinport");
    expect(LLMS_TXT).toContain("ten input");
  });

  it("does not overclaim (no promised guarantees, no 'risk-free')", () => {
    const t = LLMS_TXT.toLowerCase();
    // Negated forms ("nothing is guaranteed") are fine — promising forms are not.
    expect(t).not.toContain("we guarantee");
    expect(t).not.toContain("guaranteed profit");
    expect(t).not.toContain("risk-free");
    expect(t).not.toContain("always profit");
  });

  it("only links URLs that exist in the static sitemap (consistency)", () => {
    const sitemap = buildStaticSitemap("https://tradeupbot.app", "2026-01-01");
    const links = [...LLMS_TXT.matchAll(/https:\/\/tradeupbot\.app[^\s)]*/g)].map(m => m[0]);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const l of links) {
      expect(sitemap, `llms.txt links ${l} which is not in the static sitemap`).toContain(`<loc>${l}</loc>`);
    }
  });
});
