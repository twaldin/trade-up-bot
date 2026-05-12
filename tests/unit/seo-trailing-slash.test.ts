import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

describe("blog post canonical uses trailing slash (#2)", () => {
  it("BlogPostPage.tsx canonical href template ends with trailing slash", () => {
    const source = readFileSync(join(__dir, "../../src/pages/BlogPostPage.tsx"), "utf-8");
    // The canonical href should be /blog/${something}/ (trailing slash)
    // Not /blog/${something} (no trailing slash)
    // Matches template literal: /blog/${post.slug}/ followed by backtick
    expect(source).toMatch(/\/blog\/\$\{[^}]+\}\/`/);
  });

  it("server redirects non-trailing-slash blog post URLs before serving blog HTML", () => {
    const source = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
    const redirectRoute = source.indexOf("app.get(/^\\/blog\\/([^/]+)$/");
    const contentRoute = source.indexOf("app.get(/^\\/blog\\/([^/]+)\\/$/");

    expect(redirectRoute).toBeGreaterThan(-1);
    expect(contentRoute).toBeGreaterThan(-1);
    expect(redirectRoute).toBeLessThan(contentRoute);
    expect(source).toContain("res.redirect(301, `/blog/${slug}/`)");
  });

  it("server blog routes return 404 for unknown slugs instead of falling through to SPA", () => {
    const source = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
    const notFoundResponses = source.match(/res\.status\(404\)\.send\("Blog post not found"\)/g) || [];

    expect(notFoundResponses).toHaveLength(2);
  });

  it("server blog canonical and sitemap URL templates match exactly", () => {
    const indexSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
    const sitemapSource = readFileSync(join(__dir, "../../server/routes/sitemap.ts"), "utf-8");

    expect(indexSource).toContain("https://tradeupbot.app/blog/${slug}/");
    expect(sitemapSource).toContain("`/blog/${slug}/`");
  });
});
