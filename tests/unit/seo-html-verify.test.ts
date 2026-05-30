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
    expect(out).toContain("<title>CS2 Trade-Up Calculator — Estimate Profit, EV &amp; Float | TradeUpBot</title>");
  });

  it("normalizes blog post paths to trailing-slash canonicals", () => {
    const route = expectedSeoRouteForPath("/blog/how-cs2-trade-ups-work/");

    expect(route?.canonical).toBe("https://tradeupbot.app/blog/how-cs2-trade-ups-work/");
    expect(route?.title).toBe("How CS2 Trade-Ups Work: 10 Skins, Float & Profit | TradeUpBot Blog");
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
});
