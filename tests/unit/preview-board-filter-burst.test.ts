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
  });
});
