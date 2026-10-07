/**
 * Client navigations must replace the document canonical. A direct GET is
 * already correct; the bug is the tag left behind by the previous route.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tradeUp = makeTradeUp({ id: 42 });

const SKIN_DETAIL = {
  listings: [],
  priceSources: [],
  stats: { totalListings: 0, minPrice: null, maxPrice: null, saleCount: 0 },
};

function skinNameForSlug(slug: string): string {
  if (slug === "ak-47-fire-serpent") return "AK-47 | Fire Serpent";
  return "AK-47 | Redline";
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

async function startVite(): Promise<{ child: ChildProcess; origin: string }> {
  const child = spawn(
    process.execPath,
    [resolve(repo, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5197", "--strictPort"],
    {
      cwd: repo,
      env: { ...process.env, BROWSER: "none", NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const origin = await new Promise<string>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start\n${logs}`)), 20_000);
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
      reject(new Error(`vite exited ${code ?? "null"}\n${logs}`));
    });
  });
  return { child, origin };
}

async function canonicalHrefs(page: Page): Promise<string[]> {
  return page.locator("link[rel='canonical']").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href") ?? ""),
  );
}

async function expectCanonical(page: Page, href: string): Promise<void> {
  await page.waitForFunction((expected) => {
    const links = [...document.querySelectorAll("link[rel='canonical']")];
    return links.length === 1 && links[0]?.getAttribute("href") === expected;
  }, href, { timeout: 8_000 });
  expect(await canonicalHrefs(page)).toEqual([href]);
}

async function boardPage(browser: Browser, origin: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("https://open.er-api.com/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/trade-ups") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ trade_ups: [tradeUp], tier: "pro", total: 1, total_profitable: 1 }),
      });
      return;
    }
    if (url.pathname.startsWith("/api/skin-by-slug/")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/skin-by-slug/".length));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ name: skinNameForSlug(slug) }),
      });
      return;
    }
    if (url.pathname.startsWith("/api/skin-data/")) {
      const encoded = url.pathname.slice("/api/skin-data/".length);
      const name = decodeURIComponent(encoded);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...SKIN_DETAIL,
          skin: {
            id: "skin-1",
            name,
            rarity: "Classified",
            weapon: name.split("|")[0]?.trim() || "AK-47",
            min_float: 0.1,
            max_float: 0.7,
            collection_name: "The Phoenix Collection",
          },
        }),
      });
      return;
    }
    if (url.pathname === "/api/skin-data") {
      await route.fulfill({ contentType: "application/json", body: "[]" });
      return;
    }
    if (url.pathname === "/api/preview/faces") {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: "null" });
  });
  await page.goto(`${origin}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await expectCanonical(page, "https://tradeupbot.app/trade-ups");
  return page;
}

it("reads a vite local URL when ANSI color splits the host and port", () => {
  const raw = "\u001b[32m➜\u001b[31m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:\u001b[1m5197\u001b[22m/\u001b[39m";
  const match = stripAnsi(raw).match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
  expect(match?.[1]).toBe("http://127.0.0.1:5197/");
});

describe("canonical after a client navigation", () => {
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
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    if (vite && !vite.killed) vite.kill("SIGTERM");
  });

  it("points the canonical at the skin page after an in-app click from /trade-ups", async () => {
    const page = await boardPage(browser, origin);
    const loadsBefore = await page.evaluate(() => performance.getEntriesByType("navigation").length);
    const label = page.locator("a.preview-skin__label").first();
    await label.waitFor({ timeout: 8_000 });
    const path = await label.getAttribute("href");
    expect(path).toMatch(/^\/skins\/[a-z0-9-]+$/);
    // The flow arrow sits on the label's center. Dispatch on the anchor so the
    // router handles the click and the document does not reload.
    await label.evaluate((el) => {
      if (el instanceof HTMLAnchorElement) el.click();
    });
    await page.waitForURL((url) => url.pathname === path, { timeout: 8_000 });
    const loadsAfter = await page.evaluate(() => performance.getEntriesByType("navigation").length);
    expect(loadsAfter).toBe(loadsBefore);
    await expectCanonical(page, `https://tradeupbot.app${path}`);
    expect(await canonicalHrefs(page)).not.toContain("https://tradeupbot.app/");
    expect(await canonicalHrefs(page)).not.toContain("https://tradeupbot.app/trade-ups");
    const other = path === "/skins/ak-47-redline" ? "/skins/ak-47-fire-serpent" : "/skins/ak-47-redline";
    const next = page.locator(`a.preview-skin__label[href="${other}"]`).first();
    await next.waitFor({ timeout: 8_000 });
    await next.evaluate((el) => {
      if (el instanceof HTMLAnchorElement) el.click();
    });
    await page.waitForURL((url) => url.pathname === other, { timeout: 8_000 });
    const loadsAfterNext = await page.evaluate(() => performance.getEntriesByType("navigation").length);
    expect(loadsAfterNext).toBe(loadsBefore);
    await expectCanonical(page, `https://tradeupbot.app${other}`);
    await page.close();
  }, 30_000);

  it.each([
    ["Skins", "/skins", "https://tradeupbot.app/skins"],
    ["Calculator", "/calculator", "https://tradeupbot.app/calculator"],
    ["My trade-ups", "/my-trade-ups", "https://tradeupbot.app/my-trade-ups"],
  ] as const)("points the canonical at %s after an in-app click from /trade-ups", async (label, path, href) => {
    const page = await boardPage(browser, origin);
    await page.locator(".preview-sidebar__nav").getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL((url) => url.pathname === path, { timeout: 8_000 });
    await expectCanonical(page, href);
    await page.close();
  }, 30_000);
});
