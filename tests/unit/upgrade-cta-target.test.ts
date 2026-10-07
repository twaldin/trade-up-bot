/**
 * Chromium measurement of upgrade controls. happy-dom does not apply min-height.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/preview/preview.css"), "utf8");

const markup = `
  <a class="preview-delay__cta preview-upgrade" href="/pricing">See Pro</a>
  <a class="preview-btn preview-btn--quiet preview-upgrade" href="/pricing">View Plans</a>
  <a class="preview-upgrade" href="/pricing">See Pro</a>
  <a class="preview-btn preview-upgrade" href="/pricing">See Pro plans</a>
  <button type="button" class="preview-btn preview-btn--lime preview-btn--block preview-upgrade">Go Pro</button>
`;

describe("upgrade CTA hit target", () => {
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

  it("keeps each upgrade control at least 44px tall at 390px", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 800 });
    await page.setContent(`<!doctype html><style>${css}</style><div>${markup}</div>`, { waitUntil: "domcontentloaded" });
    const boxes = await page.$$eval(".preview-upgrade", (nodes) => nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return { text: el.textContent ?? "", height: rect.height, width: rect.width };
    }));
    expect(boxes.map((box) => box.text)).toEqual([
      "See Pro",
      "View Plans",
      "See Pro",
      "See Pro plans",
      "Go Pro",
    ]);
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await page.close();
  });
});
