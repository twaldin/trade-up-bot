/**
 * Paying viewers must not see the free-tier banner when auth is slower than
 * the list. Chromium loads the real board; happy-dom cannot measure CLS.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";

const PORT = 4188;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WIDTHS = [360, 375, 390, 1280] as const;
const TRADE_UP = makeTradeUp({ id: 7 });

type Tier = "pro" | "lifetime";

interface Cell {
  tier: Tier;
  listMs: number;
  width: number;
  cardAt: number | null;
  cls: number;
  visibleBanner: boolean;
}

const scenario: { tier: Tier; listMs: number } = { tier: "pro", listMs: 200 };

function authBody(tier: Tier) {
  if (tier === "lifetime") return { steam_id: "765", tier: "pro", lifetime: true };
  return { steam_id: "765", tier: "pro", lifetime: false };
}

function cardLimit(_listMs: number): number {
  // A quiet run paints a 200ms list by about 1.2s. This suite shares the
  // machine with the other unit files, which stretched one cell to about 4s.
  // The watch ends at 6.5s, so a card that also waits out the 5s auth does
  // not arrive in time.
  return 6500;
}

async function arm(page: Page) {
  await page.evaluateOnNewDocument(() => {
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
  page.on("request", (req) => {
    const url = req.url();
    const send = (body: unknown, ms: number) => {
      setTimeout(() => {
        void req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        }).catch(() => {});
      }, ms);
    };
    if (!url.includes("/api/")) {
      void req.continue().catch(() => {});
      return;
    }
    if (url.includes("/api/auth/me")) {
      send(authBody(scenario.tier), 5000);
      return;
    }
    if (url.includes("/api/trade-ups")) {
      send({
        trade_ups: [TRADE_UP],
        total: 1,
        tier: scenario.tier,
        signed_in: true,
      }, scenario.listMs);
      return;
    }
    if (url.includes("/api/preview/faces")) {
      send({ faces: {} }, 0);
      return;
    }
    send({}, 0);
  });
  await page.setRequestInterception(true);
}

async function measure(page: Page, width: number): Promise<Omit<Cell, "tier" | "listMs" | "width">> {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  const started = Date.now();
  await page.goto(`${ORIGIN}/trade-ups`, { waitUntil: "domcontentloaded" });
  let cardAt: number | null = null;
  let visibleBanner = false;
  while (Date.now() - started < 6500) {
    const snap = await page.evaluate(() => ({
      card: document.querySelector(".preview-card:not(.preview-card--skeleton)") != null,
      banner: document.querySelector(".preview-delay:not(.preview-delay--hold)") != null,
      cls: Number(document.documentElement.dataset.cls ?? "0"),
    }));
    if (snap.banner) visibleBanner = true;
    if (snap.card && cardAt == null) cardAt = Date.now() - started;
    if (Date.now() - started >= 5600 && cardAt != null) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const cls = await page.evaluate(() => Number(document.documentElement.dataset.cls ?? "0"));
  return { cardAt, cls, visibleBanner };
}

describe("paid lists do not grow the free banner", () => {
  let browser: Browser;
  let vite: ChildProcess;
  const cells: Cell[] = [];

  beforeAll(async () => {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    let log = "";
    vite = spawn(
      resolve("node_modules/.bin/vite"),
      ["--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      { cwd: resolve("."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BROWSER: "none" } },
    );
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`vite did not start\n${log}`)), 20000);
      const onData = (buf: Buffer) => {
        log += String(buf);
        const plain = log.replace(/\u001b\[[0-9;]*m/g, "");
        if (plain.includes(`127.0.0.1:${PORT}`)) {
          clearTimeout(timer);
          resolveReady();
        }
      };
      vite.stdout?.on("data", onData);
      vite.stderr?.on("data", onData);
      vite.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`vite exited ${code ?? "null"}\n${log}`));
      });
    });
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const warm = await browser.newPage();
    scenario.tier = "pro";
    scenario.listMs = 0;
    await arm(warm);
    await warm.setViewport({ width: 390, height: 900 });
    await warm.goto(`${ORIGIN}/trade-ups`, { waitUntil: "domcontentloaded" });
    await warm.waitForSelector(".preview-card:not(.preview-card--skeleton)", { timeout: 15000 });
    await warm.close();
  }, 40000);

  afterAll(async () => {
    await browser?.close();
    if (vite && vite.exitCode == null && vite.pid) {
      vite.kill("SIGTERM");
    }
    if (cells.length > 0) {
      writeFileSync("/opt/cursor/artifacts/paid-paint.json", JSON.stringify(cells, null, 2));
    }
  });

  it("hides the free banner for pro and lifetime at 360, 375, 390, and 1280", async () => {
    for (const tier of ["pro", "lifetime"] as const) {
      for (const listMs of [200, 1500]) {
        scenario.tier = tier;
        scenario.listMs = listMs;
        const row = await Promise.all(WIDTHS.map(async (width) => {
          const page = await browser.newPage();
          await arm(page);
          try {
            const measured = await measure(page, width);
            if (width === 390) {
              await page.screenshot({
                path: `/opt/cursor/artifacts/paid-${tier}-${listMs}-390.png`,
              });
            }
            return { tier, listMs, width, ...measured };
          } finally {
            await page.close();
          }
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
  }, 180000);
});
