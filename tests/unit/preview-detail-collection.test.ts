/**
 * Detail-page collection links. The href is the same slug the collection
 * route resolves, and the tap target is at least 44px at 390.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DetailCollectionLinks } from "../../src/preview/components/DetailCollectionLinks.js";

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(dir, "../../src/preview/preview.css"), "utf8");
const share = readFileSync(resolve(dir, "../../src/preview/pages/PreviewShare.tsx"), "utf8");
const links = readFileSync(resolve(dir, "../../src/preview/components/DetailCollectionLinks.tsx"), "utf8");

const names = ["The Dreams & Nightmares Collection", "The Fracture Collection", "The Recoil Collection"];

function markup(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DetailCollectionLinks, { names })));
}

describe("detail collection links", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  it("links the first two collections at the canonical board slug", () => {
    const html = markup();
    expect(html).toContain('href="/trade-ups/collection/dreams-nightmares"');
    expect(html).toContain("Dreams &amp; Nightmares Collection Trade-Ups");
    expect(html).toContain('href="/trade-ups/collection/fracture"');
    expect(html).not.toContain("the-dreams-nightmares-collection");
    expect(html).not.toContain("recoil");
    expect(share).toContain("<DetailCollectionLinks");
    expect(links).toContain('trackCtaClick("detail_collection")');
  });

  it("is at least 44px in both axes at 390 and does not overflow", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    await page.setContent(`<!doctype html><style>${css}</style><div data-preview>${markup()}</div>`, { waitUntil: "domcontentloaded" });
    const boxes = await page.$$eval(".preview-detail-collections a", (nodes) => nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return { height: rect.height, width: rect.width, href: el.getAttribute("href") };
    }));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.close();
  });

  it("keeps the links inside the 1280 column", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent(`<!doctype html><style>${css}</style><div data-preview>${markup()}</div>`, { waitUntil: "domcontentloaded" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.close();
  });
});
