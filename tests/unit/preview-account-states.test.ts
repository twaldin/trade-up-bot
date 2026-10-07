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
import puppeteer, { type Browser, type Page } from "puppeteer";
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
  let root: Root;
  let host: HTMLDivElement;
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetBrowseFetchState();
    vi.unstubAllGlobals();
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/my-trade-ups"] }, createElement(PreviewAccount)));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
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
    const box = await measure(page, 390, host.innerHTML);
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
    const stats = host.querySelector(".preview-stats");
    expect(stats?.getAttribute("aria-busy")).toBe("false");
    expect(stats?.textContent).toContain("—");
    expect(stats?.textContent).not.toContain("00.0%");
    expect(host.textContent).toContain("Could not load trade-ups.");
    expect(host.querySelector(".preview-account__slot .preview-notice")).toBeTruthy();
    expect(host.querySelector(".preview-account__slot--quiet")).toBeTruthy();

    const page = await browser.newPage();
    for (const width of [360, 375, 390, 1280]) {
      const box = await measure(page, width, host.innerHTML);
      expect(box.slotHeight, String(width)).toBeLessThan(120);
      expect(box.gap ?? 0, String(width)).toBeLessThan(120);
    }
    await page.close();
  });
});
