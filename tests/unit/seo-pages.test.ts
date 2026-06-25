import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { STATIC_SEO_PAGES } from "../../server/static-seo-pages.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const staticSeoPagesSource = readFileSync(join(__dir, "../../server/static-seo-pages.ts"), "utf-8");
const blogRoutesSource = readFileSync(join(__dir, "../../server/blog-routes.ts"), "utf-8");

function staticPage(path: string) {
  const p = STATIC_SEO_PAGES.find((x) => x.path === path);
  if (!p) throw new Error(`missing static page ${path}`);
  return p;
}
function ldTypes(jsonLd: Record<string, unknown>[] | undefined): string[] {
  return (jsonLd ?? []).map((x) => String(x["@type"]));
}

describe("SEO crawler page robustness", () => {
  it("skin crawler pages do not fail when optional output_skin_names stats are unavailable", () => {
    // outputStats query is wrapped with .catch() in Promise.all to preserve resilience
    expect(serverSource).toContain("Skin SEO output count unavailable:");
    expect(serverSource).toContain("output_skin_names @> ARRAY[$1]::text[]");
    expect(serverSource).toContain("outputStatsResult.rows[0]?.count || 0");
  });

  it("collection trade-up crawler pages include H1 and trade-up data table markup", () => {
    expect(serverSource).toContain("<h1>${e(displayName)} Trade-Ups</h1>");
    expect(serverSource).toContain("<th>ID</th><th>Cost</th><th>Profit</th><th>ROI</th><th>Chance</th>");
    expect(serverSource).toContain("Best ${displayName} Trade-Ups");
  });

  it("skin crawler pages include H1, listing data, float range, and rich body sections", () => {
    expect(serverSource).toContain("<h1>${e(skinName)}</h1>");
    expect(serverSource).toContain("<strong>Float Range:</strong>");
    expect(serverSource).toContain("<strong>Listings:</strong>");
    expect(serverSource).toContain("Frequently Asked Questions");
  });

  it("non-existent blog slugs still return 404 for trailing-slash canonical routes", () => {
    expect(blogRoutesSource).toContain('res.status(404).send("Blog post not found")');
    expect(blogRoutesSource).toContain('res.redirect(301, `/blog/${slug}/`)');
  });

  it("static sitemap pages have crawler-specific meaningful fallback content", () => {
    expect(serverSource).toContain("STATIC_SEO_PAGES");
    expect(serverSource).toContain("for (const staticPage of STATIC_SEO_PAGES)");
    expect(serverSource).toContain("bodyHtml: staticPage.bodyHtml");
    expect(staticSeoPagesSource).toContain("CS2 Trade-Up Calculator");
    expect(staticSeoPagesSource).toContain("TradeUpBot Features");
  });

  it("blog sitemap pages render actual blog post content for crawlers", () => {
    expect(blogRoutesSource).toContain('import { blogPosts, type BlogPost } from "../src/data/blog-posts.js";');
    expect(blogRoutesSource).toContain("const BLOG_POST_META: Record<string, BlogPost>");
    expect(blogRoutesSource).toContain("const blogBodyHtml");
    expect(blogRoutesSource).toContain("<article><h1>${escapeHtml(post.title)}</h1>");
    expect(blogRoutesSource).toContain("${post.content}<p><em>Published");
  });
});

describe("plan 023: JSON-LD schema on bare money pages", () => {
  it("static route threads staticPage.jsonLd into buildSeoHtml", () => {
    expect(serverSource).toContain("jsonLd: staticPage.jsonLd");
  });

  it("/calculator carries SoftwareApplication + FAQPage + BreadcrumbList", () => {
    expect(ldTypes(staticPage("/calculator").jsonLd)).toEqual([
      "SoftwareApplication",
      "FAQPage",
      "BreadcrumbList",
    ]);
  });

  it("/faq carries FAQPage + BreadcrumbList", () => {
    expect(ldTypes(staticPage("/faq").jsonLd)).toEqual(["FAQPage", "BreadcrumbList"]);
  });

  it("/pricing carries Product with the real offers (no false $5/$15) + BreadcrumbList", () => {
    const p = staticPage("/pricing");
    expect(ldTypes(p.jsonLd)).toEqual(["Product", "BreadcrumbList"]);
    const offers = p.jsonLd![0].offers as { price: string }[];
    expect(offers.map((o) => o.price).sort()).toEqual(["0", "59.99", "6.99", "74.99"]);
    expect(offers.map((o) => o.price)).not.toContain("5");
    expect(offers.map((o) => o.price)).not.toContain("15");
  });

  // FAQ schema answers MUST appear verbatim in the visible body (Google parity requirement).
  for (const path of ["/calculator", "/faq"]) {
    it(`${path} FAQPage answers match the visible body verbatim`, () => {
      const p = staticPage(path);
      const faq = (p.jsonLd ?? []).find((x) => x["@type"] === "FAQPage");
      const entities = faq!.mainEntity as { acceptedAnswer: { text: string } }[];
      expect(entities.length).toBeGreaterThan(0);
      for (const q of entities) {
        expect(p.bodyHtml).toContain(q.acceptedAnswer.text);
      }
    });
  }

  it("/skins hub emits CollectionPage + ItemList JSON-LD under a bumped cache key", () => {
    expect(serverSource).toContain("seo_skins_list_v2");
    expect(serverSource).toContain('"@type": "CollectionPage"');
    expect(serverSource).toContain('"@type": "ItemList"');
  });

  it("/calculator body carries the float-exact differentiator narrative", () => {
    expect(staticSeoPagesSource).toContain("Why most CS2 trade-up calculators are wrong");
    expect(staticSeoPagesSource).toContain("exact predicted output float");
  });
});
