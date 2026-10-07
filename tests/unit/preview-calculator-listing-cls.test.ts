/**
 * Chromium check: a priced slot and a no-listings slot share one row height,
 * and adding them keeps CLS under 0.05 at 360, 390, and 1280.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_LISTINGS_COPY } from "../../shared/calculator-example.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const BANNED = /\b(?:chances?|odds|gambl\w*|bankrolls?|jackpots?|bets?|betting|win|wins|winning|lottery|lucky|rolls?|rolled)\b(?!-)|risk-free/i;

const priced = {
  name: "AK-47 | Leet Museo",
  weapon: "AK-47",
  rarity: "Classified",
  min_float: 0,
  max_float: 0.65,
  collection_name: "The 2021 Train Collection",
  floor_price_cents: 6075,
  floor_float: 0.5,
};
const unlisted = {
  name: "SCAR-20 | Splash Jam",
  weapon: "SCAR-20",
  rarity: "Restricted",
  min_float: 0.06,
  max_float: 0.8,
  collection_name: "The 2021 Train Collection",
  floor_price_cents: null,
  floor_float: null,
};

async function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--host", "127.0.0.1",
    "--port", String(PORT),
    "--strictPort",
  ], {
    cwd: ROOT,
    env: { ...process.env, API_PROXY: "", BROWSER: "none", NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  child.stdout?.on("data", (chunk: Buffer) => { buf += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { buf += chunk.toString(); });
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite exited ${child.exitCode}: ${buf.slice(-500)}`);
    try {
      const res = await fetch(BASE);
      if (res.status < 500) return child;
    } catch {
      // The port is not open yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new Error(`vite did not listen: ${buf.slice(-500)}`);
}

async function prepare(page: Page, width: number, mobile: boolean): Promise<string[]> {
  const posts: string[] = [];
  if (mobile) {
    await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.0 Mobile Safari/537.36");
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  } else {
    await page.setViewport({ width, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  }
  await page.evaluateOnNewDocument(() => {
    Reflect.set(window, "__cls", 0);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!("value" in entry) || !("hadRecentInput" in entry)) continue;
        const value = entry.value;
        if (entry.hadRecentInput === true || typeof value !== "number") continue;
        const current = Reflect.get(window, "__cls");
        Reflect.set(window, "__cls", (typeof current === "number" ? current : 0) + value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/google-analytics|googletagmanager|facebook|stripe\.com|er-api/.test(url)) {
      void req.abort();
      return;
    }
    let path = "";
    try { path = new URL(url).pathname; } catch { path = ""; }
    if (path.startsWith("/api/")) {
      if (req.method() === "POST" && path === "/api/calculator") posts.push(req.postData() ?? "");
      if (path === "/api/calculator/search") {
        const q = new URL(url).searchParams.get("q") ?? "";
        const results = /splash|scar/i.test(q) ? [unlisted] : /leet|museo/i.test(q) ? [priced] : [];
        void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ results }) });
        return;
      }
      void req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    void req.continue();
  });
  return posts;
}

describe("calculator slot footprint", () => {
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
    { width: 360, mobile: true },
    { width: 390, mobile: true },
    { width: 1280, mobile: false },
  ])("keeps CLS under 0.05 at $width", async ({ width, mobile }) => {
    const page = await browser.newPage();
    const posts = await prepare(page, width, mobile);
    await page.goto(`${BASE}/calculator`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector("input.preview-input");

    async function add(query: string, label: string) {
      await page.click("input.preview-input", { clickCount: 3 });
      await page.type("input.preview-input", query, { delay: 5 });
      await page.waitForFunction(
        (name) => [...document.querySelectorAll("button.preview-row")].some((node) => node.textContent?.includes(name)),
        { timeout: 8_000 },
        label,
      );
      await page.evaluate((name) => {
        const button = [...document.querySelectorAll("button.preview-row")].find((node) => node.textContent?.includes(name));
        if (!(button instanceof HTMLButtonElement)) throw new Error(`missing ${name}`);
        button.click();
      }, label);
    }

    await add("Leet Museo", "Leet Museo");
    await add("Splash Jam", "Splash Jam");

    const measured = await page.evaluate((emptyCopy) => {
      const rows = [...document.querySelectorAll(".preview-listing")].map((node) => ({
        text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        height: node.getBoundingClientRect().height,
        unlisted: node.classList.contains("preview-listing--unlisted"),
      }));
      const note = document.querySelector(".preview-listing__unlisted");
      const clsRaw = Reflect.get(window, "__cls");
      const cls = typeof clsRaw === "number" ? clsRaw : 0;
      return {
        rows,
        cls,
        note: note ? { text: note.textContent, clientWidth: note.clientWidth, scrollWidth: note.scrollWidth } : null,
        banned: document.body.innerText.match(/\b(chance|odds|win|jackpot|gamble|bet|lucky|roll|bankroll|risk-free)\b/i)?.[0] ?? null,
        emptyCopy,
      };
    }, NO_LISTINGS_COPY);

    expect(measured.rows).toHaveLength(2);
    expect(measured.rows[0].text).toContain("0.5000");
    expect(measured.rows[0].text).toContain("$60.75");
    expect(measured.rows[0].text).toContain("BS");
    expect(measured.rows[0].text).not.toContain("0.3250");
    expect(measured.rows[1].unlisted).toBe(true);
    expect(measured.rows[1].text).toContain(NO_LISTINGS_COPY);
    expect(measured.rows[1].text).not.toContain("$0.00");
    expect(measured.rows[0].height).toBe(measured.rows[1].height);
    expect(measured.note?.scrollWidth).toBeLessThanOrEqual((measured.note?.clientWidth ?? 0) + 1);
    expect(measured.cls).toBeLessThan(0.05);
    expect(measured.banned).toBeNull();

    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Evaluate");
      if (!(button instanceof HTMLButtonElement)) throw new Error("Evaluate missing");
      button.click();
    });
    const deadline = Date.now() + 3_000;
    while (posts.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const sent = posts.map((body) => JSON.parse(body) as { inputs: { priceCents: number; skinName: string }[] });
    expect(sent.some((body) => body.inputs.some((input) => input.priceCents <= 0))).toBe(false);
    expect(sent.some((body) => body.inputs.some((input) => input.skinName.includes("Splash")))).toBe(false);

    try {
      await mkdir("/opt/cursor/artifacts", { recursive: true });
      const panel = await page.$(".preview-panel");
      await panel?.screenshot({ path: `/opt/cursor/artifacts/calc-after-${width}-both.png` });
    } catch {
      // Screenshot evidence is optional when the artifacts directory is not writable.
    }
    await page.close();
  });
});
