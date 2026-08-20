import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blogMeta } from "../../src/data/blog-meta.js";
import {
  PREVIEW_FAQ,
  PREVIEW_HEADLINE,
  PREVIEW_HOW,
  PREVIEW_VALUE,
  PREVIEW_VALUE_HEADLINE,
} from "../../src/preview/lib/copy.js";
import { faqEntities, seoPage } from "../../src/preview/lib/seo-pages.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const landing = read("../../src/preview/pages/PreviewLanding.tsx");
const css = read("../../src/preview/preview.css");
const copy = read("../../src/preview/lib/copy.ts");
const app = read("../../src/preview/PreviewApp.tsx");
const chrome = read("../../src/preview/PreviewChrome.tsx");
const faqQuestions = faqEntities(seoPage("/faq"));

describe("preview landing depth", () => {
  it("keeps the locked headline as the only h1 and does not invent testimonials", () => {
    expect(PREVIEW_HEADLINE).toBe("CS2 trade-ups built from real, buyable listings");
    expect(landing).toContain("PREVIEW_HEADLINE");
    expect(landing.match(/<h1/g)).toHaveLength(1);
    expect(landing).not.toMatch(/testimonial/i);
    expect(landing).not.toMatch(/\b\d{3,}\s+(users|customers|traders)\b/i);
    expect(copy).not.toMatch(/testimonial/i);
  });

  it("mounts a live TradeUpCard pair and a real PriceScatter, not screenshots", () => {
    expect(landing).toContain("TradeUpCard");
    expect(landing).toContain("PriceScatter");
    expect(landing).toContain("usePreviewTradeUps");
    expect(landing).toContain("preview-card--expanded");
    expect(landing).not.toContain("tradeuptable.jpg");
    expect(landing).not.toContain("expanded-1280w");
    expect(landing).not.toContain("dataviewer-1280w");
    expect(landing).not.toContain("DemoAnimation");
  });

  it("tints stacked faces from the real skin rarity, never a rainbow or lime rarity", () => {
    expect(landing).toContain("inputRarityColor");
    expect(landing).toContain("outputRarityColor");
    expect(landing).toContain("boardFaceFor");
    expect(landing).toContain("preview-floatdeck");
    expect(landing).not.toContain("rarityTint(\"Extraordinary\")");
    expect(landing).not.toMatch(/#d7fe52/);
    expect(css).toContain(".preview-floatdeck");
    expect(css).toContain("perspective:");
    expect(css).not.toContain(".preview-strip");
  });

  it("thickens How / FAQ / blog / pricing with leftover-page copy", () => {
    expect(PREVIEW_HOW.length).toBeGreaterThan(3);
    expect(PREVIEW_VALUE).toHaveLength(3);
    expect(PREVIEW_VALUE_HEADLINE).toBe("What you see is what you pay");
    expect(landing).toContain('id="how"');
    expect(landing).toContain('id="faq"');
    expect(landing).toContain('id="blog"');
    expect(landing).toContain('id="pricing"');
    expect(landing).toContain("PREVIEW_HOW");
    expect(landing).toContain("faqEntities");
    expect(landing).toContain("blogMeta");
    expect(landing).toContain('to="/faq"');
    expect(landing).toContain('to="/blog"');
    expect(landing).toContain('to="/pricing"');
    expect(landing).toContain("$6.99");
    expect(landing).toContain("Free");
    expect(faqQuestions.length).toBeGreaterThan(5);
    expect(PREVIEW_FAQ).toHaveLength(5);
  });

  it("uses real blogMeta posts and the STATIC FAQ answers, inventing neither", () => {
    expect(blogMeta.slice(0, 4)).toHaveLength(4);
    expect(landing).toContain("blogMeta.slice(0, 4)");
    expect(landing).not.toContain("to={`/blog/${post.slug}`}");
    expect(landing).toContain("to={`/blog/${post.slug}/`}");
    expect(faqQuestions[0]?.q).toBe("Is CS2 trade-up profit real or just theoretical?");
  });

  it("keeps listings story on the left rail and hover-to-skin dead", () => {
    expect(landing).toContain("preview-section--band");
    expect(landing).not.toContain("SkinStats");
    expect(landing).not.toContain("setFocus");
    expect(landing).not.toContain("setPinned");
    expect(landing).not.toContain("preview-allskins");
    expect(landing).not.toContain("setInterval");
  });

  it("renders every card input on the story rail, not a tease of 8", () => {
    expect(landing).toContain("storyRailInputs");
    expect(landing).not.toContain("slice(0, 8)");
    expect(landing).toContain("preview-listings--story");
  });

  it("does not leak production chrome or grow huge tiles", () => {
    for (const leak of ["rounded-md", "text-muted-foreground", "border-border", "SiteNav"]) {
      expect(landing).not.toContain(leak);
    }
    expect(landing).not.toMatch(/\b[Cc]ontracts?\b/);
    expect(css).not.toContain("min-height: 280px");
    expect(css).not.toContain("min-height: 140px");
    expect(css).not.toMatch(/220px/);
  });
});

describe("kit landing unique home head", () => {
  it("emits the unique indexed title, not a second h1", () => {
    expect(chrome).toContain("TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings");
    expect(chrome).toContain("index, follow");
    expect(chrome).toContain("buildHomepageJsonLd");
    expect(app).toContain("PreviewChrome");
    expect(chrome).not.toMatch(/noindex/);
    expect(app).not.toMatch(/noindex/);
  });
});
