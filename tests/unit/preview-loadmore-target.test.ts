/**
 * Chromium measurement of the Load more hit target. happy-dom does not apply
 * min-height, and this is the same browser layer the board QA scripts use.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/preview/preview.css"), "utf8");

describe("Load more hit target", () => {
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

  it.each([390, 1280])("is at least 44px tall at %ipx", async (width) => {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800 });
    await page.setContent(`<!doctype html><style>${css}</style><button class="preview-btn preview-btn--quiet preview-loadmore" type="button">Load more</button>`, { waitUntil: "domcontentloaded" });
    const height = await page.$eval(".preview-loadmore", (el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
    await page.close();
  }, 20000);
});
