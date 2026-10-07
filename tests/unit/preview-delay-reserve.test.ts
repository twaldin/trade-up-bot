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

const ZERO_SENTENCE = boardDelaySentence({
  hidden_profitable: 0,
  best_hidden_profit_cents: null,
});

const HIDDEN_COUNT_SENTENCE = `${DELAY_BANNER} ${boardDelaySentence({
  hidden_profitable: 12,
  best_hidden_profit_cents: 7600,
}) ?? ""}`;

function boardHtml(props: {
  loading: boolean;
  isFree: boolean;
  rows: ReturnType<typeof makeTradeUp>[];
  user?: { tier?: string; lifetime?: boolean } | null;
}) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PreviewBoard, {
    tradeUps: props.rows,
    loading: props.loading,
    isFree: props.isFree,
    expandedId: null,
    onExpand: () => {},
    user: props.user,
  })));
}

function boardDocument(html: string) {
  return `<!doctype html><style>${css}</style>
    <style>
      html, body { margin: 0; overflow: hidden; }
      .preview-console, .preview-console__main { height: auto !important; overflow: visible !important; }
    </style>
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
    await page.$eval(".preview-delay p", (node, text) => {
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
  const hold = boardHtml({ loading: true, isFree: false, rows: [], user: null });
  const banner = boardHtml({ loading: false, isFree: true, rows: [makeTradeUp({ id: 1 })], user: null });
  const full = `${DELAY_BANNER} ${ZERO_SENTENCE ?? ""}`;

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
    const heights: Record<number, { held: number; quiet: number; filled: number; heldW: number; quietW: number; filledW: number }> = {};
    for (const width of [320, 390, 768, 1280]) {
      const held = await delayBox(page, width, boardDocument(hold), null);
      const quiet = await delayBox(page, width, boardDocument(banner), null);
      const filled = await delayBox(page, width, boardDocument(banner), full);
      heights[width] = {
        held: held.height,
        quiet: quiet.height,
        filled: filled.height,
        heldW: held.width,
        quietW: quiet.width,
        filledW: filled.width,
      };
    }
    await page.close();
    for (const [width, box] of Object.entries(heights)) {
      const label = `${width} hold ${box.heldW}x${box.held} quiet ${box.quietW}x${box.quiet} filled ${box.filledW}x${box.filled}`;
      expect(box.held, label).toBeGreaterThan(40);
      if (width === "320") expect(box.held, label).toBeLessThan(180);
      expect(box.quietW, label).toBe(box.heldW);
      expect(box.filledW, label).toBe(box.heldW);
      expect(box.quiet, label).toBe(box.held);
      expect(box.filled, label).toBe(box.held);
    }
  }, 60000);

  it("reserves 144px at 390 for the hidden-count sentence", async () => {
    const page = await browser.newPage();
    const narrowHold = await delayBox(page, 390, boardDocument(hold), null);
    const narrowFilled = await delayBox(page, 390, boardDocument(banner), HIDDEN_COUNT_SENTENCE);
    const wideHold = await delayBox(page, 1280, boardDocument(hold), null);
    const wideFilled = await delayBox(page, 1280, boardDocument(banner), HIDDEN_COUNT_SENTENCE);
    await page.close();
    expect(narrowHold.height).toBe(144);
    expect(narrowFilled.height).toBe(narrowHold.height);
    expect(wideFilled.height).toBe(wideHold.height);
    expect(wideHold.height).toBeLessThan(144);
  }, 30000);

  it("reserves the slot for a guest and skips it for a paid account", () => {
    const paid = boardHtml({ loading: false, isFree: false, rows: [makeTradeUp({ id: 1 })], user: { tier: "pro" } });
    const loadingPaid = ["pro", "basic", "admin"].map((tier) => boardHtml({
      loading: true,
      isFree: false,
      rows: [],
      user: { tier },
    }));
    const lifetime = boardHtml({
      loading: true,
      isFree: false,
      rows: [],
      user: { tier: "free", lifetime: true },
    });
    const unknown = boardHtml({ loading: true, isFree: false, rows: [] });
    const free = boardHtml({ loading: true, isFree: false, rows: [], user: { tier: "free" } });
    expect(paid).not.toContain("preview-delay");
    for (const html of loadingPaid) {
      expect(html).not.toContain("preview-delay");
      expect(html).toContain("preview-card--skeleton");
    }
    expect(lifetime).not.toContain("preview-delay");
    expect(unknown).not.toContain("preview-delay");
    expect(free).toContain("preview-delay--hold");
    expect(hold).toContain("preview-delay--hold");
    expect(hold).toContain('aria-hidden="true"');
    expect(banner).toContain("Free tier");
    expect(banner).not.toContain("preview-delay--hold");
  });
});
