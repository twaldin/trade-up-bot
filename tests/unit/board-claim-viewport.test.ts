/**
 * Chromium click of the real board claim control at the two widths the
 * activation bug was reported on. happy-dom does not lay out the tap target.
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundlePath = "/tmp/board-claim-harness.js";

declare global {
  interface Window {
    __claims: number;
    __gtag: unknown[][];
    __opened: string[];
  }
}

const HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/src/preview/preview.css" />
</head>
<body>
  <div id="root"></div>
  <script src="/harness.js"></script>
</body>
</html>`;

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function fileFor(urlPath: string): { body: Buffer; type: string } | null {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "");
  if (clean === "/" || clean === "/harness.html") return { body: Buffer.from(HTML), type: "text/html" };
  if (clean === "/harness.js") return { body: readFileSync(bundlePath), type: "text/javascript" };
  if (!clean.startsWith("/") || clean.includes("..")) return null;
  const full = resolve(repo, clean.slice(1));
  if (!full.startsWith(repo) || !existsSync(full)) return null;
  return { body: readFileSync(full), type: TYPES[extname(full)] ?? "application/octet-stream" };
}

async function shoot(page: Page, name: string) {
  const dir = "/opt/cursor/artifacts";
  if (!existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

async function claimButton(page: Page) {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Verify / Claim trade-up"));
    if (!(button instanceof HTMLButtonElement)) return null;
    button.scrollIntoView({ block: "center" });
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      tag: button.tagName,
      href: button.getAttribute("href"),
      height: rect.height,
      width: rect.width,
      top: rect.top,
      left: rect.left,
      hittable: hit === button || button.contains(hit),
    };
  });
}

describe("board claim tap at 390 and 1280", () => {
  let browser: Browser;
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    await esbuild.build({
      entryPoints: [resolve(repo, "tests/helpers/board-claim-harness.tsx")],
      bundle: true,
      outfile: bundlePath,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    server = createServer((req, res) => {
      const file = fileFor(req.url ?? "/");
      if (!file) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "content-type": file.type });
      res.end(file.body);
    });
    await new Promise<void>((resolveListen) => { server.listen(0, "127.0.0.1", resolveListen); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    origin = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolveClose) => { server?.close(() => resolveClose()); });
  });

  async function open(width: number, mode: string) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      const opened: string[] = [];
      window.__opened = opened;
      window.open = (url?: string | URL) => {
        opened.push(String(url ?? ""));
        return null;
      };
    });
    await page.setViewport({ width, height: width === 390 ? 844 : 800 });
    await page.goto(`${origin}/harness.html?mode=${mode}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    return page;
  }

  it.each([390, 1280])("opens the claim modal in place at %ipx and does not claim", async (width) => {
    const page = await open(width, "modal");
    await page.waitForSelector("button", { timeout: 15000 });
    const target = await claimButton(page);
    expect(target?.tag).toBe("BUTTON");
    expect(target?.href).toBeNull();
    expect(target?.height).toBeGreaterThanOrEqual(34);
    expect(target?.width).toBeGreaterThan(100);
    expect(target?.hittable).toBe(true);
    expect(target?.top).toBeGreaterThanOrEqual(0);
    expect(target?.left).toBeGreaterThanOrEqual(0);

    const pagesBefore = (await browser.pages()).length;
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Verify / Claim trade-up"))?.click();
    });
    await page.waitForSelector("dialog[open]", { timeout: 5000 });
    const result = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      const rect = dialog?.getBoundingClientRect();
      const go = dialog?.querySelector("a.preview-sheet__go");
      const claims = window.__gtag.filter((call) => call[1] === "claim_trade_up");
      return {
        text: dialog?.textContent ?? "",
        href: go?.getAttribute("href") ?? "",
        open: dialog instanceof HTMLDialogElement ? dialog.open : false,
        dialogWidth: rect?.width ?? 0,
        dialogTop: rect?.top ?? -1,
        pagesText: document.body.innerText.includes("Opens the live trade-up on tradeupbot.app."),
        claims: claims.length,
        posts: window.__claims,
        opened: window.__opened,
      };
    });
    expect(result.open).toBe(true);
    expect(result.text).toContain("Verify and claim this trade-up");
    expect(result.href).toBe("/auth/steam?return=%2Ftrade-ups%2F42");
    expect(result.dialogWidth).toBeGreaterThan(200);
    expect(result.dialogWidth).toBeLessThanOrEqual(width);
    expect(result.dialogTop).toBeGreaterThanOrEqual(0);
    expect(result.pagesText).toBe(false);
    expect(result.claims).toBe(0);
    expect(result.posts).toBe(0);
    expect(result.opened).toEqual([]);
    expect((await browser.pages()).length).toBe(pagesBefore);
    await shoot(page, `claim-modal-${width}`);
    await page.close();
  }, 30000);

  it.each([390, 1280])("labels the collapsed control Open at %ipx", async (width) => {
    const page = await open(width, "collapsed");
    await page.waitForSelector(".preview-cardline__verify", { timeout: 15000 });
    const label = await page.evaluate(() => {
      const link = document.querySelector(".preview-cardline__verify");
      const rect = link?.getBoundingClientRect();
      return {
        text: link?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        aria: link?.getAttribute("aria-label") ?? "",
        height: rect?.height ?? 0,
      };
    });
    expect(label.text.startsWith("Open")).toBe(true);
    expect(label.text).not.toContain("Verify");
    expect(label.aria).toBe("Open trade-up details");
    expect(label.height).toBeGreaterThanOrEqual(24);
    await shoot(page, `claim-collapsed-${width}`);
    await page.close();
  }, 30000);

  it("fires claim_trade_up once when a Pro viewer claims from the board", async () => {
    const page = await open(1280, "pro");
    await page.waitForSelector("button", { timeout: 15000 });
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Verify / Claim trade-up"))?.click();
    });
    await page.waitForFunction(() => document.body.innerText.includes("Claimed"), { timeout: 5000 });
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Verify / Claim trade-up"))?.click();
    });
    const result = await page.evaluate(() => ({
      posts: window.__claims,
      claims: window.__gtag.filter((call) => call[1] === "claim_trade_up").length,
      dialog: document.querySelector("dialog[open]") !== null,
      opened: window.__opened,
    }));
    expect(result.posts).toBe(1);
    expect(result.claims).toBe(1);
    expect(result.dialog).toBe(false);
    expect(result.opened).toEqual([]);
    await page.close();
  }, 30000);
});
