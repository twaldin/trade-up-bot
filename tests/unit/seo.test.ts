import { describe, it, expect } from "vitest";
import { buildSeoHtml } from "../../server/seo.js";

describe("buildSeoHtml", () => {
  it("generates valid HTML with title and meta tags", () => {
    const html = buildSeoHtml({
      title: "AK-47 Redline Price & Float Data — CS2 | TradeUpBot",
      description: "AK-47 Redline prices from $5.00 to $50.00. 42 active listings.",
      url: "https://tradeupbot.app/skins/ak-47-redline",
      robots: "index, follow",
    });

    expect(html).toContain("<title>AK-47 Redline Price &amp; Float Data");
    expect(html).toContain('content="AK-47 Redline prices from $5.00');
    expect(html).toContain('content="index, follow"');
    expect(html).toContain('og:title');
    expect(html).toContain('og:url');
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("includes body content when provided", () => {
    const html = buildSeoHtml({
      title: "Test",
      description: "Test desc",
      url: "https://tradeupbot.app/test",
      bodyText: "This is visible content for crawlers.",
    });

    expect(html).toContain("This is visible content for crawlers.");
  });

  it("includes JSON-LD when provided", () => {
    const html = buildSeoHtml({
      title: "Test",
      description: "Test desc",
      url: "https://tradeupbot.app/test",
      jsonLd: { "@context": "https://schema.org", "@type": "WebPage" },
    });

    expect(html).toContain("application/ld+json");
    expect(html).toContain('"@type":"WebPage"');
  });

  it("sets noindex when specified", () => {
    const html = buildSeoHtml({
      title: "Stale Trade-Up",
      description: "Stale",
      url: "https://tradeupbot.app/trade-ups/123",
      robots: "noindex, nofollow",
    });

    expect(html).toContain('content="noindex, nofollow"');
  });

  it("includes raw bodyHtml without escaping", () => {
    const html = buildSeoHtml({
      title: "Test",
      description: "Test desc",
      url: "https://tradeupbot.app/test",
      bodyHtml: '<h1>Test Skin</h1><table><tr><td><a href="/skins/ak-47">AK-47</a></td></tr></table>',
    });

    expect(html).toContain('<h1>Test Skin</h1>');
    expect(html).toContain('<a href="/skins/ak-47">AK-47</a>');
    expect(html).toContain("<main>");
  });

  it("prefers bodyHtml over bodyText when both provided", () => {
    const html = buildSeoHtml({
      title: "Test",
      description: "Test desc",
      url: "https://tradeupbot.app/test",
      bodyText: "plain text",
      bodyHtml: "<h1>rich html</h1>",
    });

    expect(html).toContain("<h1>rich html</h1>");
    expect(html).not.toContain("plain text");
  });

  it("handles jsonLd as array", () => {
    const html = buildSeoHtml({
      title: "Test",
      description: "Test desc",
      url: "https://tradeupbot.app/test",
      jsonLd: [
        { "@context": "https://schema.org", "@type": "BreadcrumbList" },
        { "@context": "https://schema.org", "@type": "Product", name: "AK-47" },
      ],
    });

    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"Product"');
    // Two separate script tags
    const matches = html.match(/application\/ld\+json/g);
    expect(matches).toHaveLength(2);
  });

  it("escapes HTML entities in title and description", () => {
    const html = buildSeoHtml({
      title: 'M4A4 "Howl" — $100 <script>alert(1)</script>',
      description: 'Prices from $5 to $10 with "quotes"',
      url: "https://tradeupbot.app/skins/test",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
