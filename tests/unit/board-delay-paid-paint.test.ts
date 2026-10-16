/**
 * Paying viewers must not see the free-tier banner when auth is slower than
 * the list. Chromium loads the real board; happy-dom cannot measure CLS.
 *
 * Auth (5s) and the list (200ms or 1.5s) are mocked. The page clock is paused
 * and advanced, so those delays are virtual time and the file finishes in
 * seconds instead of waiting them out on the wall clock.
 */
import { type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import { startViteOnFreePort } from "../helpers/vite-dev-server.js";

const PAID_PAINT_OUT = process.env.PAID_PAINT_OUT || tmpdir();
const WIDTHS = [360, 375, 390, 1280] as const;
const TRADE_UP = makeTradeUp({ id: 7 });
const EPOCH = new Date("2024-06-01T12:00:00.000Z");
const EPOCH_MS = EPOCH.getTime();
/** Long enough for React to commit the first effect and arm the auth timer. */
const BOOT_MS = 100;
const AUTH_DELAY_MS = 5_000;
const FRAME_MS = 32;

type Tier = "pro" | "lifetime";

interface Cell {
  tier: Tier;
  listMs: number;
  width: number;
  cardAt: number | null;
  cls: number;
  visibleBanner: boolean;
}

function authBody(tier: Tier) {
  if (tier === "lifetime") return { steam_id: "765", tier: "pro", lifetime: true };
  return { steam_id: "765", tier: "pro", lifetime: false };
}

function cardLimit(_listMs: number): number {
  // Virtual time still has to paint the card before the old 6.5s watch, and
  // before a card that only appears once the 5s auth returns.
  return 6500;
}

class ResponseGate {
  private at = 0;
  private waiters: Array<() => void> = [];

  reached(ms: number): Promise<void> {
    if (this.at >= ms) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.at >= ms) resolve();
        else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  seek(ms: number): void {
    this.at = ms;
    const pending = this.waiters.splice(0);
    for (const wake of pending) wake();
  }
}

async function installCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.documentElement.dataset.cls = "0";
    const isShift = (entry: PerformanceEntry): entry is PerformanceEntry & { value: number; hadRecentInput: boolean } =>
      "value" in entry && "hadRecentInput" in entry;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!isShift(entry) || entry.hadRecentInput || typeof entry.value !== "number") continue;
        const prev = Number(document.documentElement.dataset.cls ?? "0");
        document.documentElement.dataset.cls = String(prev + entry.value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function fulfill(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function mockBoard(page: Page, origin: string, gate: ResponseGate, listAt: number, authAt: number, tier: Tier): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    let path = "";
    try { path = new URL(url).pathname; } catch { path = ""; }
    if (path === "/api/auth/me") {
      await gate.reached(authAt);
      await fulfill(route, authBody(tier));
      return;
    }
    if (path === "/api/trade-ups") {
      await gate.reached(listAt);
      await fulfill(route, {
        trade_ups: [TRADE_UP],
        total: 1,
        tier,
        signed_in: true,
      });
      return;
    }
    if (path.startsWith("/api/")) {
      await fulfill(route, path === "/api/preview/faces" ? { faces: {} } : {});
      return;
    }
    if (url.startsWith(origin)) {
      await route.continue().catch(() => {});
      return;
    }
    await route.abort().catch(() => {});
  });
}

interface Snap {
  card: boolean;
  banner: boolean;
  cls: number;
  now: number;
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => ({
    card: document.querySelector(".preview-card:not(.preview-card--skeleton)") != null,
    banner: document.querySelector(".preview-delay:not(.preview-delay--hold)") != null,
    cls: Number(document.documentElement.dataset.cls ?? "0"),
    now: Date.now(),
  }));
}

async function runTo(page: Page, gate: ResponseGate, cursor: { ms: number }, target: number): Promise<void> {
  const delta = target - cursor.ms;
  if (delta > 0) await page.clock.runFor(delta);
  cursor.ms = target;
  gate.seek(target);
}

async function measure(browser: Browser, origin: string, width: number, listMs: number, tier: Tier): Promise<Omit<Cell, "tier" | "listMs" | "width">> {
  const listAt = BOOT_MS + listMs;
  const authAt = BOOT_MS + AUTH_DELAY_MS;
  const gate = new ResponseGate();
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await installCls(page);
  await page.clock.install({ time: EPOCH });
  await page.clock.pauseAt(EPOCH);
  await mockBoard(page, origin, gate, listAt, authAt, tier);
  const cursor = { ms: 0 };
  let cardAt: number | null = null;
  let visibleBanner = false;
  let cls = 0;
  try {
    await page.goto(`${origin}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await runTo(page, gate, cursor, BOOT_MS);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.evaluate(() => { document.documentElement.dataset.cls = "0"; });
    await runTo(page, gate, cursor, listAt);
    for (let frame = 0; frame < 8 && cardAt == null; frame++) {
      await runTo(page, gate, cursor, cursor.ms + FRAME_MS);
      const shot = await snap(page);
      if (shot.banner) visibleBanner = true;
      cls = shot.cls;
      if (shot.card) cardAt = shot.now - EPOCH_MS - BOOT_MS;
    }
    if (cursor.ms < authAt) await runTo(page, gate, cursor, authAt);
    for (let frame = 0; frame < 4; frame++) {
      await runTo(page, gate, cursor, cursor.ms + FRAME_MS);
      const shot = await snap(page);
      if (shot.banner) visibleBanner = true;
      cls = shot.cls;
      if (shot.card && cardAt == null) cardAt = shot.now - EPOCH_MS - BOOT_MS;
    }
    if (width === 390) {
      await page.screenshot({ path: resolve(PAID_PAINT_OUT, `paid-${tier}-${listMs}-390.png`) });
    }
    return { cardAt, cls, visibleBanner };
  } finally {
    gate.seek(1_000_000);
    await context.close();
  }
}

describe("paid lists do not grow the free banner", () => {
  let browser: Browser;
  let vite: ChildProcess;
  let origin = "";
  const cells: Cell[] = [];

  beforeAll(async () => {
    mkdirSync(PAID_PAINT_OUT, { recursive: true });
    const started = await startViteOnFreePort({ cwd: resolve("."), env: { API_PROXY: "" } });
    vite = started.child;
    origin = started.origin;
    browser = await chromium.launch({
      executablePath: puppeteer.executablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const warm = await browser.newPage();
    await warm.route("**/*", async (route) => {
      const url = route.request().url();
      let path = "";
      try { path = new URL(url).pathname; } catch { path = ""; }
      if (path === "/api/auth/me") {
        await fulfill(route, authBody("pro"));
        return;
      }
      if (path === "/api/trade-ups") {
        await fulfill(route, { trade_ups: [TRADE_UP], total: 1, tier: "pro", signed_in: true });
        return;
      }
      if (path.startsWith("/api/")) {
        await fulfill(route, {});
        return;
      }
      if (url.startsWith(origin)) {
        await route.continue().catch(() => {});
        return;
      }
      await route.abort().catch(() => {});
    });
    await warm.setViewportSize({ width: 390, height: 900 });
    await warm.goto(`${origin}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await warm.waitForSelector(".preview-card:not(.preview-card--skeleton)", { timeout: 20_000 });
    await warm.close();
  }, 40_000);

  afterAll(async () => {
    await browser?.close();
    if (vite && vite.exitCode == null && vite.pid) vite.kill("SIGTERM");
    if (cells.length > 0) {
      writeFileSync(resolve(PAID_PAINT_OUT, "paid-paint.json"), JSON.stringify(cells, null, 2));
    }
  });

  it("hides the free banner for pro and lifetime at 360, 375, 390, and 1280", async () => {
    for (const tier of ["pro", "lifetime"] as const) {
      for (const listMs of [200, 1500]) {
        const row = await Promise.all(WIDTHS.map(async (width) => {
          const measured = await measure(browser, origin, width, listMs, tier);
          return { tier, listMs, width, ...measured };
        }));
        cells.push(...row);
      }
    }

    for (const cell of cells) {
      const label = `${cell.tier} list ${cell.listMs}ms @ ${cell.width} card ${cell.cardAt}ms cls ${cell.cls}`;
      expect(cell.visibleBanner, label).toBe(false);
      expect(cell.cls, label).toBeLessThan(0.05);
      expect(cell.cardAt, label).not.toBeNull();
      expect(cell.cardAt ?? 99999, label).toBeLessThan(cardLimit(cell.listMs));
    }
  }, 90_000);
});
