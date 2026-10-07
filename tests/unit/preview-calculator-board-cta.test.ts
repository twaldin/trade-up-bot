/**
 * Chromium acceptance for the calculator's next step: after a result, one
 * in-app link to the profit-sorted board, one cta_click, and a 44px target
 * at 390. happy-dom does not apply the narrow min-height.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 5193;
const BASE = `http://127.0.0.1:${PORT}`;
const CTA = "See live trade-ups above cost";
const TYPE = "classified_covert";

type ProbeWindow = Window & {
  tubTracking?: { ga4MeasurementId?: string };
  dataLayer?: unknown[];
  __doc?: number;
};

const example = {
  label: "example",
  trade_up_id: 1,
  used_fallback: false,
  inputs: [{
    skinName: "AK-47 | Redline",
    floatValue: "0.15",
    priceCents: "500",
    resolved: {
      name: "AK-47 | Redline",
      weapon: "AK-47",
      rarity: "Classified",
      min_float: 0,
      max_float: 1,
      collection_name: "Test Collection",
      floor_price_cents: 500,
    },
  }],
};

const tradeUp = makeTradeUp({ type: TYPE });

function startVite(): Promise<ChildProcess> {
  return new Promise((resolveReady, reject) => {
    const child = spawn(process.execPath, [
      "node_modules/vite/bin/vite.js",
      "--host", "127.0.0.1",
      "--port", String(PORT),
      "--strictPort",
    ], {
      cwd: ROOT,
      env: { ...process.env, API_PROXY: "", BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolveReady(child);
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes("Local:")) finish();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => finish(new Error(`vite exited ${code}: ${buf.slice(-500)}`)));
    setTimeout(() => finish(new Error(`vite did not listen: ${buf.slice(-500)}`)), 40_000);
  });
}

async function stubApis(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/google-analytics|googletagmanager|facebook\.net|facebook\.com|stripe\.com|open\.er-api\.com|\/auth\/steam/.test(url)) {
      void req.abort();
      return;
    }
    let path = "";
    try { path = new URL(url).pathname; } catch { path = ""; }
    if (path.startsWith("/api/") || path === "/api/subscribe") {
      if (path === "/api/calculator/example") {
        void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(example) });
        return;
      }
      if (path === "/api/calculator" && req.method() === "POST") {
        void req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            trade_up: tradeUp,
            stats: { chance_to_profit: 0.4, best_case_cents: 1000, worst_case_cents: -50 },
          }),
        });
        return;
      }
      void req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trade_ups: [], tier: "free", total: 0, faces: {} }),
      });
      return;
    }
    void req.continue();
  });
}

async function prepare(page: Page, width: number, height: number, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.0 Mobile Safari/537.36");
    await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  } else {
    await page.setViewport({ width, height, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  }
  await page.evaluateOnNewDocument(() => {
    (window as ProbeWindow).tubTracking = { ga4MeasurementId: "G-TESTCALCCTA" };
  });
  await stubApis(page);
}

describe("calculator next step to the profit-sorted board", () => {
  let browser: Browser;
  let vite: ChildProcess;

  beforeAll(async () => {
    vite = await startVite();
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (vite && vite.exitCode === null) vite.kill("SIGTERM");
  });

  it.each([
    { width: 1280, height: 800, mobile: false },
    { width: 390, height: 844, mobile: true },
  ])("links the result to the live board at $width", async ({ width, height, mobile }) => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await prepare(page, width, height, mobile);
    await page.goto(`${BASE}/calculator`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((node) => node.textContent?.includes("Load example")),
      { timeout: 20_000 },
    );

    const before = await page.evaluate((label) => document.body.innerText.includes(label), CTA);
    expect(before).toBe(false);

    await page.evaluate(() => {
      (window as ProbeWindow).tubTracking = { ga4MeasurementId: "G-TESTCALCCTA" };
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Load example"));
      if (!(button instanceof HTMLButtonElement)) throw new Error("Load example missing");
      button.click();
    });

    await page.waitForFunction(
      (label) => [...document.querySelectorAll("a")].some((node) => node.textContent?.trim() === label),
      { timeout: 15_000 },
      CTA,
    );

    const measured = await page.evaluate((label) => {
      const link = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === label);
      if (!(link instanceof HTMLAnchorElement)) return null;
      link.scrollIntoView({ block: "center" });
      const rect = link.getBoundingClientRect();
      const banned = document.body.innerText.match(/\b(chance|odds|win|jackpot|gamble|bet|lucky|roll|bankroll|risk-free)\b/i);
      return {
        href: link.getAttribute("href"),
        target: link.getAttribute("target"),
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        banned: banned?.[0] ?? null,
        text: link.textContent?.trim() ?? "",
      };
    }, CTA);

    expect(measured).not.toBeNull();
    expect(measured?.text).toBe(CTA);
    expect(measured?.href).toBe(`/trade-ups?sort=profit&order=desc&type=${TYPE}`);
    expect(measured?.target).toBeNull();
    expect(measured?.banned).toBeNull();
    expect(measured!.overflow).toBeLessThanOrEqual(1);
    expect(measured!.left).toBeGreaterThanOrEqual(0);
    expect(measured!.right).toBeLessThanOrEqual((measured!.innerWidth) + 1);
    expect(measured!.top).toBeGreaterThanOrEqual(0);
    expect(measured!.bottom).toBeLessThanOrEqual(measured!.innerHeight + 1);
    expect(measured!.width).toBeGreaterThan(0);
    expect(measured!.height).toBeGreaterThan(0);
    if (width === 390) {
      expect(measured!.width).toBeGreaterThanOrEqual(44);
      expect(measured!.height).toBeGreaterThanOrEqual(44);
    }

    const stamp = await page.evaluate(() => {
      (window as ProbeWindow).__doc = 1;
      return performance.getEntriesByType("navigation")[0]?.startTime ?? -1;
    });
    await page.evaluate((label) => {
      const link = [...document.querySelectorAll("a")].find((node) => node.textContent?.trim() === label);
      if (!(link instanceof HTMLAnchorElement)) throw new Error("cta missing");
      link.click();
    }, CTA);
    await page.waitForFunction(() => location.pathname === "/trade-ups", { timeout: 10_000 });

    const landed = await page.evaluate(() => {
      const events = ((window as ProbeWindow).dataLayer ?? []).flatMap((entry) => {
        const args = Array.from(entry as ArrayLike<unknown>);
        if (args[0] !== "event" || args[1] !== "cta_click") return [];
        const params = args[2] as { cta?: string } | undefined;
        return params?.cta === "calculator_board" ? [params.cta] : [];
      });
      const url = new URL(location.href);
      return {
        stamp: (window as ProbeWindow).__doc ?? 0,
        navStart: performance.getEntriesByType("navigation")[0]?.startTime ?? -1,
        pathname: url.pathname,
        sort: url.searchParams.get("sort"),
        order: url.searchParams.get("order"),
        type: url.searchParams.get("type"),
        events,
      };
    });

    expect(landed.stamp).toBe(1);
    expect(landed.navStart).toBe(stamp);
    expect(landed.pathname).toBe("/trade-ups");
    expect(landed.sort).toBe("profit");
    // The link includes order=desc. The board then omits that default when it rewrites the query.
    expect(landed.order === null || landed.order === "desc").toBe(true);
    expect(landed.type).toBe(TYPE);
    expect(landed.events).toEqual(["calculator_board"]);
    await new Promise((r) => setTimeout(r, 300));
    const again = await page.evaluate(() => ((window as ProbeWindow).dataLayer ?? []).flatMap((entry) => {
      const args = Array.from(entry as ArrayLike<unknown>);
      if (args[0] !== "event" || args[1] !== "cta_click") return [];
      const params = args[2] as { cta?: string } | undefined;
      return params?.cta === "calculator_board" ? [params.cta] : [];
    }));
    expect(again).toEqual(["calculator_board"]);
    expect(pageErrors).toEqual([]);
    await page.close();
  }, 45_000);
});
