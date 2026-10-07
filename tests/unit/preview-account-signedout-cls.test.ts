/**
 * Signed-out /my-trade-ups must not paint the signed-in stack while
 * /api/auth/me is in flight. CLS stays under 0.05 and at or below the
 * measurements taken on main (360/375/390/1280).
 */
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright-core";
import puppeteer from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MAIN_CLS: Record<number, number> = {
  360: 0.0322,
  375: 0.0322,
  390: 0.0252,
  1280: 0.0139,
};

const WIDTHS = [360, 375, 390, 1280] as const;
const AUTH_DELAYS = [500, 2000, 5000];

describe("signed-out account CLS", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base = "";

  beforeAll(async () => {
    server = await createServer({
      server: { host: "127.0.0.1", port: 5199, strictPort: false },
      logLevel: "error",
    });
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 5199;
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

  async function measure(page: Page, width: number, delay: number): Promise<number> {
    const height = width === 1280 ? 800 : 844;
    await page.setViewportSize({ width, height });
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
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (!path.startsWith("/api/")) {
        await route.continue();
        return;
      }
      if (path.startsWith("/api/auth/me")) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(150);
    expect(await page.locator(".preview-stats").count(), `${width} early`).toBe(0);
    expect(await page.locator(".preview-account__slot").count(), `${width} early slot`).toBe(0);
    expect(await page.locator("[aria-busy=true]").count(), `${width} early busy`).toBe(0);
    await page.waitForTimeout(delay + 800);
    expect(await page.getByText("Sign in with Steam").count()).toBeGreaterThan(0);
    expect(await page.locator(".preview-stats").count(), `${width} late`).toBe(0);
    expect(await page.locator("[aria-busy=true]").count(), `${width} late busy`).toBe(0);
    const cls = await page.evaluate(() => {
      const reader = Reflect.get(window, "__accountCls");
      if (typeof reader !== "function") return 0;
      const value: unknown = reader();
      return typeof value === "number" ? value : 0;
    });
    return cls;
  }

  it("stays under 0.05 and at or below main while auth is delayed", async () => {
    const failures: string[] = [];
    for (const width of WIDTHS) {
      for (const delay of AUTH_DELAYS) {
        const page = await browser.newPage();
        try {
          const cls = await measure(page, width, delay);
          const ceiling = MAIN_CLS[width] ?? 0.05;
          if (!(cls < 0.05) || cls > ceiling) {
            failures.push(`${width} auth ${delay}ms cls ${cls.toFixed(4)} ceiling ${ceiling}`);
          }
        } finally {
          await page.close();
        }
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);

  async function pricingBox(page: Page, width: number, height: number, user: "out" | "free"): Promise<{ bottom: number; cls: number; legalGap: number }> {
    await page.setViewportSize({ width, height });
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
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname + url.search;
      if (!path.startsWith("/api/")) {
        await route.continue();
        return;
      }
      if (path.startsWith("/api/auth/me")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const body = user === "out"
          ? "null"
          : JSON.stringify({ steam_id: "2", display_name: "Bea", avatar_url: "", tier: "free", is_admin: false });
        await route.fulfill({ status: 200, contentType: "application/json", body });
        return;
      }
      if (path.includes("my_claims") || path.startsWith("/api/my-trade-ups")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "nope" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(500 + 500 + 800);
    return page.evaluate(() => {
      const pricing = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === "Pricing");
      const prect = pricing?.getBoundingClientRect();
      const legal = document.querySelector(".preview-console__legal")?.getBoundingClientRect();
      const reader = Reflect.get(window, "__accountCls");
      const raw: unknown = typeof reader === "function" ? reader() : 0;
      return {
        bottom: prect ? prect.bottom : 9999,
        cls: typeof raw === "number" ? raw : 999,
        legalGap: prect && legal ? legal.y - prect.bottom : 999,
      };
    });
  }

  it("keeps Pricing above the fold for signed-out and empty free users at 390×844", async () => {
    const failures: string[] = [];
    const phones = [
      { width: 360, height: 780 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
    ] as const;
    for (const user of ["out", "free"] as const) {
      for (const phone of phones) {
        const page = await browser.newPage();
        try {
          const box = await pricingBox(page, phone.width, phone.height, user);
          const ceiling = phone.width === 390 ? MAIN_CLS[390] ?? 0.0252 : 0.05;
          if (box.bottom > phone.height || box.cls > ceiling || box.legalGap > 48 || box.legalGap < -4) {
            failures.push(`${user} ${phone.width}x${phone.height} bottom ${box.bottom.toFixed(0)} cls ${box.cls.toFixed(4)} legalGap ${box.legalGap.toFixed(0)}`);
          }
        } finally {
          await page.close();
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
