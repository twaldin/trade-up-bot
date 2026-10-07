/**
 * Chromium measurement of the landing hero. happy-dom does not apply the
 * media queries that place the compact card, so this uses the same browser
 * layer as the board hit-target test.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PreviewChrome } from "../../src/preview/PreviewChrome.js";
import { LandingHero } from "../../src/preview/pages/PreviewLanding.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const dir = dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(resolve(dir, "../../src/preview/kit/outlay/theme.css"), "utf8");
const preview = readFileSync(resolve(dir, "../../src/preview/preview.css"), "utf8")
  .replace('@import "./kit/outlay/theme.css";\n', "");
const css = `${theme}\n${preview}`;

function frame(props: { loading?: boolean; slow?: boolean; throttled?: boolean; failed?: boolean; tu?: ReturnType<typeof makeTradeUp> | null }) {
  const hero = createElement(LandingHero, {
    tu: props.tu === undefined ? makeTradeUp({ id: 7, created_at: "2026-10-07T04:00:00.000Z" }) : props.tu,
    loading: props.loading ?? false,
    isFree: true,
    slow: props.slow ?? false,
    failed: props.failed ?? false,
    throttled: props.throttled ?? false,
  });
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PreviewChrome, {
    mode: "dark",
    onMode: () => {},
    home: false,
    children: hero,
  })));
}

describe("landing hero at 390 and 1280", () => {
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

  async function open(width: number, height: number, html: string): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600 });
    await page.setContent(`<!doctype html><style>${css}</style>${html}`, { waitUntil: "domcontentloaded" });
    return page;
  }

  it("puts the H1, compact card, and both CTAs above the 844 fold at 390", async () => {
    const page = await open(390, 844, frame({}));
    const box = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        if (!(el instanceof HTMLElement)) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, width: r.width, height: r.height, display: getComputedStyle(el).display };
      };
      return {
        h1: rect(".preview-hero h1"),
        card: rect(".preview-hero__card"),
        primary: rect(".preview-hero .preview-btn--lime"),
        open: rect(".preview-hero__open"),
        proof: rect(".preview-proof"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(box.h1).not.toBeNull();
    expect(box.card?.display).not.toBe("none");
    expect(box.proof?.display).toBe("none");
    expect(box.h1!.bottom).toBeLessThanOrEqual(844);
    expect(box.card!.bottom).toBeLessThanOrEqual(844);
    expect(box.primary!.bottom).toBeLessThanOrEqual(844);
    expect(box.primary!.height).toBeGreaterThanOrEqual(44);
    expect(box.primary!.width).toBeGreaterThanOrEqual(44);
    expect(box.open!.height).toBeGreaterThanOrEqual(44);
    expect(box.open!.width).toBeGreaterThanOrEqual(44);
    expect(box.card!.top).toBeGreaterThan(box.h1!.top);
    expect(box.primary!.top).toBeGreaterThan(box.card!.top);
    expect(box.overflow).toBeLessThanOrEqual(1);
    await page.close();
  }, 20000);

  it("keeps the 1280 hero as the proof panel and hides the compact card", async () => {
    const page = await open(1280, 800, frame({}));
    const box = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        if (!(el instanceof HTMLElement)) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, width: r.width, height: r.height, display: getComputedStyle(el).display };
      };
      const h1 = rect(".preview-hero h1");
      const proof = rect(".preview-proof");
      const card = rect(".preview-hero__card");
      const open = document.querySelector(".preview-proof a.preview-btn");
      const openRect = open instanceof HTMLElement ? open.getBoundingClientRect() : null;
      return {
        h1,
        proof,
        card,
        openText: open?.textContent ?? "",
        openHeight: openRect?.height ?? 0,
      };
    });
    expect(box.card?.display).toBe("none");
    expect(box.proof?.display).not.toBe("none");
    expect(box.proof!.left).toBeGreaterThan(box.h1!.left + box.h1!.width - 1);
    expect(box.openText).toContain("Open this trade-up");
    expect(box.openHeight).toBeGreaterThan(0);
    expect(box.openHeight).toBeLessThan(44);
    await page.close();
  }, 20000);

  it.each([390, 1280])("shows a skeleton and no empty chart while loading at %ipx", async (width) => {
    const page = await open(width, 844, frame({ tu: null, loading: true }));
    const text = await page.evaluate(() => document.body.textContent ?? "");
    const skeleton = await page.evaluate(() => {
      const card = document.querySelector(".preview-hero__card-skeleton");
      const proof = document.querySelector(".preview-proof__skeleton");
      const visible = (el: Element | null) => el instanceof HTMLElement && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
      return { card: visible(card), proof: visible(proof) };
    });
    expect(text).not.toContain("No output skin to plot yet");
    expect(text).not.toContain("Loading the top trade-up on the board");
    expect(text).not.toContain("Loading trade-ups");
    if (width === 390) expect(skeleton.card).toBe(true);
    else expect(skeleton.proof).toBe(true);
    await page.close();
  }, 20000);

  it.each([390, 1280])("shows the throttle copy for a 429 at %ipx", async (width) => {
    const page = await open(width, 844, frame({ tu: null, loading: false, throttled: true }));
    const visible = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".preview-hero .preview-notice, .preview-hero [role='status']")];
      return nodes
        .filter((el) => el instanceof HTMLElement && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0)
        .map((el) => el.textContent ?? "")
        .join(" ");
    });
    expect(visible).toContain("Too many requests right now. Try again in a moment.");
    const retry = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".preview-hero__retry")];
      const el = nodes.find((node) => node instanceof HTMLElement && getComputedStyle(node).display !== "none" && node.getClientRects().length > 0);
      if (!(el instanceof HTMLElement)) return null;
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    if (!retry) throw new Error("Retry is not visible");
    expect(retry.height).toBeGreaterThanOrEqual(44);
    expect(retry.width).toBeGreaterThanOrEqual(44);
    await page.close();
  }, 20000);
});
