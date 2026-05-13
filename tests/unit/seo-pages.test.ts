import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");

describe("SEO crawler page robustness", () => {
  it("skin crawler pages do not fail when optional output_skin_names stats are unavailable", () => {
    expect(serverSource).toContain("let outputTuCount = 0;");
    expect(serverSource).toContain("Skin SEO output count unavailable:");
    expect(serverSource).toContain("output_skin_names @> ARRAY[$1]::text[]");
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
    expect(serverSource).toContain('res.status(404).send("Blog post not found")');
    expect(serverSource).toContain('res.redirect(301, `/blog/${slug}/`)');
  });

  it("static sitemap pages have crawler-specific meaningful fallback content", () => {
    expect(serverSource).toContain("STATIC_SEO_PAGES");
    expect(serverSource).toContain("for (const staticPage of STATIC_SEO_PAGES)");
    expect(serverSource).toContain("bodyHtml: staticPage.bodyHtml");
    expect(serverSource).toContain("CS2 Trade-Up Calculator");
    expect(serverSource).toContain("TradeUpBot Features");
  });

  it("blog sitemap pages render actual blog post content for crawlers", () => {
    expect(serverSource).toContain('import { blogPosts, type BlogPost } from "../src/data/blog-posts.js";');
    expect(serverSource).toContain("const BLOG_POST_META: Record<string, BlogPost>");
    expect(serverSource).toContain("const blogBodyHtml");
    expect(serverSource).toContain("<article><h1>${escapeHtml(post.title)}</h1>");
    expect(serverSource).toContain("${post.content}<p><em>Published");
  });
});
