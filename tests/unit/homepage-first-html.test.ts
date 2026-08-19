import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blogMeta } from "../../src/data/blog-meta.js";
import { expectedSeoRouteForPath, verifySeoHtml } from "../../scripts/seo-html.js";
import { STATIC_SEO_PAGES, HOMEPAGE_SEO } from "../../server/static-seo-pages.js";
import { buildSeoHtml, buildHomepageJsonLd } from "../../server/seo.js";
import { PREVIEW_FAQ, PREVIEW_HEADLINE, PREVIEW_HOW } from "../../src/preview/lib/copy.js";
import { faqEntities, seoPage } from "../../src/preview/lib/seo-pages.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const landingSource = readFileSync(join(__dir, "../../src/preview/pages/PreviewLanding.tsx"), "utf-8");
const faqQuestions = faqEntities(seoPage("/faq"));

function asHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function homepageCrawlerHtml(): string {
  return buildSeoHtml({
    title: HOMEPAGE_SEO.title,
    description: HOMEPAGE_SEO.description,
    url: "https://tradeupbot.app/",
    bodyHtml: HOMEPAGE_SEO.bodyHtml,
    jsonLd: HOMEPAGE_SEO.jsonLd,
    robots: HOMEPAGE_SEO.robots ?? "index, follow",
  });
}

describe("homepage first HTML for Googlebot", () => {
  it("is a unique STATIC home document with the locked h1", () => {
    const route = expectedSeoRouteForPath("/");
    expect(HOMEPAGE_SEO.path).toBe("/");
    expect(HOMEPAGE_SEO.title).toBe(route?.title);
    expect(HOMEPAGE_SEO.description).toBe(route?.description);
    expect(HOMEPAGE_SEO.bodyHtml).toContain(`<h1>${PREVIEW_HEADLINE}</h1>`);
    expect(HOMEPAGE_SEO.bodyHtml.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(STATIC_SEO_PAGES.some((page) => page.path === "/")).toBe(false);
  });

  it("puts How / FAQ / blog copy in the first HTML, not only after hydrate", () => {
    const html = homepageCrawlerHtml();
    expect(html).toContain("How it works");
    expect(PREVIEW_HOW.length).toBeGreaterThan(3);
    for (const step of PREVIEW_HOW) {
      expect(html).toContain(asHtml(step.title));
      expect(html).toContain(asHtml(step.body));
    }
    for (const item of PREVIEW_FAQ) {
      expect(html).toContain(asHtml(item.q));
      expect(html).toContain(asHtml(item.a));
    }
    for (const item of faqQuestions) {
      expect(html).toContain(asHtml(item.q));
      expect(html).toContain(asHtml(item.a));
    }
    for (const post of blogMeta.slice(0, 4)) {
      expect(html).toContain(asHtml(post.title));
      expect(html).toContain(`/blog/${post.slug}/`);
    }
    expect(html).toContain("Free");
    expect(html).toContain("$6.99");
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/blog"');
    expect(html).toContain('href="/pricing"');
    expect(html).not.toMatch(/testimonial/i);
    expect(landingSource).toContain("PREVIEW_HOW");
    expect(landingSource).toContain("blogMeta");
  });

  it("keeps robots, unique title, and WebSite/Organization JSON-LD", () => {
    const html = homepageCrawlerHtml();
    const route = expectedSeoRouteForPath("/");
    expect(route).toBeTruthy();
    expect(verifySeoHtml(route!, "index.html", html)).toEqual([]);
    expect(html).toContain('name="robots" content="index, follow"');
    expect(html).not.toContain("noindex");
    expect(html).toContain("application/ld+json");
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@type":"Organization"');
    const jsonLd = HOMEPAGE_SEO.jsonLd ?? [];
    expect(jsonLd).toEqual([buildHomepageJsonLd()]);
  });

  it("serves the STATIC home body to crawlers and keeps the kit landing for humans", () => {
    expect(serverSource).toContain("HOMEPAGE_SEO");
    expect(serverSource).toContain("isCrawler(ua)");
    expect(serverSource).toContain("ensureHomepageCrawlerHead");
    expect(serverSource).toMatch(/app\.get\("\/"[\s\S]*HOMEPAGE_SEO/);
    expect(serverSource).toMatch(/app\.get\("\/"[\s\S]*isCrawler/);
  });
});
