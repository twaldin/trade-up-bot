import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSeoHtml } from "../../server/seo.js";
import { STATIC_SEO_PAGES } from "../../server/static-seo-pages.js";
import { buildStaticSitemap } from "../../server/routes/sitemap.js";
import { expectedSeoRouteForPath, normalizePrerenderedHead, verifySeoHtml } from "../../scripts/seo-html.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const prerenderSource = readFileSync(join(__dir, "../../scripts/prerender.ts"), "utf-8");
const previewSeoSource = readFileSync(join(__dir, "../../src/preview/components/PreviewSeo.tsx"), "utf-8");
const sniperSource = readFileSync(join(__dir, "../../src/preview/pages/PreviewSniper.tsx"), "utf-8");
const HOME_TITLE = "TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings";
const HOME_H1 = "CS2 trade-ups built from real, buyable listings";

function staticPage(path: string) {
  const page = STATIC_SEO_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`missing static page ${path}`);
  return page;
}

function crawlerHtml(path: string): string {
  const page = staticPage(path);
  return buildSeoHtml({
    title: page.title,
    description: page.description,
    url: `https://tradeupbot.app${page.path}`,
    bodyHtml: page.bodyHtml,
    jsonLd: page.jsonLd,
    robots: page.robots,
    includeFooter: true,
  });
}

describe("listing-sniper crawler HTML isolation", () => {
  it("is a STATIC_SEO_PAGES entry with unique title, h1, and self canonical", () => {
    const page = staticPage("/listing-sniper");
    expect(page.title).toMatch(/listing sniper/i);
    expect(page.title).toMatch(/listing alerts/i);
    expect(page.title).not.toBe(HOME_TITLE);
    expect(page.bodyHtml).toMatch(/<h1>[^<]*Listing Sniper[^<]*<\/h1>/);
    expect(page.bodyHtml).not.toContain(HOME_H1);
    expect(page.description).toContain("Listings priced below estimated market value");
    expect(page.bodyHtml).toContain("Listings priced below estimated market value");
    expect(page.bodyHtml).not.toMatch(/testimonial/i);
    expect(page.bodyHtml).not.toMatch(/\b\d{3,}\s+(listings|alerts|users)/i);
  });

  it("keeps HOLD noindex and is not advertised in the static sitemap", () => {
    const page = staticPage("/listing-sniper");
    expect(page.robots).toBe("noindex, follow");
    expect(crawlerHtml("/listing-sniper")).toContain('name="robots" content="noindex, follow"');
    expect(buildStaticSitemap("https://tradeupbot.app", "2026-08-19")).not.toContain("/listing-sniper");
  });

  it("Googlebot document is unique — not the parked homepage", () => {
    const html = crawlerHtml("/listing-sniper");
    expect(html).toContain("<title>Listing Sniper — Live Listing Alerts | TradeUpBot</title>");
    expect(html).toContain("<h1>Listing Sniper</h1>");
    expect(html).toContain('rel="canonical" href="https://tradeupbot.app/listing-sniper"');
    expect(html).not.toContain(`<title>${HOME_TITLE}</title>`);
    expect(html).not.toContain('rel="canonical" href="https://tradeupbot.app/"');
    expect(html).not.toContain(HOME_H1);
  });

  it("does not flip /pricing /faq /features off their unique indexed documents", () => {
    for (const path of ["/pricing", "/faq", "/features"]) {
      const page = staticPage(path);
      const html = crawlerHtml(path);
      expect(page.robots ?? "index, follow").toBe("index, follow");
      expect(html).toContain(`href="https://tradeupbot.app${path}"`);
      expect(html).not.toContain('rel="canonical" href="https://tradeupbot.app/"');
      expect(html).not.toContain(HOME_H1);
      expect(html).not.toContain('name="robots" content="noindex, follow"');
    }
  });

  it("server static-page loop threads robots so listing-sniper is not the default index document", () => {
    expect(serverSource).toContain("robots: staticPage.robots");
    expect(serverSource).toContain("for (const staticPage of STATIC_SEO_PAGES)");
    expect(prerenderSource).toContain('"/listing-sniper"');
  });

  it("leftover kit PreviewSeo path uses the static page and HOLD noindex", () => {
    expect(sniperSource).toContain('seoPage("/listing-sniper")');
    expect(sniperSource).toContain("seo.robots");
    expect(sniperSource).toContain(">Listing Sniper<");
    expect(previewSeoSource).toContain("robots");
    expect(previewSeoSource).not.toMatch(/noindex/);
  });

  it("prerender head rewrite keeps listing-sniper unique and noindex", () => {
    const html = `<!doctype html><html><head>
<title>${HOME_TITLE}</title>
<meta name="description" content="homepage" />
<link rel="canonical" href="https://tradeupbot.app/" />
<meta name="robots" content="index, follow" />
</head><body><h1>${HOME_H1}</h1></body></html>`;

    const out = normalizePrerenderedHead(html, "/listing-sniper");
    const route = expectedSeoRouteForPath("/listing-sniper");
    expect(route?.canonical).toBe("https://tradeupbot.app/listing-sniper");
    expect(route?.robots).toBe("noindex, follow");
    expect(verifySeoHtml(route!, "listing-sniper/index.html", out)).toEqual([]);
    expect(out).toContain("Listing Sniper — Live Listing Alerts | TradeUpBot");
    expect(out).toContain('href="https://tradeupbot.app/listing-sniper"');
    expect(out).toContain('name="robots" content="noindex, follow"');
    expect(out).not.toContain('href="https://tradeupbot.app/"');
  });
});
