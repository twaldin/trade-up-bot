/**
 * Locked GTM copy for /blog/best-cs2-trade-up-simulator/.
 * This URL is the guide. /calculator and the live board are the tools.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectedSeoRouteForPath } from "../../scripts/seo-html.js";
import { blogPostHeading, getPostBySlug } from "../../src/data/blog-posts.js";
import { blogMeta } from "../../src/data/blog-meta.js";
import { STATIC_SEO_PAGES } from "../../server/static-seo-pages.js";
import { buildSeoHtml, injectMetaIntoSpa } from "../../server/seo.js";
import { buildBlogPostSeo } from "../../server/blog-routes.js";

const SLUG = "best-cs2-trade-up-simulator";
const LOCKED_TITLE = "CS2 Trade-Up Simulator vs Calculator (Live Listings) | TradeUpBot";
const LOCKED_H1 = "CS2 Trade-Up Simulator vs Calculator";
const LOCKED_META =
  "A guide to CS2 trade-up simulators vs calculators. Live listings, exact floats, and fees — then use the TradeUpBot calculator to test a contract.";
const LOCKED_FAQ_Q = "What is the best CS2 trade up simulator?";
const LOCKED_FAQ_A =
  "The TradeUpBot calculator (/calculator) and the live trade-up board (/trade-ups) are the tools. This URL (/blog/best-cs2-trade-up-simulator/) is the guide comparing CS2 trade-up simulators vs calculators.";

const __dir = dirname(fileURLToPath(import.meta.url));
const spaShell = `<!DOCTYPE html><html><head>
<title>Template</title>
<meta name="description" content="Template" />
<link rel="canonical" href="https://tradeupbot.app/" />
</head><body><div id="root"><p>hydrate me</p></div></body></html>`;

describe("best-cs2-trade-up-simulator guide SEO lock", () => {
  const post = getPostBySlug(SLUG);
  const meta = blogMeta.find((entry) => entry.slug === SLUG);

  it("keeps the URL, self-canonical, and index,follow", () => {
    expect(post?.slug).toBe(SLUG);
    const route = expectedSeoRouteForPath(`/blog/${SLUG}/`);
    expect(route?.canonical).toBe(`https://tradeupbot.app/blog/${SLUG}/`);
    expect(route?.robots).toBeUndefined();
    expect(buildSeoHtml({
      title: LOCKED_TITLE,
      description: LOCKED_META,
      url: `https://tradeupbot.app/blog/${SLUG}/`,
    })).toContain('content="index, follow"');
  });

  it("matches locked title, h1, and meta in app data", () => {
    expect(post).toBeTruthy();
    expect(`${post!.title} | TradeUpBot`).toBe(LOCKED_TITLE);
    expect(blogPostHeading(post!)).toBe(LOCKED_H1);
    expect(post!.excerpt).toBe(LOCKED_META);
    expect(meta?.title).toBe(post!.title);
    expect(meta?.excerpt).toBe(LOCKED_META);
  });

  it("answers the simulator FAQ as tools + guide, not as this page being the product", () => {
    expect(post).toBeTruthy();
    const faq = post!.faq?.find((item) => item.question === LOCKED_FAQ_Q);
    expect(faq?.answer).toBe(LOCKED_FAQ_A);
    expect(post!.content).toContain(`<h3>${LOCKED_FAQ_Q}</h3>`);
    expect(post!.content).toContain(LOCKED_FAQ_A);
    expect(faq?.answer).toContain("/calculator");
    expect(faq?.answer).toMatch(/live (trade-up )?board/i);
    expect(faq?.answer).toContain(`/blog/${SLUG}/`);
    expect(faq?.answer.toLowerCase()).not.toMatch(/this page is the simulator/);
    expect(post!.content.toLowerCase()).not.toMatch(/this page is the simulator/);
  });

  it("keeps existing /calculator links in the article", () => {
    expect(post?.content).toContain('href="/calculator"');
  });

  it("serves matching first-HTML for Googlebot", () => {
    expect(post).toBeTruthy();
    const seo = buildBlogPostSeo(post!);
    const html = buildSeoHtml({
      title: seo.title,
      description: seo.description,
      url: seo.url,
      bodyHtml: seo.bodyHtml,
      ogType: "article",
      includeFooter: true,
      jsonLd: seo.jsonLd,
    });

    expect(html).toContain(`<title>${LOCKED_TITLE}</title>`);
    expect(html).toContain(`content="${LOCKED_META}"`);
    expect(html).toContain(`<h1>${LOCKED_H1}</h1>`);
    expect(html).not.toContain("<h1>Best CS2 Trade Up Simulator for Live Profit Checks</h1>");
    expect(html).toContain('rel="canonical" href="https://tradeupbot.app/blog/best-cs2-trade-up-simulator/"');
    expect(html).toContain('name="robots" content="index, follow"');
    expect(html).toContain(LOCKED_FAQ_Q);
    expect(html).toContain(LOCKED_FAQ_A);
    expect(html).toContain('href="/calculator"');
    expect(html).toContain(LOCKED_H1);
    expect(JSON.stringify(seo.jsonLd)).toContain(LOCKED_FAQ_A);
    expect(JSON.stringify(seo.jsonLd)).toContain(`"headline":"${LOCKED_H1}"`);
  });

  it("puts the /calculator CTA in first-HTML without hydration", () => {
    expect(post).toBeTruthy();
    const seo = buildBlogPostSeo(post!);
    const html = injectMetaIntoSpa(spaShell, {
      title: seo.title,
      description: seo.description,
      url: seo.url,
      bodyHtml: seo.bodyHtml,
    });

    expect(html).toContain(`<title>${LOCKED_TITLE}</title>`);
    expect(html).toContain(`<h1>${LOCKED_H1}</h1>`);
    expect(html).toContain('href="/calculator"');
    expect(html).toContain("Try the calculator");
    expect(html).toContain(LOCKED_FAQ_A);
  });

  it("does not change /calculator title, H1, or JSON-LD", () => {
    const calculator = STATIC_SEO_PAGES.find((page) => page.path === "/calculator");
    expect(calculator?.title).toBe("Free CS2 Trade-Up Calculator — Profit, Float & EV | TradeUpBot");
    expect(calculator?.bodyHtml).toContain("<h1>CS2 Trade-Up Calculator</h1>");
    expect(calculator?.jsonLd?.[0]).toMatchObject({
      "@type": "SoftwareApplication",
      name: "TradeUpBot CS2 Trade-Up Calculator",
    });
  });
});

describe("blog-routes first-HTML uses the heading helper", () => {
  it("renders h1 from blogPostHeading, not a hardcoded product claim", () => {
    const source = readFileSync(join(__dir, "../../server/blog-routes.ts"), "utf-8");
    expect(source).toContain("blogPostHeading");
    expect(source).toContain("<article><h1>${escapeHtml(heading)}</h1>");
    expect(source).toContain("href=\"/calculator\"");
  });
});
