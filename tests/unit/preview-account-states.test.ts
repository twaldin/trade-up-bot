/**
 * @vitest-environment happy-dom
 *
 * Loading placeholders in the stats strip stay invisible, and a failed
 * /api/my-trade-ups load replaces the skeleton with dashes instead of leaving
 * a tall empty slot under the error.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewAccount } from "../../src/preview/pages/PreviewAccount.js";

const dir = dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(resolve(dir, "../../src/preview/kit/outlay/theme.css"), "utf8");
const preview = readFileSync(resolve(dir, "../../src/preview/preview.css"), "utf8")
  .replace('@import "./kit/outlay/theme.css";\n', "");
const css = `${theme}\n${preview}`;

const USER = {
  steam_id: "76561198000000001",
  display_name: "Ada",
  avatar_url: "",
  tier: "pro",
  is_admin: false,
};

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function painted(html: string) {
  return `<!doctype html><style>${css}</style>
    <style>html, body { margin: 0; }</style>
    <div data-preview data-system="outlay" data-mode="light" data-view="dashboard">${html}</div>`;
}

describe("account loading and error states", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;
  let browser: Browser;
  let server: ViteDevServer;
  let base = "";

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    server = await createServer({
      server: { host: "127.0.0.1", port: 5217, strictPort: false },
      logLevel: "error",
    });
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 5217;
    base = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  afterEach(() => {
    if (root && host) {
      act(() => root?.unmount());
      host.remove();
    }
    root = undefined;
    host = undefined;
    resetBrowseFetchState();
    vi.unstubAllGlobals();
  });

  async function mount() {
    const next = document.createElement("div");
    document.body.appendChild(next);
    host = next;
    const mounted = createRoot(next);
    root = mounted;
    await act(async () => {
      mounted.render(createElement(MemoryRouter, { initialEntries: ["/my-trade-ups"] }, createElement(PreviewAccount)));
    });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  }

  async function measure(page: Page, width: number, html: string) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await page.setContent(painted(html), { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
      const pending = [...document.querySelectorAll(".preview-stats .preview-account__pending")].map((node) => ({
        text: node.textContent ?? "",
        color: getComputedStyle(node).color,
      }));
      const slot = document.querySelector(".preview-account__slot");
      const notice = document.querySelector(".preview-account__slot .preview-notice");
      const slotRect = slot?.getBoundingClientRect();
      const noticeRect = notice?.getBoundingClientRect();
      const toolbar = document.querySelector(".preview-toolbar");
      const toolbarRect = toolbar?.getBoundingClientRect();
      const gap = noticeRect && toolbarRect ? toolbarRect.top - noticeRect.bottom : null;
      return {
        pending,
        slotHeight: slotRect ? slotRect.height : 0,
        gap,
        statsText: document.querySelector(".preview-stats")?.textContent ?? "",
      };
    });
  }

  it("paints loading placeholders in a transparent color", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, USER);
      await gate;
      return json(200, { trade_ups: [] });
    }));
    await mount();
    const page = await browser.newPage();
    const box = await measure(page, 390, host?.innerHTML ?? "");
    await page.close();
    expect(box.pending.map((row) => row.text)).toEqual(expect.arrayContaining(["00", "+$000.00", "00", "00%", "00.0%"]));
    for (const row of box.pending) {
      expect(row.color, row.text).toBe("rgba(0, 0, 0, 0)");
    }
    await act(async () => { release(); });
  });

  it.each([
    ["500", async () => json(500, { error: "nope" })],
    ["network", async () => { throw new Error("offline"); }],
  ] as const)("shows dashes and no tall gap when my trade-ups fail (%s)", async (_label, fail) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, USER);
      if (path.includes("/api/my-trade-ups/stats") || path.includes("my_claims=true")) return fail();
      return json(200, {});
    }));
    await mount();
    const view = host;
    expect(view).toBeTruthy();
    if (!view) return;
    const stats = view.querySelector(".preview-stats");
    expect(stats?.getAttribute("aria-busy")).toBe("false");
    expect(stats?.textContent).toContain("—");
    expect(stats?.textContent).not.toContain("00.0%");
    expect(view.textContent).toContain("Could not load trade-ups.");
    expect(view.querySelector(".preview-account__slot .preview-notice")).toBeTruthy();
    expect(view.querySelector(".preview-account__slot--quiet")).toBeTruthy();

    const page = await browser.newPage();
    for (const width of [360, 375, 390, 1280]) {
      const box = await measure(page, width, view.innerHTML);
      expect(box.slotHeight, String(width)).toBeLessThan(120);
      expect(box.gap ?? 0, String(width)).toBeLessThan(120);
    }
    await page.close();
  });

  async function deniedStats(width: number, user: { tier: string; lifetime?: boolean }, status: number) {
    const page = await browser.newPage();
    const height = width === 1280 ? 800 : 844;
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
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
    const fulfill = (request: HTTPRequest, code: number, body: string, wait: number) => {
      setTimeout(() => {
        void request.respond({ status: code, contentType: "application/json", body }).catch(() => undefined);
      }, wait);
    };
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) {
        void request.continue().catch(() => undefined);
        return;
      }
      if (path.startsWith("/api/auth/me")) {
        fulfill(request, 200, JSON.stringify({ ...USER, ...user }), 200);
        return;
      }
      if (path.startsWith("/api/my-trade-ups/stats")) {
        fulfill(request, status, "{}", 500);
        return;
      }
      if (path.includes("my_claims")) {
        fulfill(request, 200, JSON.stringify({ trade_ups: [] }), 500);
        return;
      }
      fulfill(request, 200, "{}", 0);
    });
    await page.goto(`${base}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 200 + 500 + 1200));
    const result = await page.evaluate(() => {
      const reader = Reflect.get(window, "__accountCls");
      const value: unknown = typeof reader === "function" ? reader() : 0;
      const stats = document.querySelector(".preview-stats");
      return {
        cls: typeof value === "number" ? value : 0,
        dash: (stats?.textContent ?? "").includes("—"),
        present: stats !== null,
      };
    });
    await page.close();
    return result;
  }

  it.each([
    ["401", { tier: "pro" }, 401],
    ["lifetime lag", { tier: "free", lifetime: true }, 403],
  ] as const)("keeps the strip and stays under 0.05 when stats return %s", async (_label, user, status) => {
    for (const width of [360, 375, 390, 1280]) {
      const result = await deniedStats(width, user, status);
      expect(result.cls, String(width)).toBeLessThan(0.05);
      expect(result.present, String(width)).toBe(true);
      expect(result.dash, String(width)).toBe(true);
    }
  }, 120_000);
});
