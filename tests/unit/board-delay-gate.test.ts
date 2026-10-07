/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldFetchBoardDelay } from "../../src/preview/lib/board-delay.js";
import { resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewBoard, usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";
import { PreviewIntent } from "../../src/preview/pages/PreviewIntent.js";
import { PreviewPricing } from "../../src/preview/pages/PreviewPricing.js";

const GAP = {
  delay_seconds: 10800,
  hidden_profitable: 2,
  best_hidden_profit_cents: 1840,
};
const GAP_SENTENCE = "2 profitable listing combos turned up in the last 3 hours. Free sees new finds after a 3-hour delay. The best is +$18.40 expected P/L.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authBody(tier: string | null) {
  if (tier === null) return json({ error: "anonymous" }, 401);
  return json({ steam_id: "765", tier, lifetime: false });
}

describe("shouldFetchBoardDelay", () => {
  it("waits while auth is unresolved and skips every tier that is not free", () => {
    expect(shouldFetchBoardDelay(undefined)).toBe(false);
    expect(shouldFetchBoardDelay(null)).toBe(true);
    expect(shouldFetchBoardDelay({ tier: "free" })).toBe(true);
    expect(shouldFetchBoardDelay({ tier: "pro" })).toBe(false);
    expect(shouldFetchBoardDelay({ tier: "basic" })).toBe(false);
    expect(shouldFetchBoardDelay({ tier: "admin" })).toBe(false);
    expect(shouldFetchBoardDelay({ tier: "free", lifetime: true })).toBe(false);
  });
});

describe("board delay fetch waits for the viewer", () => {
  let root: Root;
  let host: HTMLDivElement;
  const calls: string[] = [];

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    resetBrowseFetchState();
    calls.length = 0;
    window.history.replaceState({}, "", "/trade-ups");
  });

  async function mount(node: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(node); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  function delayCalls(): string[] {
    return calls.filter((url) => url.includes("/api/board-delay"));
  }

  it("does not reserve or request the gap for a paid account while the list is loading", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) return Promise.resolve(authBody("pro"));
      if (String(url).includes("/api/trade-ups")) {
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Promise.resolve(json(GAP));
    }));

    function Harness() {
      const api = usePreviewTradeUps({ perPage: 12 });
      return createElement(MemoryRouter, null, createElement(PreviewBoard, {
        tradeUps: api.tradeUps,
        loading: api.loading,
        isFree: api.isFree,
        expandedId: api.expandedId,
        onExpand: api.onExpand,
      }));
    }

    await mount(createElement(Harness));
    expect(delayCalls()).toEqual([]);
    expect(host.textContent).not.toContain(GAP_SENTENCE);
    expect(host.querySelector(".preview-delay")).toBeNull();

    await act(async () => {
      release(json({
        trade_ups: [],
        total: 0,
        tier: "pro",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toEqual([]);
    expect(host.textContent).not.toContain(GAP_SENTENCE);
    expect(host.textContent).not.toContain("Free tier");
  });

  it("reserves the slot for a guest before the list returns", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) return Promise.resolve(authBody(null));
      if (String(url).includes("/api/trade-ups") || String(url).includes("/api/board-delay")) {
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(json(GAP));
    }));

    function Harness() {
      const api = usePreviewTradeUps({ perPage: 12 });
      return createElement(MemoryRouter, null, createElement(PreviewBoard, {
        tradeUps: api.tradeUps,
        loading: api.loading,
        isFree: api.isFree,
        expandedId: api.expandedId,
        onExpand: api.onExpand,
      }));
    }

    await mount(createElement(Harness));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toHaveLength(1);
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.textContent).not.toContain(GAP_SENTENCE);
  });

  it("loads the gap once the board list reports a free viewer", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/trade-ups")) {
        return Promise.resolve(json({
          trade_ups: [{
            id: 1,
            inputs: [{ skin_name: "In" }],
            outcomes: [{ skin_name: "Out" }],
            total_cost_cents: 100,
            expected_value_cents: 200,
            profit_cents: 100,
            roi_percentage: 10,
            created_at: "2026-01-01T00:00:00.000Z",
          }],
          total: 1,
          tier: "free",
        }));
      }
      return Promise.resolve(json(GAP));
    }));

    function Harness() {
      const api = usePreviewTradeUps({ perPage: 12 });
      return createElement(MemoryRouter, null, createElement(PreviewBoard, {
        tradeUps: api.tradeUps,
        loading: api.loading,
        isFree: api.isFree,
        expandedId: api.expandedId,
        onExpand: api.onExpand,
      }));
    }

    await mount(createElement(Harness));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toHaveLength(1);
    expect(host.textContent).toContain(GAP_SENTENCE);
  });

  it("keeps pricing quiet until auth resolves, then skips the gap for Pro", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) {
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Promise.resolve(json(GAP));
    }));

    await mount(createElement(MemoryRouter, null, createElement(PreviewPricing)));
    expect(delayCalls()).toEqual([]);
    expect(host.textContent).not.toContain(GAP_SENTENCE);

    await act(async () => {
      release(authBody("pro"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toEqual([]);
    expect(host.textContent).not.toContain(GAP_SENTENCE);
    expect(host.textContent).not.toContain("listing combos turned up");
  });

  it("shows the pricing gap after a free or logged-out session resolves", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) return Promise.resolve(authBody(null));
      return Promise.resolve(json(GAP));
    }));

    await mount(createElement(MemoryRouter, null, createElement(PreviewPricing)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toHaveLength(1);
    expect(host.textContent).toContain(GAP_SENTENCE);
  });

  it("hides the SEO gap sentence for Pro and still names the free delay", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) {
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Promise.resolve(json({
        trade_ups: [],
        active_trade_ups: 10,
        active_profitable_trade_ups: 4,
        ...GAP,
      }));
    }));

    window.history.replaceState({}, "", "/best-cs2-trade-ups");
    await mount(createElement(MemoryRouter, { initialEntries: ["/best-cs2-trade-ups"] }, createElement(PreviewIntent)));
    expect(delayCalls()).toEqual([]);

    await act(async () => {
      release(authBody("pro"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toEqual([]);
    expect(host.textContent).not.toContain(GAP_SENTENCE);
    expect(host.textContent).toContain("Open the board");
    expect(host.textContent).toContain("The free view is delayed 3 hours.");
    expect(host.textContent).not.toContain("Open the live board");
  });

  it("shows the SEO gap sentence once a logged-out session resolves", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) return Promise.resolve(authBody("free"));
      return Promise.resolve(json({
        trade_ups: [],
        active_trade_ups: 10,
        active_profitable_trade_ups: 4,
        ...GAP,
      }));
    }));

    window.history.replaceState({}, "", "/best-cs2-trade-ups");
    await mount(createElement(MemoryRouter, { initialEntries: ["/best-cs2-trade-ups"] }, createElement(PreviewIntent)));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(delayCalls()).toHaveLength(1);
    expect(host.textContent).toContain(GAP_SENTENCE);
    expect(host.textContent).toContain("Open the board");
    expect(host.textContent).not.toContain("Open the live board");
  });
});
