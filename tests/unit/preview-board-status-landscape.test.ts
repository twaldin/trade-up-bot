/**
 * A landscape phone is shorter than the 360px fold offset. The empty and
 * failed message must stay inside its block and off the FAQ.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOAD_ERROR_COPY, UNFILTERED_EMPTY_COPY } from "../../src/preview/lib/board-notice.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VIEWPORTS = [
  { width: 844, height: 390 },
  { width: 844, height: 320 },
] as const;

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

async function startVite(): Promise<{ child: ChildProcess; origin: string }> {
  const child = spawn(
    process.execPath,
    [resolve(repo, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5204", "--strictPort"],
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

interface BoxMetrics {
  scrollHeight: number;
  clientHeight: number;
  statusBottom: number;
  contentBottom: number;
  faqTop: number;
  minHeight: number;
  rem: number;
}

async function openBoard(
  browser: Browser,
  origin: string,
  mode: "empty" | "fail",
  viewport: { width: number; height: number },
): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/trade-ups") {
      if (mode === "fail") {
        await route.fulfill({ status: 500, contentType: "text/plain", body: "no" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trade_ups: [], total: 0, total_profitable: 0, tier: "free", signed_in: false }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.goto(`${origin}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return page;
}

async function statusMetrics(page: Page): Promise<BoxMetrics> {
  return page.locator(".preview-board-status").evaluate((status) => {
    const faq = document.querySelector("section.preview-panel");
    const content = status.querySelector(".preview-notice") ?? status.querySelector(".preview-note");
    if (!(faq instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      throw new Error("status block is missing its message or the FAQ");
    }
    const statusRect = status.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const faqRect = faq.getBoundingClientRect();
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const minHeight = Number.parseFloat(getComputedStyle(status).minHeight);
    return {
      scrollHeight: status.scrollHeight,
      clientHeight: status.clientHeight,
      statusBottom: statusRect.bottom,
      contentBottom: contentRect.bottom,
      faqTop: faqRect.top,
      minHeight,
      rem,
    };
  });
}

function expectClearOfFaq(metrics: BoxMetrics): void {
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
  expect(metrics.contentBottom).toBeLessThanOrEqual(metrics.faqTop);
  expect(metrics.statusBottom).toBeLessThanOrEqual(metrics.faqTop);
  expect(metrics.minHeight).toBeGreaterThanOrEqual(metrics.rem * 12);
}

describe("empty and failed boards at landscape height", () => {
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

  it.each(VIEWPORTS)("keeps the empty message inside the status block and off the FAQ at $width×$height", async (viewport) => {
    const page = await openBoard(browser, origin, "empty", viewport);
    await page.getByText(UNFILTERED_EMPTY_COPY).waitFor({ timeout: 8_000 });
    expectClearOfFaq(await statusMetrics(page));
    await page.close();
  }, 20_000);

  it.each(VIEWPORTS)("keeps the error message and Retry inside the status block and off the FAQ at $width×$height", async (viewport) => {
    const page = await openBoard(browser, origin, "fail", viewport);
    await page.getByRole("button", { name: "Retry" }).waitFor({ timeout: 8_000 });
    await page.getByText(LOAD_ERROR_COPY).waitFor({ timeout: 8_000 });
    expectClearOfFaq(await statusMetrics(page));
    await page.close();
  }, 20_000);
});
