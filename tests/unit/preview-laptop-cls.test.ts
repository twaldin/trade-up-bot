/**
 * Homepage device slot. A live board is taller than the old 501px proof
 * reserve and used to push .preview-laptop (prod CLS 0.0184 at 1280).
 * Chromium applies the media queries; happy-dom does not.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";
import { makeTradeUp } from "../helpers/fixtures.js";

declare global {
  interface Window {
    __previewClsShifts?: { value: number; startTime: number; hadRecentInput: boolean; preview: boolean }[];
  }
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 5204;
const BOARD_DELAY_MS = 1_500;
const HEADING = "What Pro shows you";
const VIEWPORTS = [
  { width: 390, height: 844, slot: ".preview-phone" },
  { width: 1280, height: 1200, slot: ".preview-laptop" },
] as const;

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

async function startVite(): Promise<{ child: ChildProcess; origin: string }> {
  const child = spawn(
    process.execPath,
    [resolve(repo, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    {
      cwd: repo,
      env: { ...process.env, API_PROXY: "", BROWSER: "none", NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const origin = await new Promise<string>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start\n${logs.slice(-500)}`)), 30_000);
    const poke = () => {
      if (child.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error(`vite exited ${child.exitCode}\n${logs.slice(-500)}`));
        return;
      }
      fetch(`http://127.0.0.1:${PORT}`).then((res) => {
        if (res.status < 500) {
          clearTimeout(timer);
          resolvePromise(`http://127.0.0.1:${PORT}`);
        } else setTimeout(poke, 200);
      }).catch(() => setTimeout(poke, 200));
    };
    child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    setTimeout(poke, 200);
  });
  return { child, origin };
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

describe("homepage device preview does not shift when the live board arrives", () => {
  let browser: Browser;
  let vite: ChildProcess;
  let origin: string;

  beforeAll(async () => {
    const started = await startVite();
    vite = started.child;
    origin = started.origin;
    browser = await chromium.launch({
      executablePath: puppeteer.executablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 40_000);

  afterAll(async () => {
    await browser?.close();
    if (vite && vite.exitCode === null && vite.pid) vite.kill("SIGTERM");
  });

  it.each(VIEWPORTS)("keeps preview CLS under 0.005 at $width and renders the pricing heading", async ({ width, height, slot }) => {
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
});
