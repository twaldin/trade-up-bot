/**
 * Chromium measurement of the free-tier banner slot. happy-dom does not apply
 * min-height, and the reserved box has to match the sentence that arrives later.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boardDelaySentence } from "../../shared/board-delay.js";
import { DELAY_BANNER } from "../../src/preview/lib/copy.js";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const dir = dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(resolve(dir, "../../src/preview/kit/outlay/theme.css"), "utf8");
const preview = readFileSync(resolve(dir, "../../src/preview/preview.css"), "utf8")
  .replace('@import "./kit/outlay/theme.css";\n', "");
const css = `${theme}\n${preview}`;

const LONG_SENTENCE = boardDelaySentence({
  hidden_profitable: 999_999,
  best_hidden_profit_cents: 99_999_999,
});

function boardHtml(props: { loading: boolean; isFree: boolean; rows: ReturnType<typeof makeTradeUp>[] }) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PreviewBoard, {
    tradeUps: props.rows,
    loading: props.loading,
    isFree: props.isFree,
    expandedId: null,
    onExpand: () => {},
  })));
}

function boardDocument(html: string) {
  return `<!doctype html><style>${css}</style>
    <style>.preview-console { height: auto; overflow: visible; }</style>
    <div data-preview data-system="outlay" data-mode="light" data-view="dashboard" class="preview-console-root">
      <div class="preview-console">
        <aside class="preview-sidebar"></aside>
        <div class="preview-console__col">
          <div class="preview-console__main">${html}</div>
        </div>
      </div>
    </div>`;
}

async function delayBox(page: Page, width: number, html: string, sentence: string | null): Promise<{ height: number; width: number }> {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const faceLoaded = await page.evaluate(async () => {
    const face = "500 12px \"Schibsted Grotesk\"";
    await document.fonts.load(face);
    await document.fonts.ready;
    return document.fonts.check(face);
  });
  if (!faceLoaded) throw new Error("Schibsted Grotesk did not load");
  if (sentence) {
    await page.$eval(".preview-delay__copy > span:not(.preview-delay__reserve)", (node, text) => {
      node.textContent = text;
    }, sentence);
  }
  return page.$eval(".preview-delay", (node) => {
    const rect = node.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
}

describe("free-tier banner reserves its height", () => {
  let browser: Browser;
  const hold = boardHtml({ loading: true, isFree: false, rows: [] });
  const banner = boardHtml({ loading: false, isFree: true, rows: [makeTradeUp({ id: 1 })] });
  const full = `${DELAY_BANNER} ${LONG_SENTENCE ?? ""}`;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  it("keeps the slot the same height after the sentence arrives", async () => {
    const page = await browser.newPage();
    const heights: Record<number, { held: number; quiet: number; filled: number; width: number }> = {};
    for (const width of [320, 390, 768, 1280]) {
      const held = await delayBox(page, width, boardDocument(hold), null);
      const quiet = await delayBox(page, width, boardDocument(banner), null);
      const filled = await delayBox(page, width, boardDocument(banner), full);
      heights[width] = { held: held.height, quiet: quiet.height, filled: filled.height, width: filled.width };
    }
    await page.close();
    for (const [width, box] of Object.entries(heights)) {
      expect(box.held, `${width} wide ${box.width}`).toBeGreaterThan(40);
      expect(box.quiet, `${width} wide ${box.width}`).toBe(box.held);
      expect(box.filled, `${width} wide ${box.width}`).toBe(box.held);
    }
  }, 60000);

  it("drops the slot once a paid list has loaded", () => {
    const paid = boardHtml({ loading: false, isFree: false, rows: [makeTradeUp({ id: 1 })] });
    expect(paid).not.toContain("preview-delay");
    expect(hold).toContain("preview-delay--hold");
    expect(hold).toContain('aria-hidden="true"');
    expect(banner).toContain("Free tier");
    expect(banner).not.toContain("preview-delay--hold");
  });
});
