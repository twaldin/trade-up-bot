import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeoHtml, renderSeoFooter } from "../../server/seo.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const footerSource = readFileSync(join(__dir, "../../src/components/SiteFooter.tsx"), "utf-8");

const countAnchors = (html: string) => (html.match(/<a\s/g) || []).length;

describe("renderSeoFooter (crawler link hub)", () => {
  const footer = renderSeoFooter();

  it("links the core tools, top collections, and guides", () => {
    expect(footer).toContain('href="/calculator"');
    expect(footer).toContain('href="/trade-ups"');
    expect(footer).toContain('href="/skins"');
    expect(footer).toContain('href="/collections"');
    expect(footer).toContain('href="/listing-sniper"');
    expect(footer).toContain('href="/collections/dreams-nightmares"');
    expect(footer).toContain('href="/blog/how-cs2-trade-ups-work/"');
    expect(footer).toContain('href="/blog"');
  });

  it("stays well under the per-page link budget (~16 links)", () => {
    const n = countAnchors(footer);
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(20);
  });
});

describe("buildSeoHtml footer opt-in", () => {
  const base = { title: "T", description: "D", url: "https://tradeupbot.app/x", bodyHtml: "<p>body</p>" };

  it("includes the footer when includeFooter is true", () => {
    const html = buildSeoHtml({ ...base, includeFooter: true });
    expect(html).toContain('href="/calculator"');
    expect(html).toContain("<footer>");
  });

  it("omits the footer by default", () => {
    const html = buildSeoHtml(base);
    expect(html).not.toContain("<footer>");
  });
});

describe("high-cardinality pages must NOT opt into the footer (link-cap safety)", () => {
  it("the /skins hub buildSeoHtml call does not set includeFooter", () => {
    // /skins already emits up to 200 links; adding the footer would blow the budget.
    const skinsBlock = indexSource.match(/seo_skins_list_v2[\s\S]{0,2500}?buildSeoHtml\(\{[\s\S]{0,1200}?\}\)/);
    expect(skinsBlock, "could not locate /skins buildSeoHtml call").toBeTruthy();
    expect(skinsBlock![0]).not.toContain("includeFooter");
  });
});

describe("React SiteFooter hub", () => {
  it("has Tools and Guides link groups", () => {
    expect(footerSource).toContain(">Tools<");
    expect(footerSource).toContain(">Guides<");
    expect(footerSource).toContain('to="/calculator"');
    expect(footerSource).toContain('to="/listing-sniper"');
    expect(footerSource).toContain('to="/blog/how-cs2-trade-ups-work/"');
  });
});
