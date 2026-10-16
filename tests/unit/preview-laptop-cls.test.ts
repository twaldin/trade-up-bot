/**
 * Homepage device slot. A live board is taller than the old 501px proof
 * reserve and used to push .preview-laptop (prod CLS 0.0184 at 1280).
 * Chromium applies the media queries; happy-dom does not.
 */
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";
import { proofReserveState, type HeroLoadPhase } from "../../src/preview/pages/PreviewLanding.js";
import { makeTradeUp } from "../helpers/fixtures.js";

declare global {
  interface Window {
    __previewClsShifts?: { value: number; startTime: number; hadRecentInput: boolean; preview: boolean }[];
  }
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BOARD_DELAY_MS = 1_500;
const HEADING = "TradeUpBot at a glance";
const VIEWPORTS = [
  { width: 390, height: 844, slot: ".preview-phone" },
  { width: 1280, height: 1200, slot: ".preview-laptop" },
] as const;
const SHORT_WIDTHS = [1280, 1920] as const;
type BoardCase = "live" | "empty" | "error" | "ratelimited";
const boardCase: { current: BoardCase } = { current: "live" };

const SOURCES = ["csfloat", "dmarket", "skinport", "buff"] as const;
const INPUT_NAMES = [
  "AK-47 | Redline",
  "AWP | Asiimov",
  "M4A1-S | Decimator",
  "USP-S | Cortex",
  "Glock-18 | Water Elemental",
  "Desert Eagle | Mecha Industries",
  "AK-47 | Neon Rider",
  "M4A4 | Desolate Space",
  "AWP | Neo-Noir",
  "Five-SeveN | Monkey Business",
];
const OUTCOME_NAMES = [
  "AK-47 | Fire Serpent",
  "AWP | Dragon Lore",
  "M4A4 | Howl",
  "AK-47 | Wild Lotus",
  "AWP | Gungnir",
  "M4A1-S | Welcome to the Jungle",
];

function liveTradeUp(id: number): TradeUp {
  const inputs: TradeUpInput[] = INPUT_NAMES.map((name, index) => ({
    listing_id: `live-${id}-${index}`,
    skin_id: `skin-${index}`,
    skin_name: name,
    collection_name: "The Phoenix Collection",
    price_cents: 1200 + index * 37,
    float_value: Number((0.15 + index * 0.01).toFixed(2)),
    condition: "Field-Tested",
    source: SOURCES[index % SOURCES.length] ?? "csfloat",
  }));
  const outcomes: TradeUpOutcome[] = OUTCOME_NAMES.map((name, index) => ({
    skin_id: `out-${index}`,
    skin_name: name,
    collection_name: "The Phoenix Collection",
    probability: index === 0 ? 0.4 : 0.12,
    predicted_float: 0.18,
    predicted_condition: "Field-Tested",
    estimated_price_cents: 8000 + index * 1500,
  }));
  const cost = inputs.reduce((sum, row) => sum + row.price_cents, 0);
  return makeTradeUp({
    id,
    type: "classified_covert",
    inputs,
    outcomes,
    total_cost_cents: cost,
    expected_value_cents: cost + 2400,
    profit_cents: 2400,
    roi_percentage: 18,
    created_at: "2026-10-15T12:00:00.000Z",
    listing_status: "active",
    is_theoretical: false,
    chance_to_profit: 0.62,
  });
}

const BOARD = {
  trade_ups: [liveTradeUp(11), liveTradeUp(12), liveTradeUp(13)],
  total: 18420,
  total_profitable: 2104,
  tier: "free",
  signed_in: false,
  page: 1,
  per_page: 3,
};

function sessionCls(entries: { value: number; startTime: number; hadRecentInput: boolean }[]): number {
  let max = 0;
  let session = 0;
  let first = 0;
  let last = 0;
  for (const entry of entries) {
    if (entry.hadRecentInput) continue;
    if (session && entry.startTime - last < 1000 && entry.startTime - first < 5000) session += entry.value;
    else {
      session = entry.value;
      first = entry.startTime;
    }
    last = entry.startTime;
    if (session > max) max = session;
  }
  return max;
}

function boundPort(address: string | AddressInfo | null): number {
  if (typeof address === "string") throw new Error("dev server bound a pipe");
  if (address === null) throw new Error("dev server did not bind a port");
  return address.port;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (err: Error) => {
      server.off("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
}

function closeHttp(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((err) => (err ? reject(err) : resolvePromise()));
  });
}

/**
 * Vite treats port 0 as unset and falls back to 5173. Bind the HTTP server
 * ourselves so the OS assigns the port, then read it from the address.
 */
async function startVite(): Promise<{ origin: string; close: () => Promise<void> }> {
  const vite: ViteDevServer = await createViteServer({
    root: repo,
    configFile: resolve(repo, "vite.config.ts"),
    appType: "spa",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  const http = createHttpServer((req, res) => {
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  try {
    await listen(http);
  } catch (err) {
    await vite.close();
    throw err;
  }
  const port = boundPort(http.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await closeHttp(http);
      await vite.close();
    },
  };
}

async function fulfill(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith("/api/")) {
    await route.continue();
    return;
  }
  let body: unknown = {};
  if (url.pathname === "/api/trade-ups") {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, BOARD_DELAY_MS));
    if (boardCase.current === "empty") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trade_ups: [], total: 0, total_profitable: 0, tier: "free", signed_in: false, page: 1, per_page: 3 }),
      });
      return;
    }
    if (boardCase.current === "error") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal server error" }) });
      return;
    }
    if (boardCase.current === "ratelimited") {
      await route.fulfill({
        status: 429,
        headers: { "retry-after": "120" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many requests" }),
      });
      return;
    }
    body = BOARD;
  } else if (url.pathname === "/api/global-stats") {
    body = {
      total_trade_ups: 762589,
      profitable_trade_ups: 109885,
      active_trade_ups: 629512,
      active_profitable_trade_ups: 24718,
      total_data_points: 4534582,
      total_cycles: 7718,
    };
  } else if (url.pathname === "/api/board-delay") {
    body = { hidden_profitable: 12345, best_hidden_profit_cents: 999999 };
  } else if (url.pathname === "/api/preview/faces") {
    body = { faces: {} };
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function open(browser: Browser, origin: string, width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    const shifts: { value: number; startTime: number; hadRecentInput: boolean; preview: boolean }[] = [];
    const inPreview = (node: Node | null) =>
      node instanceof Element && node.closest(".preview-laptop, .preview-phone") !== null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!("value" in entry) || !("hadRecentInput" in entry)) continue;
        const { value, hadRecentInput } = entry;
        if (typeof value !== "number" || typeof hadRecentInput !== "boolean") continue;
        let preview = false;
        const raw: unknown = "sources" in entry ? Reflect.get(entry, "sources") : null;
        if (Array.isArray(raw)) {
          for (const source of raw) {
            if (!source || typeof source !== "object" || !("node" in source)) continue;
            const node = source.node;
            if (inPreview(node instanceof Node ? node : null)) preview = true;
          }
        }
        shifts.push({ value, startTime: entry.startTime, hadRecentInput, preview });
      }
    }).observe({ type: "layout-shift", buffered: true });
    window.__previewClsShifts = shifts;
  });
  await page.route("**/*", fulfill);
  return page;
}

async function slotBox(page: Page, selector: string): Promise<{ y: number; height: number }> {
  return page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { y: rect.y, height: rect.height };
  });
}

const RESERVE: readonly HeroLoadPhase[] = ["skeleton", "slow", "ready", "empty", "error", "throttled"];

describe("desktop proof reserve follows the board answer", () => {
  it.each(RESERVE)("maps %s onto a proof data-state", (phase) => {
    const state = proofReserveState(phase);
    switch (phase) {
      case "skeleton":
      case "slow":
        expect(state).toBe("loading");
        break;
      case "ready":
        expect(state).toBe("live");
        break;
      case "empty":
        expect(state).toBe("empty");
        break;
      case "error":
        expect(state).toBe("error");
        break;
      case "throttled":
        expect(state).toBe("ratelimited");
        break;
      default: {
        const _exhaustive: never = phase;
        expect(_exhaustive).toBeUndefined();
      }
    }
  });
});

describe("homepage device preview does not shift when the live board arrives", () => {
  let browser: Browser;
  let stopVite: (() => Promise<void>) | undefined;
  let origin: string;

  beforeAll(async () => {
    const started = await startVite();
    stopVite = started.close;
    origin = started.origin;
    browser = await chromium.launch({
      executablePath: puppeteer.executablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 40_000);

  afterAll(async () => {
    await browser?.close();
    await stopVite?.();
  });

  it.each(VIEWPORTS)("keeps preview CLS under 0.005 at $width and renders the pricing heading", async ({ width, height, slot }) => {
    boardCase.current = "live";
    const page = await open(browser, origin, width, height);
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    await page.locator(slot).waitFor({ state: "attached" });
    const before = await slotBox(page, slot);
    await page.waitForResponse((res) => res.url().includes("/api/trade-ups") && res.status() === 200);
    await page.waitForTimeout(800);
    const after = await slotBox(page, slot);
    const shifts = await page.evaluate(() => window.__previewClsShifts ?? []);
    const previewCls = sessionCls(shifts.filter((entry) => entry.preview));
    expect(previewCls, `${width} preview CLS`).toBeLessThan(0.005);
    expect(Math.abs(after.y - before.y), `${width} slot top`).toBeLessThan(1);
    expect(Math.abs(after.height - before.height), `${width} slot height`).toBeLessThan(1);
    if (width >= 1080) expect(after.height).toBeGreaterThanOrEqual(788);

    await page.goto(`${origin}/pricing`, { waitUntil: "domcontentloaded" });
    await page.locator(".preview-shots h2").waitFor({ state: "attached" });
    expect(await page.locator(".preview-shots h2").innerText()).toBe(HEADING);
    expect(await page.locator("body").innerText()).not.toContain("Product screenshots");
    await page.close();
  }, 30_000);

  it.each(SHORT_WIDTHS.flatMap((width) => (["empty", "error", "ratelimited"] as const).map((kind) => ({ width, kind }))))(
    "hugs the $kind proof at $width and keeps preview CLS under 0.005",
    async ({ width, kind }) => {
      boardCase.current = kind;
      const page = await open(browser, origin, width, 1200);
      await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
      await page.locator(".preview-laptop").waitFor({ state: "attached" });
      await page.waitForResponse((res) => res.url().includes("/api/trade-ups"));
      await page.waitForTimeout(800);
      const fit = await page.locator(".preview-proof").evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const clone = el.cloneNode(true);
        if (!(clone instanceof HTMLElement) || !el.parentElement) return null;
        clone.style.minHeight = "0";
        clone.style.height = "auto";
        clone.style.flexGrow = "0";
        clone.style.position = "absolute";
        clone.style.left = "-10000px";
        clone.style.top = "0";
        clone.style.visibility = "hidden";
        clone.style.width = `${rect.width}px`;
        for (const node of clone.querySelectorAll("*")) {
          if (node instanceof HTMLElement) node.style.flexGrow = "0";
        }
        el.parentElement.appendChild(clone);
        const content = clone.getBoundingClientRect().height;
        clone.remove();
        return { height: rect.height, content, state: el.getAttribute("data-state") };
      });
      const shifts = await page.evaluate(() => window.__previewClsShifts ?? []);
      const previewCls = sessionCls(shifts.filter((entry) => entry.preview));
      expect(fit, `${width} ${kind} proof`).not.toBeNull();
      expect(fit!.state).toBe(kind);
      expect(fit!.height, `${width} ${kind} proof height`).toBeLessThanOrEqual(fit!.content + 24);
      expect(previewCls, `${width} ${kind} preview CLS`).toBeLessThan(0.005);
      await page.close();
    },
    30_000,
  );
});
