/**
 * @vitest-environment happy-dom
 *
 * The signed-in account page reserves the stats strip, tab bar, and list slot
 * before /api/my-trade-ups/stats and the claims list resolve, so those
 * responses cannot insert a block above content that has already painted.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewAccount } from "../../src/preview/pages/PreviewAccount.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const USER = {
  steam_id: "76561198000000001",
  display_name: "Ada",
  avatar_url: "",
  tier: "pro",
  is_admin: false,
};

const STATS = {
  all_time_profit_cents: 18420,
  total_executed: 6,
  total_sold: 4,
  win_count: 3,
  win_rate: 75,
  avg_roi: 12.4,
};

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

describe("account layout reservation", () => {
  let root: Root;
  let host: HTMLDivElement;

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
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  }

  it("paints the stats strip, tabs, and list slot before the payloads arrive", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, USER);
      if (path.includes("/api/my-trade-ups/stats") || path.includes("my_claims=true")) {
        await gate;
        if (path.includes("/stats")) return json(200, STATS);
        return json(200, { trade_ups: [] });
      }
      return json(200, { claims: [] });
    }));

    await mount();
    const stats = host.querySelector(".preview-stats");
    const tabs = host.querySelector(".preview-tabs");
    const slot = host.querySelector(".preview-account__slot");
    expect(stats).toBeTruthy();
    expect(stats?.querySelectorAll(":scope > div").length).toBe(4);
    expect(stats?.getAttribute("aria-busy")).toBe("true");
    expect(tabs?.getAttribute("role")).toBe("tablist");
    expect(tabs?.querySelectorAll("[role=tab]").length).toBe(3);
    expect(slot?.querySelector(".preview-empty")?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toContain("Sold at a profit");
    expect(host.textContent).toContain("All-time profit");
    expect(host.textContent).not.toContain("Win rate");
    expect(host.textContent).not.toContain("Checking session");
    expect(host.textContent).not.toContain("No active claims.");

    await act(async () => {
      release();
      await gate;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector(".preview-stats")).toBe(stats);
    expect(host.querySelector(".preview-tabs")).toBe(tabs);
    expect(host.textContent).toContain("Sold at a profit · 12.4% avg ROI");
    expect(host.textContent).toContain("No active claims.");
    expect(host.textContent).toContain("+$184.20");
    expect(host.querySelector(".preview-stats")?.getAttribute("aria-busy")).toBe("false");
    expect(slot?.querySelector(".preview-empty[aria-busy=true]")).toBeNull();
  });

  it("leaves the signed-out panel free of the reserved stats strip", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/auth/me")) return json(200, null);
      return json(200, {});
    }));
    await mount();
    expect(host.textContent).toContain("Sign in with Steam");
    expect(host.querySelector(".preview-stats")).toBeNull();
    expect(host.querySelector(".preview-account__slot")).toBeNull();
    expect(host.querySelector("[aria-busy=true]")).toBeNull();
    expect(host.querySelector(".preview-page--account")).toBeTruthy();
  });

  it.each(["free", "basic"])("keeps the stats strip off the page when %s is denied stats", async (tier) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, { ...USER, tier, display_name: "Bea" });
      if (path.includes("/api/my-trade-ups/stats") || path.includes("my_claims=true")) {
        await gate;
        return json(403, { error: "nope" });
      }
      return json(200, { claims: [] });
    }));
    await mount();
    expect(host.querySelector(".preview-stats")).toBeNull();
    expect(host.querySelector(".preview-stats[aria-busy=true]")).toBeNull();
    expect(host.textContent).not.toContain("00.0%");
    expect(host.textContent).not.toContain("+$000.00");

    await act(async () => { release(); });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(host.querySelector(".preview-stats")).toBeNull();
    expect(host.querySelector("[aria-busy=true]")).toBeNull();
    expect(host.textContent).not.toContain("00.0%");
  });

  it("keeps the reserved boxes in the account stylesheet", () => {
    const css = read("../../src/preview/preview.css");
    expect(css).toContain(".preview-page--account .preview-stats");
    expect(css).toContain(".preview-page--account .preview-tabs");
    expect(css).toContain(".preview-account__slot");
    expect(css).toMatch(/\.preview-page--account \.preview-stats \{[^}]*min-height:\s*162px/);
    expect(css).toMatch(/\.preview-page--account \.preview-tabs \{[^}]*min-height:\s*var\(--control\)/);
    expect(css).toMatch(/\.preview-account__slot \{[^}]*min-height:\s*420px/);
  });

  it("keeps the sold-trade-up label and does not gate the strip on stats", () => {
    const page = read("../../src/preview/pages/PreviewAccount.tsx");
    expect(page).toContain("Sold at a profit · {stats.avg_roi}% avg ROI");
    expect(page).not.toContain("Win rate");
    expect(page).toContain('user === undefined ? "Checking session…" : SIGN_IN_TO_CLAIM');
    expect(page).not.toContain("{user && stats &&");
    expect(page).toContain("const showChrome = user != null && !sessionHold;");
    expect(page).toContain("const showStats = showChrome && hasProAccess(user);");
  });

  it("hides Sign in with Steam while auth is still pending", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) {
        await gate;
        return json(200, USER);
      }
      return json(200, { trade_ups: [], claims: [] });
    }));
    await mount();
    const link = host.querySelector("a.preview-btn--block");
    expect(link?.textContent).toContain("Sign in with Steam");
    expect(getComputedStyle(link!).visibility).toBe("hidden");
    expect(link?.getAttribute("aria-hidden")).toBe("true");
    expect(link?.getAttribute("tabindex")).toBe("-1");
    expect(host.querySelector(".preview-panel .preview-note")?.textContent).toBe("Checking session…");
    expect(host.textContent).not.toContain("Verify and Claim are Pro features");

    await act(async () => { release(); });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(host.querySelector("a.preview-btn--block")).toBeNull();
    expect(host.textContent).not.toContain("Sign in with Steam");
    expect(host.textContent).not.toContain("Checking session");
    expect(host.querySelector(".preview-stats")).toBeTruthy();
  });
});
