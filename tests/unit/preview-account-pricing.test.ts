/**
 * Pricing and the legal line on /my-trade-ups.
 *
 * Free and basic reveal them once auth and the first claims list settle,
 * without waiting on stats. Pro and lifetime (tier free + lifetime) also
 * wait for the first stats response. After that reveal, a tab switch does
 * not hide them again.
 */
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import puppeteer from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";

const STATS = {
  all_time_profit_cents: 18420,
  total_executed: 6,
  total_sold: 4,
  win_count: 3,
  win_rate: 75,
  avg_roi: 12.4,
};

describe("account pricing reveal", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = "";

  beforeAll(async () => {
    server = await createServer({
      server: { host: "127.0.0.1", port: 5223, strictPort: false },
      logLevel: "error",
    });
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 5223;
    base = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({
      executablePath: puppeteer.executablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function installCls(page: Page) {
    await page.addInitScript(() => {
      const shifts: number[] = [];
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const hadRecentInput = Reflect.get(entry, "hadRecentInput");
          const value = Reflect.get(entry, "value");
          if (hadRecentInput === false && typeof value === "number") shifts.push(value);
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
      Object.assign(window, {
        __accountCls: () => shifts.reduce((sum, value) => sum + value, 0),
      });
    });
  }

  async function readCls(page: Page): Promise<number> {
    return page.evaluate(() => {
      const reader = Reflect.get(window, "__accountCls");
      if (typeof reader !== "function") return 0;
      const value: unknown = reader();
      return typeof value === "number" ? value : 0;
    });
  }

  async function pricingBox(page: Page) {
    return page.evaluate(() => {
      const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing");
      const legal = document.querySelector(".preview-console__legal");
      const style = pricing ? getComputedStyle(pricing) : null;
      const legalStyle = legal ? getComputedStyle(legal) : null;
      const rect = pricing?.getBoundingClientRect();
      const visible = !!pricing
        && style?.display !== "none"
        && style?.visibility !== "hidden"
        && pricing.getClientRects().length > 0;
      return {
        visible,
        legalVisible: !!legal && legalStyle?.display !== "none" && legal.getClientRects().length > 0,
        top: visible && rect ? rect.top : null,
        pending: document.querySelector(".preview-account--pending") !== null,
      };
    });
  }

  async function fulfill(route: Route, status: number, body: unknown, wait = 0) {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  }

  it("shows Pricing for free within 0.6s of auth when stats take 5s", async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      let authAt = 0;
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname + url.search;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        if (path.startsWith("/api/auth/me")) {
          await fulfill(route, 200, {
            steam_id: "2",
            display_name: "Bea",
            avatar_url: "",
            tier: "free",
            lifetime: false,
            is_admin: false,
          }, 150);
          authAt = Date.now();
          return;
        }
        if (path.includes("/stats")) {
          await fulfill(route, 403, { error: "nope" }, 5000);
          return;
        }
        await fulfill(route, 200, path.includes("my_claims") ? { trade_ups: [] } : {});
      });
      await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => {
        const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing");
        if (!pricing) return false;
        const style = getComputedStyle(pricing);
        return style.display !== "none" && pricing.getClientRects().length > 0;
      }, undefined, { timeout: 2_000 });
      const elapsed = Date.now() - authAt;
      expect(elapsed, `time-to-Pricing ${elapsed}ms`).toBeLessThan(600);
      expect(elapsed).toBeGreaterThan(0);
      const box = await pricingBox(page);
      expect(box.visible).toBe(true);
      expect(box.legalVisible).toBe(true);
      expect(box.pending).toBe(false);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("does not re-hide Pricing or the legal line on a tab switch", async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname + url.search;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        if (path.startsWith("/api/auth/me")) {
          await fulfill(route, 200, {
            steam_id: "2",
            display_name: "Bea",
            avatar_url: "",
            tier: "free",
            lifetime: false,
            is_admin: false,
          });
          return;
        }
        if (path.includes("status=purchased")) {
          await fulfill(route, 200, { trade_ups: [] }, 1500);
          return;
        }
        if (path.includes("/stats")) {
          await fulfill(route, 403, { error: "nope" });
          return;
        }
        await fulfill(route, 200, path.includes("my_claims") ? { trade_ups: [] } : {});
      });
      await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => {
        const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing");
        return !!pricing && getComputedStyle(pricing).display !== "none" && pricing.getClientRects().length > 0;
      }, undefined, { timeout: 8_000 });
      await page.evaluate(() => {
        let hid = false;
        const note = () => {
          const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing");
          const legal = document.querySelector(".preview-console__legal");
          const pricingStyle = pricing ? getComputedStyle(pricing) : null;
          const legalStyle = legal ? getComputedStyle(legal) : null;
          const pricingHidden = !pricing || pricingStyle?.display === "none" || pricing.getClientRects().length === 0;
          const legalHidden = !legal || legalStyle?.display === "none" || legal.getClientRects().length === 0;
          if (pricingHidden || legalHidden) hid = true;
        };
        const obs = new MutationObserver(note);
        obs.observe(document.documentElement, {
          attributes: true,
          subtree: true,
          childList: true,
          attributeFilter: ["class", "style"],
        });
        Object.assign(window, { __pricingHid: () => hid });
      });
      await page.getByRole("tab", { name: "Purchased" }).click();
      await page.waitForTimeout(800);
      const hid = await page.evaluate(() => {
        const reader = Reflect.get(window, "__pricingHid");
        return typeof reader === "function" ? reader() === true : true;
      });
      const box = await pricingBox(page);
      expect(hid).toBe(false);
      expect(box.visible).toBe(true);
      expect(box.legalVisible).toBe(true);
      expect(box.pending).toBe(false);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps Pricing still and CLS under 0.01 when claims arrive 2s after auth", async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await installCls(page);
      const tradeUps = [makeTradeUp({ id: 11, claimed_by_me: true })];
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname + url.search;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        if (path.startsWith("/api/auth/me")) {
          await fulfill(route, 200, {
            steam_id: "2",
            display_name: "Bea",
            avatar_url: "",
            tier: "free",
            lifetime: false,
            is_admin: false,
          }, 100);
          return;
        }
        if (path.includes("/stats")) {
          await fulfill(route, 403, { error: "nope" }, 5000);
          return;
        }
        if (path.includes("my_claims")) {
          await fulfill(route, 200, { trade_ups: tradeUps }, 2000);
          return;
        }
        await fulfill(route, 200, {});
      });
      await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const tops: number[] = [];
      const started = Date.now();
      while (Date.now() - started < 3200) {
        const box = await pricingBox(page);
        if (box.visible && box.top !== null) tops.push(box.top);
        await page.waitForTimeout(100);
      }
      expect(tops.length).toBeGreaterThan(2);
      const drift = Math.max(...tops) - Math.min(...tops);
      expect(drift, `pricing top drift ${drift.toFixed(2)}`).toBeLessThan(2);
      expect(await page.locator(".preview-claim").count()).toBe(1);
      expect(await readCls(page)).toBeLessThan(0.01);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("waits on stats for a lifetime buyer stored as tier free", async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await installCls(page);
      let statsAt = 0;
      let authAt = 0;
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname + url.search;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        if (path.startsWith("/api/auth/me")) {
          await fulfill(route, 200, {
            steam_id: "9",
            display_name: "Ada",
            avatar_url: "",
            tier: "free",
            lifetime: true,
            is_admin: false,
          }, 80);
          authAt = Date.now();
          return;
        }
        if (path.includes("/stats")) {
          await fulfill(route, 200, STATS, 2000);
          statsAt = Date.now();
          return;
        }
        await fulfill(route, 200, path.includes("my_claims") ? { trade_ups: [] } : {});
      });
      await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector(".preview-stats", { timeout: 8_000 });
      const early = await pricingBox(page);
      const earlyStats = await page.locator(".preview-stats").innerText();
      expect(early.visible, "pricing before stats").toBe(false);
      expect(early.legalVisible, "legal before stats").toBe(false);
      expect(earlyStats).not.toContain("+$184.20");
      await page.waitForFunction(() => {
        const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing");
        return !!pricing && getComputedStyle(pricing).display !== "none" && pricing.getClientRects().length > 0;
      }, undefined, { timeout: 6_000 });
      const shownAt = Date.now();
      expect(shownAt).toBeGreaterThanOrEqual(statsAt - 30);
      expect(authAt).toBeGreaterThan(0);
      const statsText = await page.locator(".preview-stats").innerText();
      expect(statsText).toContain("+$184.20");
      expect(await readCls(page)).toBeLessThan(0.01);
      const later = await pricingBox(page);
      expect(later.visible).toBe(true);
      expect(later.legalVisible).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  it("keeps tab order with the visual order at 390", async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      const tradeUps = [1, 2, 3].map((id) => makeTradeUp({ id, claimed_by_me: true }));
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname + url.search;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        if (path.startsWith("/api/auth/me")) {
          await fulfill(route, 200, {
            steam_id: "1",
            display_name: "Ada",
            avatar_url: "",
            tier: "pro",
            lifetime: false,
            is_admin: false,
          });
          return;
        }
        if (path.includes("/stats")) {
          await fulfill(route, 200, STATS);
          return;
        }
        if (path.includes("my_claims")) {
          await fulfill(route, 200, { trade_ups: tradeUps });
          return;
        }
        await fulfill(route, 200, {});
      });
      await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForFunction(() => document.querySelectorAll(".preview-claim").length === 3, undefined, { timeout: 8_000 });
      const tabs = await page.evaluate(() => {
        return [...document.querySelectorAll(".preview-tabs [role=tab]")].map((node) => {
          const box = node.getBoundingClientRect();
          return { text: (node.textContent ?? "").replace(/\s+/g, " ").trim(), top: box.top, left: box.left };
        });
      });
      expect(tabs.map((tab) => tab.text.replace(/ \(3\)$/, ""))).toEqual(["Active Claims", "Purchased", "History"]);
      expect(tabs[0]?.left ?? 0).toBeLessThan(tabs[1]?.left ?? 0);
      expect(tabs[1]?.left ?? 0).toBeLessThan(tabs[2]?.left ?? 0);
      expect(Math.abs((tabs[0]?.top ?? 0) - (tabs[2]?.top ?? 0))).toBeLessThan(8);

      await page.locator(".preview-tabs [role=tab]").first().focus();
      const stops: { text: string; top: number; left: number }[] = [];
      for (let i = 0; i < 80; i += 1) {
        const stop = await page.evaluate(() => {
          const el = document.activeElement;
          if (!(el instanceof HTMLElement)) return null;
          const box = el.getBoundingClientRect();
          return {
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
            top: box.top,
            left: box.left,
          };
        });
        if (stop) stops.push(stop);
        if (stop?.text === "Pricing") break;
        await page.keyboard.press("Tab");
      }
      const labels = stops.map((stop) => stop.text);
      expect(labels[0]).toContain("Active Claims");
      const purchasedAt = labels.findIndex((label) => label.startsWith("Purchased"));
      const historyAt = labels.findIndex((label) => label.startsWith("History"));
      const verifyAt = labels.findIndex((label) => label === "Verify");
      const confirmAt = labels.findIndex((label) => label === "Confirm Purchase");
      const pricingAt = labels.findIndex((label) => label === "Pricing");
      expect(purchasedAt).toBeGreaterThan(0);
      expect(historyAt).toBeGreaterThan(purchasedAt);
      expect(verifyAt).toBeGreaterThan(historyAt);
      expect(confirmAt).toBeGreaterThan(verifyAt);
      expect(pricingAt).toBeGreaterThan(confirmAt);
      const landmark = (label: string) => (
        label.startsWith("Active Claims")
        || label.startsWith("Purchased")
        || label.startsWith("History")
        || label === "Verify"
        || label === "Confirm Purchase"
        || label === "Pricing"
      );
      const visual = stops.filter((stop) => landmark(stop.text));
      for (let i = 1; i < visual.length; i += 1) {
        const prev = visual[i - 1];
        const next = visual[i];
        if (!prev || !next) continue;
        const sameRow = Math.abs(next.top - prev.top) < 12;
        if (sameRow) {
          expect(next.left + 1, `${prev.text} -> ${next.text}`).toBeGreaterThanOrEqual(prev.left);
        } else {
          expect(next.top + 1, `${prev.text} -> ${next.text}`).toBeGreaterThanOrEqual(prev.top);
        }
      }
      const order = await page.evaluate(() => {
        const last = document.querySelector(".preview-claim:last-child")?.getBoundingClientRect();
        const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing")?.getBoundingClientRect();
        const legal = document.querySelector(".preview-console__legal")?.getBoundingClientRect();
        return {
          claims: document.querySelectorAll(".preview-claim").length,
          lastBottom: last?.bottom ?? 0,
          pricingTop: pricing?.top ?? 0,
          legalTop: legal?.top ?? 0,
        };
      });
      expect(order.claims).toBe(3);
      expect(order.pricingTop).toBeGreaterThan(order.lastBottom);
      expect(order.legalTop).toBeGreaterThan(order.pricingTop);
    } finally {
      await page.close();
    }
  }, 30_000);
});
