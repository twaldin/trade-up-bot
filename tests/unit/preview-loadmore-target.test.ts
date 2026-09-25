/**
 * Chromium measurement of the real board's Load more control. happy-dom does
 * not apply min-height, and this is the same browser layer the board QA scripts use.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/preview/preview.css"), "utf8");
const rows = [makeTradeUp({ id: 1 })];

function boardMarkup(extra: { exhausted?: boolean; endKind?: "more" | "end" }) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PreviewBoard, {
    tradeUps: rows,
    loading: false,
    isFree: false,
    expandedId: null,
    onExpand: () => {},
    loadMore: () => {},
    ...extra,
  })));
}

describe("Load more hit target", () => {
  let browser: Browser;
  const loadMore = boardMarkup({});
  const ended = boardMarkup({ exhausted: true, endKind: "end" });

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each([390, 1280])("keeps Load more at least 44px tall and centered at %ipx", async (width) => {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800 });
    await page.setContent(`<!doctype html><style>${css}</style>${loadMore}`, { waitUntil: "domcontentloaded" });
    const box = await page.$eval(".preview-loadmore", (el) => {
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect();
      const sentinel = document.querySelector(".preview-sentinel")?.getBoundingClientRect().height ?? -1;
      return {
        className: el.className,
        height: rect.height,
        width: rect.width,
        leftGap: parent ? rect.left - parent.left : 0,
        rightGap: parent ? parent.right - rect.right : 0,
        sentinel,
      };
    });
    expect(box.className).toContain("preview-loadmore");
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.sentinel).toBeLessThan(1);
    if (width === 1280) {
      expect(box.width).toBeLessThan(200);
      expect(Math.abs(box.leftGap - box.rightGap)).toBeLessThan(2);
    }
    const observed = await page.evaluate(() => new Promise<boolean>((resolve) => {
      const node = document.querySelector(".preview-sentinel");
      if (!(node instanceof HTMLElement)) { resolve(false); return; }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(node);
      window.setTimeout(() => { observer.disconnect(); resolve(false); }, 500);
    }));
    expect(observed).toBe(true);
    await page.close();
  }, 20000);

  it("centers the end line", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent(`<!doctype html><style>${css}</style>${ended}`, { waitUntil: "domcontentloaded" });
    const box = await page.$eval(".preview-note--end", (el) => {
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect();
      return {
        width: rect.width,
        leftGap: parent ? rect.left - parent.left : 0,
        rightGap: parent ? parent.right - rect.right : 0,
      };
    });
    expect(box.width).toBeLessThan(1280);
    expect(Math.abs(box.leftGap - box.rightGap)).toBeLessThan(2);
    await page.close();
  }, 20000);
});
