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
    const phone: Record<number, { held: number; filled: number }> = {};
    for (const width of [360, 375]) {
      const held = await delayBox(page, width, boardDocument(hold), null);
      const filled = await delayBox(page, width, boardDocument(banner), HIDDEN_COUNT_SENTENCE);
      phone[width] = { held: held.height, filled: filled.height };
    }
    await page.close();
    expect(narrowHold.height).toBe(144);
    expect(narrowFilled.height).toBe(narrowHold.height);
    expect(wideHold.height).toBe(54);
    expect(wideFilled.height).toBe(wideHold.height);
    expect(phone[360]?.held).toBe(126);
    expect(phone[375]?.held).toBe(126);
    for (const [width, box] of Object.entries(phone)) {
      expect(box.filled, `${width} filled ${box.filled} hold ${box.held}`).toBe(box.held);
    }
  }, 45000);

  it("matches the reserved height at 359, 360, 375, and 389", async () => {
    const page = await browser.newPage();
    const expected: Record<number, number> = { 359: 180, 360: 126, 375: 126, 389: 126, 390: 144, 1280: 54 };
    for (const [width, height] of Object.entries(expected)) {
      const held = await delayBox(page, Number(width), boardDocument(hold), null);
      const filled = await delayBox(page, Number(width), boardDocument(banner), HIDDEN_COUNT_SENTENCE);
      expect(held.height, width).toBe(height);
      expect(filled.height, width).toBe(held.height);
    }
    await page.close();
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
    // No stored tier: the reserve is a row of the skeleton grid, not an overlay.
    expect(unknown).toContain("preview-delay--hold");
    expect(unknown).not.toContain("preview-delay--cover");
    expect(unknown).toContain("preview-card--skeleton");
    expect(unknown).toContain("Common questions");
    expect(free).toContain("preview-delay--hold");
    expect(free).toContain("preview-card--skeleton");
    expect(hold).toContain("preview-delay--hold");
    expect(hold).toContain("preview-card--skeleton");
    expect(hold).toContain("Common questions");
    expect(hold).toContain('aria-hidden="true"');
    expect(banner).toContain("Free tier");
    expect(banner).not.toContain("preview-delay--hold");
    expect(banner).not.toContain("preview-delay--cover");
  });

  it("keeps the banner off the first card at 360, 375, 390, and 1280", async () => {
    const page = await browser.newPage();
    for (const width of [360, 375, 390, 1280]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      for (const html of [banner, hold]) {
        await page.setContent(boardDocument(html), { waitUntil: "domcontentloaded" });
        const hit = await page.evaluate(() => {
          const bannerEl = document.querySelector(".preview-delay");
          const card = document.querySelector(".preview-card");
          if (!(bannerEl instanceof HTMLElement) || !(card instanceof HTMLElement)) {
            return { ok: false, reason: "missing" };
          }
          const a = bannerEl.getBoundingClientRect();
          const b = card.getBoundingClientRect();
          const overlap = a.bottom > b.top + 0.5 && a.top < b.bottom && a.right > b.left && a.left < b.right;
          const probe = document.elementFromPoint(b.left + 8, b.top + 8);
          const onBanner = probe instanceof Element && probe.closest(".preview-delay") != null;
          const positioned = getComputedStyle(bannerEl).position;
          return {
            ok: !overlap && !onBanner && positioned !== "absolute" && a.height > 40 && b.top >= a.bottom - 0.5,
            overlap,
            onBanner,
            positioned,
            bannerTop: a.top,
            bannerBottom: a.bottom,
            cardTop: b.top,
          };
        });
        expect(hit.ok, `${width} ${JSON.stringify(hit)}`).toBe(true);
      }
    }
    await page.close();
  }, 30000);
});
