import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const landingPageSource = readFileSync(resolve(testDir, "../../src/pages/LandingPage.tsx"), "utf8");
const siteNavSource = readFileSync(resolve(testDir, "../../src/components/SiteNav.tsx"), "utf8");

describe("landing page link targets", () => {
  it("uses route links instead of hash anchors for nav and footer", () => {
    expect(landingPageSource).toContain('{ href: "/features", label: "Features" }');
    expect(landingPageSource).toContain('{ href: "/pricing", label: "Pricing" }');
    expect(landingPageSource).toContain('{ href: "/faq", label: "FAQ" }');
    expect(landingPageSource).toContain('{ href: "/blog", label: "Blog" }');
    expect(landingPageSource).not.toContain('href="#features"');
    expect(landingPageSource).not.toContain('href="#pricing"');
    expect(landingPageSource).not.toContain('href="#faq"');
    expect(landingPageSource).not.toContain('href="#blog"');
  });

  it("uses consistent discord invite and anchor CTA for trade-ups", () => {
    expect(landingPageSource).toContain('href="https://discord.gg/gQ8cPqBq2a"');
    expect(landingPageSource).not.toContain("discord.gg/tradeupbot");
    expect(landingPageSource).toContain('<a href="/trade-ups"');
    expect(landingPageSource).toContain("View Trade-Ups");
  });

  it("adds lazy loading and explicit dimensions to marketing screenshots", () => {
    expect(landingPageSource).toContain('src="/expanded.png" alt="Trade-up outcomes" loading="lazy" width="2596" height="1822"');
    expect(landingPageSource).toContain('src="/dataviewer.png" alt="Price data" loading="lazy" width="2434" height="1498"');
    expect(landingPageSource).toContain('src="/collections.png" alt="Collections" loading="lazy" width="2624" height="1608"');
  });
});

describe("site nav mobile menu", () => {
  it("includes a mobile navigation trigger button", () => {
    expect(siteNavSource).toContain('aria-label="Open navigation menu"');
    expect(siteNavSource).toContain("sm:hidden");
  });
});
