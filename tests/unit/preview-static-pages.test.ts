import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STATIC_SEO_PAGES } from "../../server/static-seo-pages.js";
import { blogMeta } from "../../src/data/blog-meta.js";
import { blogPosts } from "../../src/data/blog-posts.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

function staticPage(path: string) {
  const page = STATIC_SEO_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`missing static page ${path}`);
  return page;
}

const pricing = read("../../src/preview/pages/PreviewPricing.tsx");
const faq = read("../../src/preview/pages/PreviewFaq.tsx");
const features = read("../../src/preview/pages/PreviewFeatures.tsx");
const blog = read("../../src/preview/pages/PreviewBlog.tsx");
const legal = read("../../src/preview/pages/PreviewLegal.tsx");
const share = read("../../src/preview/pages/PreviewShare.tsx");
const sniper = read("../../src/preview/pages/PreviewSniper.tsx");
const collectionTu = read("../../src/preview/pages/PreviewCollectionTradeUps.tsx");
const shell = read("../../src/preview/PreviewShell.tsx");
const app = read("../../src/App.tsx");
const server = read("../../server/index.ts");
const robots = read("../../public/robots.txt");

const leaks = [
  "rounded-md", "rounded-lg", "rounded-xl", "rounded-full",
  "text-muted-foreground", "border-border", "bg-background", "bg-card",
  "text-foreground", "bg-muted", "text-primary",
  "SiteNav", "SiteFooter",
];

describe("leftover marketing pages join the kit shell", () => {
  it("keeps unique crawler titles, h1s, and JSON-LD from static-seo-pages", () => {
    const pages = [
      { path: "/pricing", source: pricing, h1: "TradeUpBot Pricing" },
      { path: "/faq", source: faq, h1: "CS2 Trade-Up FAQ" },
      { path: "/features", source: features, h1: "TradeUpBot Features" },
      { path: "/terms", source: legal, h1: "Terms of Service" },
      { path: "/privacy", source: legal, h1: "Privacy Policy" },
      { path: "/listing-sniper", source: sniper, h1: "Listing Sniper" },
    ];
    const seoHelper = read("../../src/preview/lib/seo-pages.ts");
    const seoHead = read("../../src/preview/components/PreviewSeo.tsx");
    expect(seoHelper).toContain("STATIC_SEO_PAGES");
    expect(seoHead).toContain("index, follow");
    expect(seoHead).toContain("application/ld+json");
    expect(seoHead).not.toMatch(/noindex/);
    for (const { path, source, h1 } of pages) {
      const seo = staticPage(path);
      expect(source, `${path} dropped seoPage`).toContain(`seoPage("${path}")`);
      expect(source, `${path} dropped unique h1`).toContain(`>${h1}<`);
      expect(source).not.toMatch(/noindex/);
      expect(source).toContain(`https://tradeupbot.app${path}`);
      if (seo.jsonLd) {
        expect(source, `${path} dropped JSON-LD`).toContain("jsonLd");
      }
    }
  });

  it("does not invent prices, testimonials, or volume on pricing", () => {
    expect(pricing).toContain("$0");
    expect(pricing).toContain("$6.99");
    expect(pricing).toContain("$59.99");
    expect(pricing).toContain("$74.99");
    expect(pricing).toContain("/api/subscribe");
    expect(pricing).toContain('JSON.stringify({ plan })');
    expect(pricing).toContain("pro-yearly");
    expect(pricing).toContain("pro-lifetime");
    expect(pricing).toContain("Go Pro");
    expect(pricing).not.toMatch(/testimonial/i);
    expect(pricing).not.toContain("$15");
  });

  it("keeps FAQ, features, terms, and privacy claims from the existing pages", () => {
    expect(faq).toContain("faqEntities");
    expect(faq).toContain('seoPage("/faq")');
    expect(staticPage("/faq").bodyHtml).toContain("Is CS2 trade-up profit real or just theoretical?");
    expect(staticPage("/faq").bodyHtml).toContain("Why does TradeUpBot disagree with other trade-up calculators?");
    expect(features).toContain("Real marketplace listings");
    expect(features).toContain("Float-targeted discovery across 45+ targets");
    expect(features).toContain("Verify system");
    expect(features).toContain("Claim system");
    expect(legal).toContain("Last updated: March 2026");
    expect(legal).toContain("TradeUpBot is an informational tool only");
    expect(legal).toContain("What We Collect");
    expect(legal).toContain("Steam OpenID");
  });

  it("kits the blog index and posts without inventing articles", () => {
    expect(blog).toContain("Blog — CS2 Trade-Up Guides & Analysis | TradeUpBot");
    expect(blog).toContain("CS2 Trade-Up Guides & Analysis");
    expect(blog).toContain("blogMeta");
    expect(blog).toContain("getPostBySlug");
    expect(blog).toContain("to={`/blog/${post.slug}/`}");
    expect(blog).not.toContain("to={`/blog/${post.slug}`}");
    expect(blog).toContain("to={`/blog/${related.slug}/`}");
    expect(blog).toContain("dangerouslySetInnerHTML");
    expect(blog).toContain("post.content");
    expect(blog).toContain("BlogPosting");
    expect(blogPosts.map((post) => post.slug).sort()).toEqual(blogMeta.map((post) => post.slug).sort());
  });

  it("does not leak old marketing chrome or production utilities", () => {
    for (const [name, source] of [
      ["pricing", pricing],
      ["faq", faq],
      ["features", features],
      ["blog", blog],
      ["legal", legal],
      ["share", share],
      ["sniper", sniper],
      ["collectionTradeUps", collectionTu],
    ] as const) {
      for (const leak of leaks) {
        expect(source, `${name} leaks ${leak}`).not.toContain(leak);
      }
    }
    expect(shell).not.toContain('to: "/pricing"');
    expect(app).not.toContain("element={<PricingPage");
  });

  it("holds robots and the soft-200 park — leftover money pages stay indexable, listing-sniper HOLDs noindex", () => {
    expect(robots).toContain("Disallow: /preview");
    expect(server).toContain("STATIC_SEO_PAGES");
    expect(server).toContain("jsonLd: staticPage.jsonLd");
    expect(server).toContain("robots: staticPage.robots");
    expect(server).toContain('app.get("/blog"');
    expect(server).toContain("registerBlogRoutes");
    expect(pricing).not.toMatch(/noindex/);
    expect(faq).not.toMatch(/noindex/);
    expect(features).not.toMatch(/noindex/);
    expect(blog).not.toMatch(/noindex/);
    expect(legal).not.toMatch(/noindex/);
    expect(share).not.toMatch(/noindex/);
    expect(collectionTu).not.toMatch(/noindex/);
    expect(sniper).toContain("seo.robots");
    expect(staticPage("/listing-sniper").robots).toBe("noindex, follow");
  });

  it("kits share, sniper, and collection trade-up URLs without old chrome", () => {
    expect(share).toContain("MY_TRADE_UPS_API.verify");
    expect(share).toContain("MY_TRADE_UPS_API.claim");
    expect(share).toContain("MY_TRADE_UPS_API.confirm");
    expect(share).toContain("MY_TRADE_UPS_API.unclaim");
    expect(share).toContain("TradeUpCard");
    expect(share).not.toContain("EV:");
    expect(share).not.toContain("preview-strip");
    expect(share).not.toContain("OutcomeChart");
    expect(share).not.toContain("SiteNav");
    expect(sniper).toContain("/api/listing-sniper");
    expect(sniper).toContain("/api/listing-sniper/filter-options");
    expect(sniper).toContain("Listing Sniper");
    expect(sniper).toContain("Listings priced below estimated market value");
    expect(sniper).not.toContain("AuthGatedApp");
    expect(collectionTu).toContain("usePreviewTradeUps");
    expect(collectionTu).toContain("Trade-Ups");
    expect(collectionTu).toContain("previewCollectionHref");
    expect(collectionTu).not.toContain("NotFoundPage");
  });

  it("keeps the selected billing tab inked so Monthly is visible", () => {
    const css = read("../../src/preview/preview.css");
    expect(css).not.toMatch(/\.preview-tabs \.o-tab \{[^}]*background:\s*transparent/);
    expect(pricing).toContain("Monthly");
    expect(pricing).toContain("Yearly · save 28%");
    expect(pricing).toContain("Lifetime · best value");
  });
});
