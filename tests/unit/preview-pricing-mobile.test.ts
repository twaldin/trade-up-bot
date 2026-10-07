/**
 * R3: /pricing at 390 leads with Pro, billing tabs are a 44px target, and the
 * Pro intro no longer claims analytics that Free already includes.
 * Prices, limits, plan ids, and the checkout POST stay the existing strings.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrencyProvider } from "../../src/contexts/CurrencyContext.js";
import { PreviewChrome } from "../../src/preview/PreviewChrome.js";
import { PLAN_FOR, PRO_FEATURES, PRO_PRICE, proPriceLine } from "../../src/preview/lib/pro-pricing.js";
import { PreviewPricing } from "../../src/preview/pages/PreviewPricing.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const pricing = read("src/preview/pages/PreviewPricing.tsx");
const css = read("src/preview/preview.css");
const checkout = read("src/preview/lib/checkout.ts");

const BANNED = /\b(chance|odds|win|jackpot|gamble|bet|lucky|rolls?|bankroll|risk-free)\b/i;

function previewSources(): string[] {
  const dir = join(root, "src/preview");
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const abs = join(current, name);
      if (name.endsWith(".tsx") || name.endsWith(".ts") || name.endsWith(".css")) out.push(abs);
      else if (!name.includes(".")) walk(abs);
    }
  };
  walk(dir);
  return out;
}

function pricingMarkup(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/pricing"] },
      createElement(CurrencyProvider, null,
        createElement(PreviewChrome, { mode: "dark", onMode: () => {}, children: createElement(PreviewPricing) }),
      ),
    ),
  );
}

const sheet = `${read("src/preview/kit/outlay/theme.css")}\n${css.replace('@import "./kit/outlay/theme.css";', "")}`;

describe("price and limit strings stay byte-identical", () => {
  it("pins every displayed price, limit, and checkout plan id", () => {
    expect(PRO_PRICE).toEqual({
      monthly: { amount: "$6.99", unit: "/mo" },
      yearly: { amount: "$5", unit: "/mo", note: "billed $59.99/year" },
      lifetime: { amount: "$74.99", unit: " one-time" },
    });
    expect(proPriceLine("monthly")).toBe("$6.99/mo");
    expect(proPriceLine("yearly")).toBe("$5/mo · billed $59.99/year");
    expect(proPriceLine("lifetime")).toBe("$74.99 one-time");
    expect(PRO_FEATURES).toEqual([
      "Real-time data (no delay)",
      "Claim system (30 min lock)",
      "Up to 5 active claims",
      "Verify availability (20/hr)",
      "Claims (10/hr)",
    ]);
    expect(PLAN_FOR).toEqual({ monthly: "pro", yearly: "pro-yearly", lifetime: "pro-lifetime" });
    expect(pricing).toContain('{ feature: "Verify availability", free: false, pro: "20/hr" }');
    expect(pricing).toContain('{ feature: "Claim system", free: false, pro: "10/hr" }');
    expect(pricing).toContain('{ feature: "Active claims", free: false, pro: "Up to 5" }');
    expect(pricing).toContain("3-hour data delay");
    expect(pricing).toContain("PRO_PRICE.monthly.amount");
    expect(pricing).toContain("PRO_FEATURES.map");
    expect(checkout).toContain('"/api/subscribe"');
    expect(checkout).toContain("JSON.stringify({ plan");
  });
});

describe("pricing presentation", () => {
  it("replaces the analytics claim and marks the delay with a clock", () => {
    expect(pricing).toContain("Real-time data, Verify, and Claim.");
    expect(pricing).toContain('className="preview-plan__delay"');
    expect(pricing).toContain("preview-plan__clock");
    for (const file of previewSources()) {
      expect(readFileSync(file, "utf8"), file).not.toContain("full analytics");
    }
  });

  it("reorders Pro and grows only the billing tabs under 600px", () => {
    expect(css).toContain(`@media (max-width: 599px) {
  .preview-plans > .preview-plan--pro { order: -1; }
  .preview-tabs--billing .o-tab {
    height: auto;
    min-height: 44px;
  }
}`);
    expect(pricing).toContain('className="preview-tabs preview-tabs--billing"');
  });
});

describe("pricing layout in Chromium", () => {
  let browser: Browser;
  let html: string;

  beforeAll(async () => {
    html = pricingMarkup();
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  async function open(width: number, height: number, mobile: boolean): Promise<Page> {
    const page = await browser.newPage();
    // isMobile widens the layout viewport in this Chromium, so touch + a phone
    // UA stand in for the 390×844 mobile pass without leaving the CSS width.
    await page.setViewport({ width, height, hasTouch: mobile, deviceScaleFactor: 1 });
    if (mobile) {
      await page.setUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      );
    }
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0}${sheet}</style></head><body>${html}</body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    return page;
  }

  async function measure(page: Page) {
    return page.evaluate(() => {
      const box = (el: Element | null) => {
        const rect = el?.getBoundingClientRect();
        return rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null;
      };
      const pro = document.querySelector(".preview-plan--pro");
      const free = document.querySelector(".preview-plan:not(.preview-plan--pro)");
      const go = document.querySelector(".preview-plan--pro .preview-btn--lime");
      const tabs = [...document.querySelectorAll('[aria-label="Billing interval"] [role="tab"]')].map((el) => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent ?? "", width: rect.width, height: rect.height, top: rect.top };
      });
      const delay = document.querySelector(".preview-plan__delay");
      const visible = document.body.innerText;
      return {
        pro: box(pro),
        free: box(free),
        go: box(go),
        goText: go?.textContent ?? "",
        tabs,
        lede: document.querySelector(".preview-plan--pro .preview-note")?.textContent ?? "",
        delayText: delay?.textContent ?? "",
        delayClock: delay?.querySelector(".preview-plan__clock") != null,
        delayCheck: delay?.querySelector("polyline") != null,
        prices: {
          monthly: document.querySelector(".preview-plan--pro .preview-plan__price")?.textContent ?? "",
          limits: [...document.querySelectorAll(".preview-plan--pro .preview-plan__list li")].map((li) => li.textContent ?? ""),
        },
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        narrow: window.matchMedia("(max-width: 599px)").matches,
        touch: navigator.maxTouchPoints,
        visible,
      };
    });
  }

  it("puts Pro above the fold with 44px billing tabs at 390", async () => {
    const page = await open(390, 844, true);
    const box = await measure(page);
    expect(box.innerWidth).toBe(390);
    expect(box.narrow).toBe(true);
    expect(box.touch).toBeGreaterThan(0);
    expect(box.pro).not.toBeNull();
    expect(box.free).not.toBeNull();
    expect(box.go).not.toBeNull();
    expect(box.pro!.top).toBeLessThan(box.free!.top);
    expect(box.go!.top).toBeLessThan(844);
    expect(box.tabs.map((tab) => tab.text)).toEqual(["Monthly", "Yearly · save 28%", "Lifetime · best value"]);
    for (const tab of box.tabs) {
      expect(tab.height).toBeGreaterThanOrEqual(44);
      expect(tab.width).toBeGreaterThanOrEqual(44);
    }
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.lede).toBe("Real-time data, Verify, and Claim.");
    expect(box.delayText).toContain("3-hour data delay");
    expect(box.delayClock).toBe(true);
    expect(box.delayCheck).toBe(false);
    expect(box.prices.monthly).toContain("$6.99");
    expect(box.prices.monthly).toContain("/mo");
    expect(box.prices.limits.join("\n")).toContain("20/hr");
    expect(box.prices.limits.join("\n")).toContain("10/hr");
    expect(box.prices.limits.join("\n")).toContain("Up to 5");
    expect(box.prices.limits.join("\n")).toContain("30 min");
    expect(box.visible).not.toMatch(BANNED);
    await page.close();
  }, 20000);

  it("keeps Go Pro inside the phone viewport with billing tabs on one row", async () => {
    for (const [width, height] of [[375, 812], [390, 844]] as const) {
      const page = await open(width, height, true);
      const box = await measure(page);
      expect(box.innerWidth).toBe(width);
      expect(box.go).not.toBeNull();
      expect(box.go!.top + box.go!.height).toBeLessThanOrEqual(height);
      expect(new Set(box.tabs.map((tab) => Math.round(tab.top))).size).toBe(1);
      await page.close();
    }
  }, 20000);

  it("keeps the two-column order and 28px tabs at 1280", async () => {
    const page = await open(1280, 800, false);
    const box = await measure(page);
    expect(box.free!.left).toBeLessThan(box.pro!.left);
    expect(Math.abs(box.free!.top - box.pro!.top)).toBeLessThan(2);
    expect(box.tabs.length).toBe(3);
    for (const tab of box.tabs) {
      expect(tab.height).toBeLessThan(44);
      expect(tab.height).toBeGreaterThan(20);
    }
    expect(box.lede).toBe("Real-time data, Verify, and Claim.");
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.visible).not.toMatch(BANNED);
    await page.close();
  }, 20000);
});
