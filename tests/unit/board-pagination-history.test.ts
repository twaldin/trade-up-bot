/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import { END_OF_LIST_COPY } from "../../src/preview/lib/board-notice.js";
import { RATE_LIMIT_MANUAL_COPY, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewBoard, usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";

type Api = ReturnType<typeof usePreviewTradeUps>;

function row(id: number) {
  return {
    id,
    inputs: [{ skin_name: "In" }],
    outcomes: [{ skin_name: "Out" }],
    total_cost_cents: 100,
    expected_value_cents: 200,
    profit_cents: 100,
    roi_percentage: 10,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function ok(ids: number[], total = 36) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ trade_ups: ids.map(row), total, tier: "pro" }),
  };
}

function limited(retryAfter = "0") {
  return {
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => { throw new Error("html"); },
  };
}

function BoardHarness({ onReady }: { onReady: (api: Api) => void }) {
  const api = usePreviewTradeUps({ perPage: 12 });
  onReady(api);
    return createElement(MemoryRouter, null, createElement(PreviewBoard, {
    tradeUps: api.tradeUps,
    loading: api.loading,
    loadingMore: api.loadingMore,
    isFree: api.isFree,
    expandedId: api.expandedId,
    onExpand: api.onExpand,
    query: api.query,
    onQuery: api.onQuery,
    search: api.search,
    onSearch: api.onSearch,
    loadMore: api.loadMore,
    exhausted: api.exhausted,
    throttle: api.throttle,
    retryReady: api.retryReady,
    failed: api.failed,
    onRetry: api.retry,
  }));
}

describe("board pagination and history", () => {
  let root: Root;
  let host: HTMLDivElement;
  let api: Api;
  const urls: string[] = [];

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetBrowseFetchState();
    vi.unstubAllGlobals();
    urls.length = 0;
    window.history.replaceState({}, "", "/");
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(BoardHarness, { onReady: (next) => { api = next; } }));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  function paint() {
    act(() => {
      root.render(createElement(BoardHarness, { onReady: (next) => { api = next; } }));
    });
  }

  it("keeps page-1 rows and shows the manual notice after a page-2 429", async () => {
    let page2 = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      const page = new URL(String(url), "http://local").searchParams.get("page");
      if (page === "2") {
        page2 += 1;
        return limited("0");
      }
      return ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }));
    window.history.replaceState({}, "", "/trade-ups?sort=profit");
    await mount();
    expect(api.tradeUps).toHaveLength(12);
    await act(async () => { api.loadMore(); });
    paint();
    await act(async () => { await Promise.resolve(); });
    expect(api.tradeUps).toHaveLength(12);
    expect(host.textContent).toContain("Too many requests right now.");
    expect(host.textContent).not.toMatch(/Loading more trade-ups/);
    const deadline = Date.now() + 4000;
    let retry: HTMLButtonElement | undefined;
    while (Date.now() < deadline) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
      paint();
      retry = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Retry"));
      if (retry) break;
    }
    expect(page2).toBeGreaterThanOrEqual(2);
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toMatch(/Loading more trade-ups/);
    expect(retry).toBeTruthy();
    expect(api.tradeUps).toHaveLength(12);
    const pages = urls.map((url) => new URL(url, "http://local").searchParams.get("page"));
    expect(pages.filter((page) => page === "2").length).toBe(page2);
    expect(pages).not.toContain("3");
  }, 12000);

  it("shows the end of the list when the next page is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const page = new URL(String(url), "http://local").searchParams.get("page");
      if (page === "2") return ok([], 12);
      return ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 12);
    }));
    window.history.replaceState({}, "", "/trade-ups?sort=profit");
    await mount();
    await act(async () => { api.loadMore(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    paint();
    expect(host.textContent).toContain(END_OF_LIST_COPY);
    expect(host.textContent).not.toMatch(/Loading more trade-ups/);
    expect(api.tradeUps).toHaveLength(12);
  });

  it("stops when a later page repeats the same ids", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 48);
    }));
    window.history.replaceState({}, "", "/trade-ups?sort=profit");
    await mount();
    await act(async () => { api.loadMore(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    paint();
    expect(api.tradeUps).toHaveLength(12);
    expect(host.textContent).toContain(END_OF_LIST_COPY);
    expect(calls.filter((url) => url.includes("page=3"))).toHaveLength(0);
  });

  it("pushes committed filters and restores them on Back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/trade-ups");
    await mount();
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, sort: "profit" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    paint();
    expect(window.location.search).toContain("sort=profit");
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, sort: "profit", minChance: "8" }); });
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, sort: "profit", minChance: "80" }); });
    expect(window.location.search).toContain("min_chance=80");
    const lengthAtTyped = window.history.length;
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, sort: "profit", minChance: "81" }); });
    expect(window.history.length).toBe(lengthAtTyped);
    window.history.back();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    paint();
    expect(window.location.search).toContain("sort=profit");
    expect(window.location.search).not.toContain("min_chance");
    expect(api.query.sort).toBe("profit");
    expect(api.query.minChance).toBe("");
    window.history.forward();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    paint();
    expect(api.query.minChance).toBe("81");
    expect(window.location.search).toContain("min_chance=81");
  });

  it("reads collection filters from the URL on a fresh tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return ok([1], 1);
    }));
    window.history.replaceState({}, "", "/collections/kilowatt?min_chance=80&max_cost=5000&sort=profit");
    await mount();
    expect(api.query.minChance).toBe("80");
    expect(api.query.maxCost).toBe("50");
    expect(api.query.sort).toBe("profit");
    expect(urls.some((url) => url.includes("min_chance=80") && url.includes("sort=profit"))).toBe(true);
  });
});
