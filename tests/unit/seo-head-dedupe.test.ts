import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { dedupeHead } from "../../server/seo.js";

const __dir = dirname(fileURLToPath(import.meta.url));

describe("dedupeHead on realistic prerender capture (#1)", () => {
  it("removes all duplicate title/canonical/description tags from puppeteer-captured HTML", () => {
    const html = `<!DOCTYPE html><html lang="en"><head>
<link rel="canonical" href="https://tradeupbot.app/" />
<title></title>
<title>TradeUpBot — Find Profitable CS2 Trade-Ups</title>
<meta name="description" content="Template description" />
<meta property="og:title" content="TradeUpBot — CS2 Trade-Up Finder" />
<meta property="og:url" content="https://tradeupbot.app/" />
<link rel="canonical" href="https://tradeupbot.app/" />
<title>CS2 Float Values Guide | TradeUpBot Blog</title>
<meta name="description" content="CS2 float values explained." />
<meta property="og:title" content="CS2 Float Values Guide" data-rh="true" />
<meta property="og:url" content="https://tradeupbot.app/blog/cs2-trade-up-float-values-guide/" data-rh="true" />
<link rel="canonical" href="https://tradeupbot.app/blog/cs2-trade-up-float-values-guide/" data-rh="true" />
</head><body></body></html>`;

    const out = dedupeHead(html);

    expect((out.match(/<title[^>]*>/g) ?? []).length).toBe(1);
    expect(out).not.toContain("<title></title>");
    expect((out.match(/rel="canonical"/g) ?? []).length).toBe(1);
    expect((out.match(/name="description"/g) ?? []).length).toBe(1);
    expect((out.match(/property="og:title"/g) ?? []).length).toBe(1);
    expect((out.match(/property="og:url"/g) ?? []).length).toBe(1);
    // Helmet (data-rh) tags preferred over template tags
    expect(out).toContain("CS2 Float Values Guide");
    expect(out).toContain("blog/cs2-trade-up-float-values-guide/");
  });
});

describe("dedupeHead with react-helmet-async@3 output (no data-rh attribute)", () => {
  it("keeps last occurrence when helmet tags don't have data-rh — helmet appends to head", () => {
    // Real react-helmet-async@3 output: tags appear at end of head WITHOUT data-rh attribute.
    // dedupeHead must keep the LAST occurrence (helmet's append) not the FIRST (template).
    const html = `<!DOCTYPE html><html lang="en"><head>
<link rel="canonical" href="https://tradeupbot.app/">
<title>TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings</title>
<meta name="description" content="Real-time CS2 trade-up contract analyzer.">
<meta property="og:title" content="TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings">
<meta property="og:url" content="https://tradeupbot.app">
<title>CS2 Float Values Guide | TradeUpBot Blog</title>
<meta name="description" content="CS2 float values explained.">
<link rel="canonical" href="https://tradeupbot.app/blog/cs2-trade-up-float-values-guide/">
<meta property="og:title" content="CS2 Float Values Guide | TradeUpBot Blog">
<meta property="og:url" content="https://tradeupbot.app/blog/cs2-trade-up-float-values-guide/">
</head><body></body></html>`;

    const out = dedupeHead(html);

    expect((out.match(/<title[^>]*>/g) ?? []).length).toBe(1);
    expect((out.match(/rel="canonical"/g) ?? []).length).toBe(1);
    expect((out.match(/property="og:title"/g) ?? []).length).toBe(1);
    expect((out.match(/property="og:url"/g) ?? []).length).toBe(1);

    // The blog-post tags appear AFTER the template tags in head — must be kept.
    expect(out).toContain("CS2 Float Values Guide");
    expect(out).toContain("blog/cs2-trade-up-float-values-guide/");
    expect(out).not.toContain("Find Profitable CS2 Trade-Ups from Real Listings");
    expect(out).not.toContain('content="https://tradeupbot.app"');
  });
});

describe("index.html og:title matches title (#12)", () => {
  it("og:title equals title in index.html template", () => {
    const html = readFileSync(join(__dir, "../../index.html"), "utf-8");
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const ogTitleMatch = html.match(/<meta\s[^>]*property="og:title"[^>]*content="([^"]+)"/);
    expect(titleMatch, "title tag missing from index.html").toBeTruthy();
    expect(ogTitleMatch, "og:title meta missing from index.html").toBeTruthy();
    expect(ogTitleMatch![1]).toBe(titleMatch![1]);
  });
});
