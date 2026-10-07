/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_PAINT_WAIT_MS, shouldFetchBoardDelay } from "../../src/preview/lib/board-delay.js";
import { resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewBoard, usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";
import { makeTradeUp } from "../helpers/fixtures.js";
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
    localStorage.clear();
    document.cookie = "connect.sid=; Max-Age=0";
    window.__tubCheckoutReturn = null;
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
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();

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

  it("keeps the reserved row in the skeleton grid once a guest session resolves", async () => {
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
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-bento > .preview-delay")).not.toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
    expect(host.textContent).toContain("Common questions");
    expect(host.textContent).not.toContain(GAP_SENTENCE);
  });

  it("keeps the skeleton grid and the FAQ while auth is unknown", async () => {
    localStorage.clear();
    document.cookie = "connect.sid=; Max-Age=0";
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      return new Promise<Response>(() => {});
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
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
    expect(host.textContent).toContain("Common questions");
  });

  it("still reserves the skeleton row when a session cookie is present and the tier is unknown", async () => {
    localStorage.clear();
    document.cookie = "connect.sid=paid-session";
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      return new Promise<Response>(() => {});
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
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
  });

  it("paints a stored paid tier with no hold and collapses an optimistic hold once auth says paid", async () => {
    localStorage.setItem("tub_board_account", JSON.stringify({ tier: "pro" }));
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      return new Promise<Response>(() => {});
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
    expect(host.querySelector(".preview-delay")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
  });

  it("does not paint a hold for an unknown account that resolves to paid", async () => {
    localStorage.clear();
    document.cookie = "connect.sid=; Max-Age=0";
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) {
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return new Promise<Response>(() => {});
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
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();

    await act(async () => {
      release(authBody("pro"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-card:not(.preview-card--skeleton)")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
    expect(delayCalls()).toEqual([]);
    expect(localStorage.getItem("tub_board_account")).toBe(JSON.stringify({ tier: "pro" }));
  });

  it("keeps the banner in the skeleton grid when an unknown account is a guest", async () => {
    localStorage.clear();
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) {
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return new Promise<Response>(() => {});
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
    const before = host.querySelector(".preview-card--skeleton")?.getBoundingClientRect().top ?? null;
    await act(async () => {
      release(authBody(null));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.querySelector(".preview-delay--cover")).toBeNull();
    expect(host.querySelector(".preview-bento > .preview-delay")).not.toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
    expect(host.textContent).toContain("Common questions");
    expect(host.querySelector(".preview-card--skeleton")?.getBoundingClientRect().top ?? null).toBe(before);
    expect(localStorage.getItem("tub_board_account")).toBe("null");
  });

  it("does not insert the hold when a stored pro account gets a 401", async () => {
    localStorage.setItem("tub_board_account", JSON.stringify({ tier: "pro" }));
    localStorage.setItem("site_nav_user", JSON.stringify({ tier: "pro", steam_id: "765" }));
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) {
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return new Promise<Response>(() => {});
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
    expect(host.querySelector(".preview-delay")).toBeNull();
    await act(async () => {
      release(authBody(null));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector(".preview-delay")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
    expect(delayCalls()).toEqual([]);
    expect(localStorage.getItem("tub_board_account")).toBe("null");
    expect(localStorage.getItem("site_nav_user")).toBeNull();
  });

  const row = {
    id: 1,
    inputs: [{ skin_name: "In" }],
    outcomes: [{ skin_name: "Out" }],
    total_cost_cents: 100,
    expected_value_cents: 200,
    profit_cents: 100,
    roi_percentage: 10,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("puts the banner above the first card once a guest list arrives", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) return Promise.resolve(authBody(null));
      if (String(url).includes("/api/trade-ups")) {
        return Promise.resolve(json({ trade_ups: [row], total: 1, tier: "free", signed_in: false }));
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
    const bento = host.querySelector(".preview-bento");
    const first = bento?.firstElementChild;
    expect(first?.classList.contains("preview-delay")).toBe(true);
    expect(first?.classList.contains("preview-delay--cover")).toBe(false);
    expect(first?.classList.contains("preview-delay--hold")).toBe(false);
    expect(bento?.querySelector(".preview-card:not(.preview-card--skeleton)")).not.toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).toBeNull();
  });

  it("drops the reserve when a saved free account is now pro", async () => {
    localStorage.setItem("tub_board_account", JSON.stringify({ tier: "free" }));
    localStorage.setItem("site_nav_user", JSON.stringify({ tier: "free", steam_id: "765" }));
    let releaseAuth: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes("/api/auth/me")) {
        return new Promise<Response>((resolve) => { releaseAuth = resolve; });
      }
      if (String(url).includes("/api/trade-ups")) {
        return Promise.resolve(json({ trade_ups: [row], total: 1, tier: "pro", signed_in: true }));
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
    expect(host.querySelector(".preview-delay--hold")).not.toBeNull();
    expect(host.querySelector(".preview-card:not(.preview-card--skeleton)")).toBeNull();

    await act(async () => {
      releaseAuth(authBody("pro"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector(".preview-delay")).toBeNull();
    expect(host.querySelector(".preview-card:not(.preview-card--skeleton)")).not.toBeNull();
    expect(localStorage.getItem("tub_board_account")).toBe(JSON.stringify({ tier: "pro" }));
    expect(JSON.parse(localStorage.getItem("site_nav_user") ?? "{}").tier).toBe("pro");
  });

  it("paints the guest list in flow when auth is still pending after the wait", async () => {
    vi.useFakeTimers();
    try {
      localStorage.clear();
      vi.stubGlobal("fetch", vi.fn((url: string) => {
        calls.push(String(url));
        return new Promise<Response>(() => {});
      }));
      await mount(createElement(MemoryRouter, null, createElement(PreviewBoard, {
        tradeUps: [makeTradeUp({ id: 1 })],
        loading: false,
        isFree: true,
        expandedId: null,
        onExpand: () => {},
      })));
      expect(host.querySelector(".preview-card:not(.preview-card--skeleton)")).toBeNull();
      expect(host.querySelector(".preview-delay--hold")).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTH_PAINT_WAIT_MS);
      });
      const bento = host.querySelector(".preview-bento");
      const first = bento?.firstElementChild;
      expect(host.querySelector(".preview-card--skeleton")).toBeNull();
      expect(first?.classList.contains("preview-delay")).toBe(true);
      expect(first?.classList.contains("preview-delay--hold")).toBe(false);
      expect(first?.classList.contains("preview-delay--cover")).toBe(false);
      expect(bento?.querySelector(".preview-card:not(.preview-card--skeleton)")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the guest banner and appends paid rows underneath", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("tub_board_account", JSON.stringify({ tier: "free" }));
      const freeRow = {
        ...row,
        id: 1,
        inputs: [{ skin_name: "Free Skin" }],
        outcomes: [{ skin_name: "Free Out" }],
      };
      const paidRow = {
        ...row,
        id: 2,
        inputs: [{ skin_name: "Paid Skin" }],
        outcomes: [{ skin_name: "Paid Out" }],
      };
      let releaseAuth: (value: Response) => void = () => {};
      let listCalls = 0;
      vi.stubGlobal("fetch", vi.fn((url: string) => {
        calls.push(String(url));
        if (String(url).includes("/api/auth/me")) {
          return new Promise<Response>((resolve) => { releaseAuth = resolve; });
        }
        if (String(url).includes("/api/trade-ups")) {
          listCalls += 1;
          const rows = listCalls === 1 ? [freeRow] : [freeRow, paidRow];
          return Promise.resolve(json({
            trade_ups: rows,
            total: rows.length,
            tier: listCalls === 1 ? "free" : "pro",
            signed_in: listCalls > 1,
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
          onPaidTail: api.appendPaidTail,
        }));
      }

      await mount(createElement(Harness));
      expect(host.querySelector(".preview-card:not(.preview-card--skeleton)")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTH_PAINT_WAIT_MS);
      });
      expect(host.textContent).toContain("Free Skin");
      expect(host.textContent).not.toContain("Paid Skin");
      expect(host.querySelector(".preview-bento > .preview-delay:not(.preview-delay--hold)")).not.toBeNull();

      await act(async () => {
        releaseAuth(authBody("pro"));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const cards = [...host.querySelectorAll(".preview-card:not(.preview-card--skeleton)")];
      expect(host.querySelector(".preview-delay")).not.toBeNull();
      expect(host.querySelector(".preview-delay--hold")).toBeNull();
      expect(cards).toHaveLength(2);
      expect(cards[0]?.textContent).toContain("Free Skin");
      expect(cards[1]?.textContent).toContain("Paid Skin");
      const text = host.textContent ?? "";
      expect(text.indexOf("Free Skin")).toBeLessThan(text.indexOf("Paid Skin"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("paints a confirmed checkout as paid before auth answers", async () => {
    localStorage.setItem("tub_board_account", JSON.stringify({ tier: "free" }));
    localStorage.setItem("site_nav_user", JSON.stringify({ tier: "free", steam_id: "765" }));
    window.__tubCheckoutReturn = { upgraded: "1", sessionId: "cs_test" };
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      calls.push(String(url));
      return new Promise<Response>(() => {});
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
    expect(host.querySelector(".preview-delay")).toBeNull();
    expect(host.querySelector(".preview-card--skeleton")).not.toBeNull();
    expect(localStorage.getItem("tub_board_account")).toBe(JSON.stringify({ tier: "pro" }));
    expect(JSON.parse(localStorage.getItem("site_nav_user") ?? "{}").tier).toBe("pro");
    window.__tubCheckoutReturn = null;
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
