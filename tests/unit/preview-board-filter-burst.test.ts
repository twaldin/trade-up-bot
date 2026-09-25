/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import { SLOW_DOWN_COPY } from "../../src/preview/lib/page-fetch.js";
import { PreviewBoard, usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";

const urls: string[] = [];

function listBody(count: number) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      trade_ups: Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        inputs: [{ skin_name: "In" }],
        outcomes: [{ skin_name: "Out" }],
        total_cost_cents: 100,
        expected_value_cents: 200,
        profit_cents: 100,
        roi_percentage: 10,
        created_at: "2026-01-01T00:00:00.000Z",
      })),
      total: count,
      tier: "pro",
    }),
  };
}

function limited() {
  return {
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "30" : null) },
    json: async () => { throw new Error("html"); },
  };
}

function BoardHarness() {
  const api = usePreviewTradeUps({ perPage: 12 });
  return createElement(PreviewBoard, {
    tradeUps: api.tradeUps,
    loading: api.loading,
    isFree: api.isFree,
    expandedId: api.expandedId,
    onExpand: api.onExpand,
    query: api.query,
    onQuery: api.onQuery,
    throttle: api.throttle,
    retryReady: api.retryReady,
    failed: api.failed,
    onRetry: api.retry,
    onClearFilters: api.clearFilters,
  });
}

describe("board filter bursts", () => {
  let root: Root;
  let host: HTMLDivElement;
  let api: ReturnType<typeof usePreviewTradeUps>;

  function Harness() {
    api = usePreviewTradeUps({ perPage: 12 });
    return null;
  }

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    urls.length = 0;
  });

  async function mount(node: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(node); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("sends at most two list requests for ten rapid min-chance changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return listBody(2);
    }));
    await mount(createElement(Harness));
    const before = urls.filter((url) => url.includes("/api/trade-ups?")).length;

    await act(async () => {
      for (let i = 1; i <= 10; i += 1) {
        api.onQuery({ ...DEFAULT_QUERY, minChance: String(i * 5) });
      }
    });
    const during = urls.filter((url) => url.includes("/api/trade-ups?")).length - before;
    const detailsDuring = urls.filter((url) => url.includes("/inputs") || url.includes("/outcomes")).length;
    expect(during).toBe(0);
    expect(detailsDuring).toBe(0);

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await act(async () => { await Promise.resolve(); });
    const after = urls.filter((url) => url.includes("/api/trade-ups?")).length - before;
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(2);
    expect(urls.filter((url) => url.includes("min_chance=50"))).toHaveLength(1);
  });

  it("sends one list request for a settled min-chance of 80, after the warm first page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return listBody(2);
    }));
    await mount(createElement(Harness));
    const lists = () => urls.filter((url) => url.includes("/api/trade-ups?") && url.includes("per_page=12"));
    expect(lists()[0]).toBe("/api/trade-ups?per_page=12&sort=trade_up_score&order=desc&page=1&include=outcomes,inputs");
    const before = lists().length;

    await act(async () => {
      api.onQuery({ ...DEFAULT_QUERY, minChance: "8" });
      api.onQuery({ ...DEFAULT_QUERY, minChance: "80" });
    });
    expect(lists().length - before).toBe(0);

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await act(async () => { await Promise.resolve(); });
    const settled = lists().slice(before);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toContain("min_chance=80");
    expect(settled[0]).toContain("per_page=12");
    expect(settled[0]).toContain("include=outcomes,inputs");
  });

  it("renders the slow-down notice after a 429 instead of the loading spinner", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("/api/trade-ups?")) return limited();
      return listBody(0);
    }));
    await mount(createElement(BoardHarness));
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain(SLOW_DOWN_COPY);
    expect(host.textContent).not.toContain("Loading trade-ups…");
    expect(host.textContent).not.toContain("Retry");
  });

  it("shows Retry after the automatic retry is also limited, then auto-retries a later 429", async () => {
    let lists = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (!String(url).includes("/api/trade-ups?")) return listBody(0);
      lists += 1;
      return {
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
        json: async () => { throw new Error("html"); },
      };
    }));
    await mount(createElement(BoardHarness));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(lists, "list requests before the Retry button").toBe(2);
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).not.toContain("Loading trade-ups…");

    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Retry"));
    await act(async () => { button?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const afterClick = lists;
    expect(afterClick).toBe(3);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(lists).toBeGreaterThan(afterClick);
  });
});
