import { describe, expect, it } from "vitest";
import { expectedSeoRouteForPath, normalizePrerenderedHead, verifySeoHtml } from "../../scripts/seo-html.js";

describe("static SEO HTML normalization", () => {
  it("rewrites stale prerender titles to the expected route-specific title", () => {
    const html = `<!doctype html><html><head>
<title>TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings</title>
<meta name="description" content="stale home description" />
<link rel="canonical" href="https://tradeupbot.app/" />
</head><body><h1>CS2 Trade-Up Calculator</h1></body></html>`;

    const out = normalizePrerenderedHead(html, "/calculator");
    const route = expectedSeoRouteForPath("/calculator");

    expect(route).toBeTruthy();
    expect(verifySeoHtml(route!, "calculator/index.html", out)).toEqual([]);
    expect(out).toContain("<title>Free CS2 Trade-Up Calculator — Profit, Float &amp; EV | TradeUpBot</title>");
  });

  it("normalizes blog post paths to trailing-slash canonicals", () => {
    const route = expectedSeoRouteForPath("/blog/how-cs2-trade-ups-work/");

    expect(route?.canonical).toBe("https://tradeupbot.app/blog/how-cs2-trade-ups-work/");
    expect(route?.title).toBe("How CS2 Trade-Ups Work: 10 Skins, Float & Profit | TradeUpBot");
  });

  it("reports duplicate or mismatched head tags", () => {
    const route = expectedSeoRouteForPath("/faq");
    const html = `<!doctype html><html><head>
<title>Wrong</title><title>Wrong again</title>
<meta name="description" content="Wrong" />
<link rel="canonical" href="https://tradeupbot.app/wrong" />
</head></html>`;

    expect(route).toBeTruthy();
    const issues = verifySeoHtml(route!, "faq/index.html", html).map((issue) => issue.message);

    expect(issues).toContain("expected exactly 1 title, found 2");
    expect(issues).toContain("description mismatch: Wrong");
    expect(issues).toContain("canonical mismatch: https://tradeupbot.app/wrong");
  });

  it("homepage prerender gains robots index,follow and the old WebSite JSON-LD", () => {
    const html = `<!doctype html><html><head>
<title>TradeUpBot — CS2 trade-ups from real listings</title>
<meta name="description" content="kit landing description" />
</head><body><h1>CS2 trade-ups built from real, buyable listings</h1></body></html>`;

    const out = normalizePrerenderedHead(html, "/");
    const route = expectedSeoRouteForPath("/");

    expect(route).toBeTruthy();
    expect(verifySeoHtml(route!, "index.html", out)).toEqual([]);
    expect(out).toContain('name="robots" content="index, follow"');
    expect(out).toContain("application/ld+json");
    expect(out).toContain('"@type":"WebSite"');
    expect(out).toContain('"@type":"Organization"');
    expect(out).toContain("https://tradeupbot.app/");
  });

  it("does not require JSON-LD on calculator title/canonical checks", () => {
    const html = `<!doctype html><html><head>
<title>stale</title>
</head><body><h1>CS2 Trade-Up Calculator</h1></body></html>`;

    const out = normalizePrerenderedHead(html, "/calculator");
    const route = expectedSeoRouteForPath("/calculator");

    expect(route).toBeTruthy();
    expect(verifySeoHtml(route!, "calculator/index.html", out)).toEqual([]);
  });
});
