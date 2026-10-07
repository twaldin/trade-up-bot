/**
 * First-load CLS on the built client. APIs and webfonts are delayed so a
 * skeleton that collapses, or a grid that pops in, fails this before it ships.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";

declare global {
  interface Window {
    __clsShifts?: { value: number; startTime: number; hadRecentInput: boolean }[];
  }
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = resolve(repo, "dist");
const PREVIEW_PORT = 4187;
const API_DELAY_MS = 2_000;
const VIEWPORT = { width: 1280, height: 800 };

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAAHlpJ8xAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAfklEQVR4nO3OMQ0AAAgEoDe5f2h7h6Q0qAAAAAAAAAAAAAAAAG7w3QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwB8G8gABH3o0hQAAAABJRU5ErkJggg==",
  "base64",
);

const COLLECTIONS = [
  "The Phoenix Collection",
  "The Kilowatt Collection",
  "The Dreams & Nightmares Collection",
  "The Fracture Collection",
  "The Recoil Collection",
  "The Revolution Collection",
  "The Prisma Collection",
  "The Clutch Collection",
  "The Horizon Collection",
  "The Danger Zone Collection",
  "The Spectrum Collection",
  "The Glove Collection",
  "The Gamma Collection",
  "The Chroma Collection",
  "The Falchion Collection",
  "The Shadow Collection",
  "The Huntsman Collection",
  "The Breakout Collection",
  "The Vanguard Collection",
  "The Boreal Collection",
  "The Gallery Collection",
  "The Sport & Field Collection",
  "The Overpass Collection",
  "The Train Collection",
].map((name, index) => ({
  name,
  skin_count: 17,
  listing_count: 1000 + index * 37,
  covert_count: index % 4,
  has_knives: index % 2 === 0,
  has_gloves: index % 5 === 0,
}));

const RARITIES = ["Covert", "Classified", "Restricted", "Mil-Spec Grade", "Industrial Grade", "Consumer Grade"];

function skinsFor(collection: string) {
  return Array.from({ length: 18 }, (_, index) => ({
    id: `${collection}-${index}`,
    name: `AK-47 | Finish ${collection}-${index}`,
    rarity: RARITIES[index % RARITIES.length] ?? "Classified",
    weapon: "AK-47",
    collection_name: collection,
    listing_count: 12 + index,
    min_price: 150 + index * 20,
  }));
}

function tradeUp(id: number) {
  return makeTradeUp({
    id,
    collectionName: "The Phoenix Collection",
    listingIds: Array.from({ length: 10 }, (_, index) => `l-${id}-${index}`),
  });
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

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

async function startPreview(): Promise<{ child: ChildProcess; origin: string }> {
  if (!existsSync(resolve(dist, "index.html"))) {
    throw new Error("dist/index.html is missing. Run npm run build before the CLS check.");
  }
  const child = spawn(
    process.execPath,
    [resolve(repo, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: repo,
      env: { ...process.env, BROWSER: "none", NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const origin = await new Promise<string>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite preview did not start\n${logs}`)), 20_000);
    const onData = (chunk: Buffer) => {
      logs += chunk.toString();
      const match = stripAnsi(logs).match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolvePromise(match[1].replace(/\/$/, ""));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vite preview exited ${code ?? "null"}\n${logs}`));
    });
  });
  return { child, origin };
}

type Fixture = { auth?: "anon" | "pro"; status?: "ok" | "error" | "empty" };

async function fulfillApi(route: Route, origin: string, fixture: Fixture = {}): Promise<void> {
  const url = new URL(route.request().url());
  await new Promise((resolvePromise) => setTimeout(resolvePromise, API_DELAY_MS));
  if (url.pathname === "/face.png") {
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return;
  }
  const path = url.pathname;
  let status = 200;
  let body: unknown = {};
  const detail = path.startsWith("/api/skin-by-slug/") || /^\/api\/trade-ups\/\d+$/.test(path);
  if (path === "/api/auth/me") {
    if (fixture.auth === "pro") body = { steam_id: "765", tier: "pro", lifetime: false };
    else {
      status = 401;
      body = null;
    }
  } else if (fixture.status === "error") {
    status = 500;
    body = {};
  } else if (fixture.status === "empty") {
    if (detail) {
      status = 404;
      body = null;
    } else body = [];
  } else if (path === "/api/collections") body = COLLECTIONS;
  else if (path === "/api/skin-data") {
    const collection = url.searchParams.get("collection");
    body = collection ? skinsFor(collection) : skinsFor("The Phoenix Collection").slice(0, 100);
  } else if (path.startsWith("/api/skin-by-slug/")) body = { name: "AK-47 | Redline" };
  else if (path.startsWith("/api/skin-data/")) {
    const name = decodeURIComponent(path.slice("/api/skin-data/".length));
    body = {
      skin: {
        id: "skin-1",
        name,
        rarity: "Classified",
        weapon: "AK-47",
        min_float: 0.1,
        max_float: 0.7,
        collection_name: "The Phoenix Collection",
      },
      listings: [{ id: "listing-1", price_cents: 500, float_value: 0.2, source: "csfloat" }],
      saleHistory: [],
      priceSources: [{ source: "csfloat", condition: "Field-Tested", avg_price_cents: 700, volume: "4" }],
      stats: { totalListings: 1, minPrice: 500, maxPrice: 500, saleCount: 0 },
    };
  } else if (path === "/api/preview/faces") {
    const names = (url.searchParams.get("names") ?? "").split("||").filter(Boolean);
    body = Object.fromEntries(names.map((name) => [name, `${origin}/face.png`]));
  } else if (path === "/api/trade-ups") {
    body = {
      trade_ups: Array.from({ length: 6 }, (_, index) => tradeUp(index + 1)),
      tier: "free",
      total: 6,
      total_profitable: 6,
      signed_in: false,
    };
  } else if (path === "/api/board-delay") {
    body = { hidden_profitable: 12, best_hidden_profit_cents: 7600 };
  }
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function open(browser: Browser, origin: string, path: string, viewport = VIEWPORT, fixture: Fixture = {}): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    const shifts: { value: number; startTime: number; hadRecentInput: boolean }[] = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!("value" in entry) || !("hadRecentInput" in entry)) continue;
        const { value, hadRecentInput } = entry;
        if (typeof value !== "number" || typeof hadRecentInput !== "boolean") continue;
        shifts.push({ value, startTime: entry.startTime, hadRecentInput });
      }
    }).observe({ type: "layout-shift", buffered: true });
    window.__clsShifts = shifts;
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
    const api = url.pathname.startsWith("/api/") || url.pathname === "/face.png";
    if (!font && !api) {
      await route.continue();
      return;
    }
    if (font) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, API_DELAY_MS));
      await route.continue();
      return;
    }
    await fulfillApi(route, origin, fixture);
  });
  await page.goto(`${origin}${path}`, { waitUntil: "commit", timeout: 20_000 });
  return page;
}

async function readCls(page: Page): Promise<number> {
  const shifts = await page.evaluate(() => window.__clsShifts ?? []);
  return sessionCls(shifts);
}

describe("built client first-load CLS", () => {
  let browser: Browser;
  let preview: ChildProcess;
  let origin: string;

  beforeAll(async () => {
    const started = await startPreview();
    preview = started.child;
    origin = started.origin;
    browser = await chromium.launch({
      executablePath: puppeteer.executablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    if (preview && !preview.killed) preview.kill("SIGTERM");
  });

  it("keeps /collections under 0.05 at 1280 while APIs and fonts are delayed", async () => {
    const page = await open(browser, origin, "/collections");
    await page.locator("a.preview-collection").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(API_DELAY_MS * 3);
    expect(await page.locator(".preview-collection--skeleton").count()).toBe(0);
    expect(await page.locator(".preview-page--fold").count()).toBe(0);
    expect(await page.locator("h1").innerText()).toBe("Collections");
    expect(await readCls(page)).toBeLessThan(0.05);
    await page.close();
  }, 40_000);

  it("keeps a collection page under 0.05 at 1280 while APIs and fonts are delayed", async () => {
    const page = await open(browser, origin, "/collections/phoenix");
    await page.locator("a.preview-allskins__tile").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(API_DELAY_MS * 3);
    expect(await page.locator(".preview-page--fold").count()).toBe(0);
    expect(await page.locator("h1").innerText()).toBe("The Phoenix Collection");
    expect(await readCls(page)).toBeLessThan(0.05);
    await page.close();
  }, 40_000);

  it("keeps /pricing under 0.05 at 360, 390, and 1280 while the free-gap sentence is delayed", async () => {
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, VIEWPORT]) {
      const page = await open(browser, origin, "/pricing", viewport);
      await page.getByText("listing combos").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(API_DELAY_MS * 3);
      expect(await page.locator("h1").innerText()).toBe("TradeUpBot Pricing");
      expect(await readCls(page)).toBeLessThan(0.05);
      await page.close();
    }
  }, 70_000);

  it("keeps /pricing under 0.05 for a Pro session at 360, 375, 390, and 1280", async () => {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      VIEWPORT,
    ]) {
      const page = await open(browser, origin, "/pricing", viewport, { auth: "pro" });
      await page.getByRole("button", { name: "Current plan" }).waitFor({ timeout: 20_000 });
      await page.waitForTimeout(API_DELAY_MS * 2);
      expect(await page.getByText("listing combos").count()).toBe(0);
      expect(await page.locator("h1").innerText()).toBe("TradeUpBot Pricing");
      expect(await readCls(page)).toBeLessThan(0.05);
      await page.close();
    }
  }, 90_000);

  it("keeps empty and error pages under 0.05 at 390 and 1280", async () => {
    const widths = [{ width: 390, height: 844 }, VIEWPORT];
    const cases: { path: string; status: "error" | "empty"; text: string; note?: boolean; share?: boolean }[] = [
      { path: "/collections", status: "error", text: "No collection matches that search.", note: true },
      { path: "/collections", status: "empty", text: "No collection matches that search.", note: true },
      { path: "/collections/phoenix", status: "error", text: "Couldn't load this collection's skins." },
      { path: "/collections/phoenix", status: "empty", text: "That collection is not in the live dataset." },
      { path: "/skins", status: "error", text: "No skin matches that search." },
      { path: "/skins", status: "empty", text: "No skin matches that search." },
      { path: "/skins/missing-skin", status: "error", text: "That skin is not in the live dataset." },
      { path: "/skins/missing-skin", status: "empty", text: "That skin is not in the live dataset." },
      { path: "/trade-ups/123", status: "error", text: "Failed to load", share: true },
      { path: "/trade-ups/123", status: "empty", text: "Trade-up not found", share: true },
    ];
    for (const viewport of widths) {
      for (const item of cases) {
        const page = await open(browser, origin, item.path, viewport, { status: item.status });
        await page.getByText(item.text).first().waitFor({ timeout: 20_000 });
        await page.waitForTimeout(API_DELAY_MS * 2);
        expect(await page.locator("[class*='skeleton']").count(), `${item.path} ${item.status} ${viewport.width}`).toBe(0);
        expect(await page.locator("[aria-busy='true']").count(), `${item.path} ${item.status} ${viewport.width}`).toBe(0);
        if (item.note) {
          const label = `${item.path} ${item.status} ${viewport.width}`;
          expect(await page.getByText(item.text).count(), label).toBe(1);
          expect(await page.getByText(item.text).first().isVisible(), label).toBe(true);
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          expect(height, `${label} height ${height}`).toBeLessThanOrEqual(viewport.height * 2);
        }
        if (item.path === "/collections/phoenix" && item.status === "error") {
          expect(await page.locator("h1").innerText()).toBe("Couldn't load this collection's skins.");
        }
        if (item.share) {
          expect(await page.locator(".preview-share-verify").count()).toBe(0);
          expect(await page.getByRole("button", { name: "Copy link" }).count()).toBe(0);
          expect(await page.getByRole("link", { name: "Verify" }).count()).toBe(0);
        }
        expect(await readCls(page), `${item.path} ${item.status} ${viewport.width}`).toBeLessThan(0.05);
        await page.close();
      }
    }
  }, 240_000);
});
