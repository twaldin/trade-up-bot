import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isMarketingPage, pageFor, type ConsolePage } from "../../src/preview/lib/console-routes.js";
import {
  PREVIEW_CTA_DISCORD,
  PREVIEW_CTA_PRIMARY,
  PREVIEW_DISCORD_HREF,
  PREVIEW_GITHUB_HREF,
  PREVIEW_HEADLINE,
} from "../../src/preview/lib/copy.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const app = read("../../src/preview/PreviewApp.tsx");
const chrome = read("../../src/preview/PreviewChrome.tsx");
const shell = read("../../src/preview/PreviewShell.tsx");
const css = read("../../src/preview/preview.css");
const landing = read("../../src/preview/pages/PreviewLanding.tsx");
const pricing = read("../../src/preview/pages/PreviewPricing.tsx");
const features = read("../../src/preview/pages/PreviewFeatures.tsx");
const faq = read("../../src/preview/pages/PreviewFaq.tsx");
const blog = read("../../src/preview/pages/PreviewBlog.tsx");
const legal = read("../../src/preview/pages/PreviewLegal.tsx");
const homepageSeo = read("../../server/static-seo-pages.ts");

describe("390 console strip keeps every product dest tappable", () => {
  it("wraps console dests onto their own rows so Light / USD cannot cover them", () => {
    expect(shell).toContain('aria-label="Console pages"');
    expect(shell).toContain("preview-console__mobile");
    expect(shell).toContain("preview-bar__actions");
    expect(css).toMatch(/\.preview-console__bar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.preview-console__bar\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.preview-console__mobile\s*\{[^}]*display:\s*contents/);
    expect(css).not.toMatch(/\.preview-console__bar\s*\{[^}]*(?<!min-)height:\s*44px/);
    expect(css).not.toMatch(/\.preview-bar__actions\s*\{[^}]*position:\s*absolute/);
  });
});

describe("product and legal leave the console sidebar", () => {
  it("keeps only console destinations in the sidebar", () => {
    expect(shell).toContain('to: "/trade-ups"');
    expect(shell).toContain('to: "/skins"');
    expect(shell).toContain('to: "/collections"');
    expect(shell).toContain('to: "/calculator"');
    expect(shell).toContain('to: "/listing-sniper"');
    expect(shell).toContain('to: "/my-trade-ups"');
    expect(shell).toContain("My trade-ups");
    expect(shell).not.toContain('to: "/pricing"');
    expect(shell).not.toContain('to: "/features"');
    expect(shell).not.toContain('to: "/faq"');
    expect(shell).not.toContain('to: "/blog"');
    expect(shell).not.toContain('to: "/terms"');
    expect(shell).not.toContain('to: "/privacy"');
    expect(shell).not.toContain(">Product<");
    expect(shell).not.toContain(">Legal<");
    expect(shell).not.toContain("preview-footer");
  });

  it("routes marketing pages through landing chrome, not PreviewShell", () => {
    expect(app).toContain("PreviewChrome");
    expect(app).toContain("isMarketingPage");
    expect(app).toContain("PreviewShell");
    for (const page of ["pricing", "faq", "features", "blog", "post", "terms", "privacy", "landing"] as const satisfies readonly ConsolePage[]) {
      expect(isMarketingPage(pageFor(page, "/"))).toBe(true);
    }
    for (const page of ["board", "skins", "skin", "collections", "collection", "calculator", "account", "sniper", "share"] as const satisfies readonly ConsolePage[]) {
      expect(isMarketingPage(pageFor(page, "/"))).toBe(false);
    }
  });
});

describe("landing chrome carries product nav and a real footer", () => {
  it("puts Pricing, Features, FAQ, and Blog in the landing top-nav", () => {
    expect(chrome).toContain('to="/pricing"');
    expect(chrome).toContain('to="/features"');
    expect(chrome).toContain('to="/faq"');
    expect(chrome).toContain('to="/blog"');
    expect(chrome).toContain("Pricing");
    expect(chrome).toContain("Features");
    expect(chrome).toContain("FAQ");
    expect(chrome).toContain("Blog");
    expect(chrome).not.toContain("SiteNav");
  });

  it("puts GitHub, Discord, Terms, and Privacy in the landing footer", () => {
    expect(chrome).toContain("preview-footer");
    expect(chrome).toContain("PREVIEW_GITHUB_HREF");
    expect(chrome).toContain("PREVIEW_DISCORD_HREF");
    expect(chrome).toContain('to="/terms"');
    expect(chrome).toContain('to="/privacy"');
    expect(chrome).toContain("Terms");
    expect(chrome).toContain("Privacy");
    expect(chrome).toContain("not affiliated with Valve");
  });
});

describe("home CTAs and locked headline", () => {
  it("uses the two signed hero CTAs and keeps the locked h1", () => {
    expect(PREVIEW_HEADLINE).toBe("CS2 trade-ups built from real, buyable listings");
    expect(PREVIEW_CTA_PRIMARY).toBe("Find Real Tradeups ->");
    expect(PREVIEW_CTA_DISCORD).toBe("Join the Discord");
    expect(PREVIEW_DISCORD_HREF).toBe("https://discord.gg/w4jFs8g5kU");
    expect(PREVIEW_GITHUB_HREF).toBe("https://github.com/twaldin/trade-up-bot");
    expect(landing).toContain("PREVIEW_CTA_PRIMARY");
    expect(landing).toContain("PREVIEW_CTA_DISCORD");
    expect(landing).toContain("PREVIEW_DISCORD_HREF");
    expect(landing).toContain("to=\"/trade-ups\"");
    expect(landing).not.toContain("Open the console");
    expect(landing).not.toContain("How it works</a>");
    expect(landing.match(/<h1/g)).toHaveLength(1);
  });

  it("keeps first-HTML How / FAQ / blog depth and updates the crawler CTAs", () => {
    expect(homepageSeo).toContain("How it works");
    expect(homepageSeo).toContain("Find Real Tradeups");
    expect(homepageSeo).toContain("Join the Discord");
    expect(homepageSeo).toContain("https://discord.gg/w4jFs8g5kU");
    expect(homepageSeo).toContain('href="/faq"');
    expect(homepageSeo).toContain('href="/blog"');
    expect(homepageSeo).not.toContain("Open the console");
  });
});

describe("marketing pages keep unique SEO and landing chrome, not console cards as the shell", () => {
  it("wraps leftover pages in landing market chrome", () => {
    for (const [name, source] of [
      ["pricing", pricing],
      ["features", features],
      ["faq", faq],
      ["blog", blog],
      ["legal", legal],
    ] as const) {
      expect(source, name).toContain("preview-market");
      expect(source, name).not.toContain("SiteNav");
      expect(source, name).not.toContain("SiteFooter");
      expect(source, name).not.toMatch(/noindex/);
    }
    expect(pricing).toContain("$0");
    expect(pricing).toContain("$6.99");
    expect(pricing).toContain("$59.99");
    expect(pricing).toContain("$74.99");
    expect(pricing).toContain("/api/subscribe");
    expect(features).toContain("TradeUpBot Features");
    expect(faq).toContain("CS2 Trade-Up FAQ");
    expect(blog).toContain("CS2 Trade-Up Guides & Analysis");
    expect(legal).toContain("Terms of Service");
    expect(legal).toContain("Privacy Policy");
  });
});
