/**
 * Pre-Oct-13 board and profit figures must not render as if they were current.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DemoAnimation } from "../../src/components/DemoAnimation.js";
import { DemoAnimationMobile } from "../../src/components/DemoAnimationMobile.js";
import { blogPosts } from "../../src/data/blog-posts.js";
import { BlogPage } from "../../src/pages/BlogPage.js";
import { BlogPostPage } from "../../src/pages/BlogPostPage.js";
import { FaqPage } from "../../src/pages/FaqPage.js";
import { LandingPage } from "../../src/pages/LandingPage.js";
import { buildBlogPostSeo } from "../../server/blog-routes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const STALE = ["592,938", "$2,778", "4,631.58"];

const NEW_TITLE = "Why CS2 Trade-Up Calculators Overstate Profit: A Real-Listings Test";

function markup(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function postPage(slug: string): string {
  return markup(
    createElement(MemoryRouter, { initialEntries: [`/blog/${slug}/`] },
      createElement(Routes, null,
        createElement(Route, { path: "/blog/:slug/", element: createElement(BlogPostPage) }),
      ),
    ),
  );
}

function renderedCopy(): string {
  const theory = blogPosts.find((post) => post.slug === "profitable-trade-ups-theory-vs-reality");
  if (!theory) throw new Error("missing theory post");
  const seo = buildBlogPostSeo(theory);
  const pages = [
    markup(createElement(DemoAnimation)),
    markup(createElement(DemoAnimationMobile)),
    markup(createElement(MemoryRouter, null, createElement(BlogPage))),
    markup(createElement(MemoryRouter, null, createElement(LandingPage, { user: null }))),
    markup(createElement(MemoryRouter, null, createElement(FaqPage))),
    postPage("profitable-trade-ups-theory-vs-reality"),
    postPage("cs2-output-float-profit-impact"),
    postPage("cs2-trade-up-probability-expected-value"),
    postPage("cs2-trade-up-marketplace-fees"),
    seo.title,
    seo.description,
    seo.bodyHtml,
    JSON.stringify(seo.jsonLd),
    readFileSync(join(root, "src/components/DemoAnimation.tsx"), "utf8"),
    readFileSync(join(root, "src/components/DemoAnimationMobile.tsx"), "utf8"),
  ];
  return pages.join("\n");
}

describe("stale board figures", () => {
  const html = renderedCopy();

  it("drops 592,938, $2,778, and 4,631.58 from rendered output", () => {
    for (const figure of STALE) {
      expect(html, figure).not.toContain(figure);
    }
  });

  it("labels the landing demo as an illustrative example", () => {
    expect(markup(createElement(DemoAnimation))).toContain("Illustrative example, not live data");
    expect(markup(createElement(DemoAnimationMobile))).toContain("Illustrative example, not live data");
  });

  it("keeps sample stat lines the same width as the old ones", () => {
    expect("500,000 found (25,000 profitable)".length).toBe("592,938 found (28,493 profitable)".length);
    expect("5,000 found (2,500 profitable)".length).toBe("8,421 found (2,847 profitable)".length);
    expect(html).toContain("500,000 found");
    expect(html).toContain("25,000 profitable");
    expect(html).toContain("5,000 found");
    expect(html).toContain("2,500 profitable");
  });

  it("keeps the demo boxes the same size", () => {
    const desktop = markup(createElement(DemoAnimation));
    const mobile = markup(createElement(DemoAnimationMobile));
    expect(desktop).toContain("height:580");
    expect(mobile).toContain("width:390");
    expect(mobile).toContain("height:700");
  });

  it("retitles the listings test without changing the slug", () => {
    const post = blogPosts.find((entry) => entry.slug === "profitable-trade-ups-theory-vs-reality");
    expect(post?.slug).toBe("profitable-trade-ups-theory-vs-reality");
    expect(post?.title).toBe(NEW_TITLE);
    const page = postPage("profitable-trade-ups-theory-vs-reality");
    expect(page).toContain(NEW_TITLE);
    expect(page).toContain(`property="og:title" content="${NEW_TITLE} | TradeUpBot"`);
    expect(page).toContain(`"headline":"${NEW_TITLE}"`);
    expect(markup(createElement(MemoryRouter, null, createElement(BlogPage)))).toContain(NEW_TITLE);
    expect(markup(createElement(MemoryRouter, null, createElement(LandingPage, { user: null })))).toContain(NEW_TITLE);
    const seo = buildBlogPostSeo(post!);
    expect(seo.title).toBe(`${NEW_TITLE} | TradeUpBot`);
    expect(JSON.stringify(seo.jsonLd)).toContain(NEW_TITLE);
    expect(seo.bodyHtml).not.toContain("$2,778");
    expect(seo.bodyHtml).not.toContain("$99");
  });

  it("keeps the Green Line ratio and drops the dollar columns", () => {
    const page = postPage("cs2-output-float-profit-impact");
    expect(page).toContain("Glock-18 | Green Line");
    expect(page).toContain("13.4x");
    expect(page).toContain("FN ÷ MW");
    expect(page).toContain("0.069");
    expect(page).toContain("0.071");
    expect(page).not.toContain("$21.18");
    expect(page).not.toContain("$40.50");
    expect(page).not.toContain("$237.23");
  });

  it("labels the EV explainer and rewrites the unsourced fee claims", () => {
    const ev = postPage("cs2-trade-up-probability-expected-value");
    expect(ev.indexOf("The numbers below are illustrative examples.")).toBeGreaterThan(-1);
    expect(ev.indexOf("The numbers below are illustrative examples.")).toBeLessThan(ev.indexOf("Expected Value: The Formula"));
    const fees = postPage("cs2-trade-up-marketplace-fees");
    expect(fees).not.toContain("5-15% ROI");
    expect(fees).not.toContain("in your pocket");
    expect(fees).toContain("Margins on gun-skin trade-ups are often thin before fees.");
    expect(fees).toContain("The figure shown is EV after fees on inputs and output.");
  });

  it("names the share of outcomes above cost on the FAQ page", () => {
    const faq = markup(createElement(MemoryRouter, null, createElement(FaqPage)));
    expect(faq).toContain("share of outcomes above cost");
    expect(faq).not.toContain("chance to profit");
    expect(readFileSync(join(root, "src/pages/FaqPage.tsx"), "utf8")).not.toContain("chance to profit");
  });
});
