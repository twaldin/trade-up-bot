import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_CTA_NOTE,
  PREVIEW_PLAN_FREE,
  PREVIEW_PLAN_PRO,
  PREVIEW_PRO_PRICES,
} from "../../src/preview/lib/copy.js";
import { HOMEPAGE_SEO } from "../../server/static-seo-pages.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const landing = read("../../src/preview/pages/PreviewLanding.tsx");
const chrome = read("../../src/preview/PreviewChrome.tsx");
const pricing = read("../../src/preview/pages/PreviewPricing.tsx");
const css = read("../../src/preview/preview.css");

function cssBlock(source: string, header: string): string {
  const at = source.indexOf(header);
  if (at < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  return "";
}

describe("landing copy speaks to traders, not design review", () => {
  it("drops the internal review notes that shipped as section ledes", () => {
    for (const note of [
      "KPI row",
      "graph language",
      "not a screenshot",
      "Lime stays profit",
      "Faces take the rarity tint",
      "Nothing invented",
      "the console opens",
      "the skin page draws",
      "Collapsed cards from the first page",
    ]) {
      expect(landing, note).not.toContain(note);
    }
  });
});

describe("hero says the free path out loud", () => {
  it("puts a no-account note inside the hero CTA row", () => {
    expect(PREVIEW_CTA_NOTE).toMatch(/no account/i);
    const heroStart = landing.indexOf('className="preview-hero"');
    const toolbarStart = landing.indexOf("preview-toolbar", heroStart);
    const toolbarEnd = landing.indexOf("</div>", toolbarStart);
    expect(heroStart).toBeGreaterThan(-1);
    expect(landing.slice(toolbarStart, toolbarEnd)).toContain("PREVIEW_CTA_NOTE");
  });

  it("gives crawlers the same free-path note", () => {
    expect(HOMEPAGE_SEO.bodyHtml).toContain(PREVIEW_CTA_NOTE);
  });
});

function heroSection(): string {
  const at = landing.indexOf('<section className="preview-hero');
  return landing.slice(at, landing.indexOf("</section>", at));
}

function heroProofComponent(): string {
  const at = landing.indexOf("function HeroProof(");
  return landing.slice(at, landing.indexOf("\n}\n", at));
}

describe("first screen carries its own proof", () => {
  it("splits the hero into copy and a live proof panel", () => {
    const hero = heroSection();
    expect(hero).toContain("preview-hero__copy");
    expect(hero).toContain("<HeroProof");
    expect(hero.indexOf("preview-hero__copy")).toBeLessThan(hero.indexOf("<HeroProof"));
  });

  it("keeps one lede in the hero copy and moves the listing claim onto the panel it describes", () => {
    expect(heroSection()).not.toContain("preview-hero__sub");
    expect(heroProofComponent()).toContain("PREVIEW_SUBLEDE");
  });

  it("builds the panel from a real, buyable board row", () => {
    const proof = heroProofComponent();
    expect(landing).toContain("pickHeroTradeUp(live.tradeUps)");
    expect(proof).toContain("heroProof(");
    expect(proof).toContain("preview-listings--story");
    expect(proof).toContain("inputListingHref(row)");
    expect(proof).toContain("formatFloat(row.float_value)");
    expect(proof).toContain("formatDollars(row.price_cents)");
  });

  it("gives every output its price and odds, and states each headline number once", () => {
    const proof = heroProofComponent();
    expect(proof).toContain("formatDollars(row.priceCents)");
    expect(proof).toMatch(/Math\.round\(row\.probability \* 100\)/);
    for (const label of ["Cost", "Expected value", "Expected profit", "Chance of profit"]) {
      expect(proof.split(`label="${label}"`).length - 1, label).toBe(1);
    }
  });

  it("links the panel to the trade-up and names the free delay with a way out", () => {
    const proof = heroProofComponent();
    expect(proof).toContain("to={`/trade-ups/${proof.id}`}");
    expect(proof).toMatch(/isFree\s*&&/);
    const bannerAt = proof.indexOf("{DELAY_BANNER}");
    expect(bannerAt).toBeGreaterThan(-1);
    expect(proof.slice(bannerAt, bannerAt + 400)).toContain('to="/pricing"');
  });

  it("holds the panel's shape while the board loads instead of jumping", () => {
    expect(heroProofComponent()).toContain("preview-proof__skeleton");
  });
});

describe("the rest of the page stops repeating the hero", () => {
  it("never renders the hero trade-up again below the fold", () => {
    expect(landing).toMatch(/live\.tradeUps\.filter\(\(tu\) => tu\.id !== hero\?\.id\)/);
  });

  it("drops the duplicate listings strip from the value band", () => {
    const at = landing.indexOf("PREVIEW_VALUE_HEADLINE}");
    const band = landing.slice(at, landing.indexOf("</section>", at));
    expect(band).not.toContain("preview-listings");
  });

  it("spends lime on at most two buttons: the hero CTA and the Pro plan", () => {
    expect(landing.split("preview-btn--lime").length - 1).toBeLessThanOrEqual(2);
  });

  it("sets the site counts as a slim line, not a wall of tiles", () => {
    const stats = cssBlock(css, ".preview-hero .preview-stats {");
    expect(stats).toMatch(/display:\s*flex/);
    expect(stats).not.toMatch(/background:\s*var\(--panel-rule\)/);
  });
});

describe("live proof ends in an action", () => {
  it("links the featured card to its own page and to the board", () => {
    expect(landing).toContain("to={`/trade-ups/${featured.id}`}");
    const liveAt = landing.indexOf("preview-live");
    const peekAt = landing.indexOf("preview-peek");
    expect(landing.slice(liveAt, peekAt)).toContain("PREVIEW_CTA_PRIMARY");
    expect(landing.slice(peekAt)).toMatch(/to="\/trade-ups"/);
  });

  it("says the free view is delayed once, on the hero panel", () => {
    expect(landing.split("{DELAY_BANNER}").length - 1).toBe(1);
    expect(landing).toContain("isFree={live.isFree}");
  });
});

describe("pricing teaser shows Pro value before the paywall", () => {
  it("lists real plan features and every Pro price point", () => {
    expect(landing).toContain("PREVIEW_PLAN_FREE");
    expect(landing).toContain("PREVIEW_PLAN_PRO");
    expect(landing).toContain("PREVIEW_PRO_PRICES");
    expect(PREVIEW_PLAN_FREE.length).toBeGreaterThanOrEqual(3);
    expect(PREVIEW_PLAN_PRO.length).toBeGreaterThanOrEqual(3);
    for (const price of ["$59.99", "$74.99"]) {
      expect(PREVIEW_PRO_PRICES).toContain(price);
      expect(pricing).toContain(price);
    }
  });

  it("only quotes Pro limits the pricing page already promises", () => {
    const pro = PREVIEW_PLAN_PRO.join(" ");
    expect(pro).toContain("20/hr");
    expect(pro).toContain("30 min");
    expect(pro).toMatch(/up to 5/i);
    expect(pricing).toContain('pro: "20/hr"');
    expect(pricing).toContain('pro: "Up to 5"');
    expect(pricing).toContain("30 min lock");
  });

  it("offers a no-login free action next to the Pro action", () => {
    const at = landing.indexOf('id="pricing"');
    const section = landing.slice(at, landing.indexOf("</section>", at));
    expect(section).toContain('to="/trade-ups"');
    expect(section).toContain('to="/pricing"');
  });

  it("mirrors the plan lists in crawler HTML", () => {
    for (const item of [...PREVIEW_PLAN_FREE, ...PREVIEW_PLAN_PRO]) {
      expect(HOMEPAGE_SEO.bodyHtml).toContain(item);
    }
    expect(HOMEPAGE_SEO.bodyHtml).toContain("$74.99");
  });
});

describe("pricing page Free plan does not wall browsing behind Steam", () => {
  it("sends the Free button to the board instead of the Steam login", () => {
    expect(pricing).not.toMatch(/onClick=\{login\}>Get started/);
    const freeAt = pricing.indexOf('<p className="o-kicker">Free</p>');
    const proAt = pricing.indexOf("preview-plan--pro");
    expect(pricing.slice(freeAt, proAt)).toContain('to="/trade-ups"');
  });
});

describe("marketing header at phone widths", () => {
  it("splits the CTA from the view prefs so it can own the first row", () => {
    expect(chrome).toContain("preview-nav__cta");
    expect(chrome).toContain("preview-nav__prefs");
  });

  it("never wraps the header CTA onto several lines", () => {
    expect(cssBlock(css, ".preview-nav__cta {")).toMatch(/white-space:\s*nowrap/);
  });

  it("wraps into a second row that keeps Features / Pricing / FAQ / Blog tappable", () => {
    expect(cssBlock(css, ".preview-nav {")).toMatch(/min-height:\s*56px/);
    expect(cssBlock(css, ".preview-nav {")).not.toMatch(/(?<!min-)height:\s*56px/);
    const narrow = cssBlock(css, "@media (max-width: 799px)");
    expect(narrow).toMatch(/\.preview-nav\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(narrow).toMatch(/\.preview-nav__links\s*\{[^}]*display:\s*flex/);
  });
});
