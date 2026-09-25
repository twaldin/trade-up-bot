/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import { UNFILTERED_EMPTY_COPY } from "../../src/preview/lib/board-notice.js";
import { RATE_LIMIT_MANUAL_COPY, rateLimitCopy, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
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
    resetBrowseFetchState();
    urls.length = 0;
    window.history.replaceState({}, "", "/trade-ups");
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
    const added = urls.filter((url) => url.includes("/api/trade-ups?")).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("min_chance=50");
    expect(added.some((url) => url.includes("min_chance=") && !url.includes("min_chance=50"))).toBe(false);
  });

  it("sends one list request for a burst on the collection page too", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return listBody(1);
    }));
    window.history.replaceState({}, "", "/collections/kilowatt");
    function CollectionHarness() {
      api = usePreviewTradeUps({ collection: "The Kilowatt Collection", perPage: 6 });
      return null;
    }
    await mount(createElement(CollectionHarness));
    const lists = () => urls.filter((url) => url.includes("/api/trade-ups?"));
    const before = lists().length;
    await act(async () => {
      for (const value of ["10", "20", "30", "80", "90", "100"]) {
        api.onQuery({ ...DEFAULT_QUERY, minChance: value });
      }
    });
    expect(lists().length - before).toBe(0);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await act(async () => { await Promise.resolve(); });
    const added = lists().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("min_chance=100");
    expect(added[0]).toContain("collection=");
    expect(window.location.pathname).toBe("/collections/kilowatt");
    expect(window.location.search).toContain("min_chance=100");
  });

  it("aborts an in-flight list request once a later filter settles", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      if (init?.signal) signals.push(init.signal);
      if (String(url).includes("min_chance=10")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
      return listBody(1);
    }));
    await mount(createElement(Harness));
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "10" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    const first = signals.at(-1);
    expect(first?.aborted).toBe(false);
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "80" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await act(async () => { await Promise.resolve(); });
    expect(first?.aborted).toBe(true);
    const chanceUrls = urls.filter((url) => url.includes("min_chance="));
    expect(chanceUrls.filter((url) => url.includes("min_chance=80"))).toHaveLength(1);
    expect(chanceUrls.filter((url) => url.includes("min_chance=10"))).toHaveLength(1);
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
    expect(host.textContent).toContain(rateLimitCopy(30_000));
    expect(host.textContent).not.toContain("Loading trade-ups…");
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Retry")).toBe(false);
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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
    expect(lists, "list requests before the Retry button").toBe(2);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
    expect(host.textContent).not.toContain("Loading trade-ups…");

    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Retry"));
    await act(async () => { button?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const afterClick = lists;
    expect(afterClick).toBe(3);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(lists).toBeGreaterThan(afterClick);
  }, 15000);
});

describe("scoped board does not paint the global list", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    resetBrowseFetchState();
    urls.length = 0;
  });

  async function mount(node: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(node); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  function ScopeBoard({
    collection,
    skin,
    enabled,
  }: {
    collection?: string;
    skin?: string;
    enabled: boolean;
  }) {
    const api = usePreviewTradeUps({ collection, skin, perPage: 6, enabled });
    return createElement(MemoryRouter, null, createElement(PreviewBoard, {
      tradeUps: api.tradeUps,
      loading: api.loading,
      isFree: api.isFree,
      expandedId: api.expandedId,
      onExpand: api.onExpand,
      throttle: api.throttle,
      failed: api.failed,
      heading: skin ? "Trade-ups using this skin" : "from this collection",
    }));
  }

  function lists() {
    return urls.filter((url) => url.includes("/api/trade-ups?"));
  }

  it("the first skin list includes skin=, and a 429 leaves no global rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("skin=")) return limited();
      return listBody(6);
    }));
    let skin: string | undefined;
    let enabled = false;
    const paint = () => root.render(createElement(ScopeBoard, { skin, enabled }));
    await mount(createElement(ScopeBoard, { skin, enabled }));
    expect(lists()).toHaveLength(0);

    skin = "AK-47 | Redline";
    enabled = true;
    await act(async () => { paint(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(lists().length).toBeGreaterThan(0);
    expect(lists().every((url) => url.includes("skin="))).toBe(true);
    expect(host.querySelectorAll(".preview-card")).toHaveLength(0);
    expect(host.textContent).not.toContain("Showing the previous results");
  });

  it("the first collection list includes collection=, and a 429 leaves no global rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("collection=")) return limited();
      return listBody(6);
    }));
    let collection: string | undefined;
    let enabled = false;
    const paint = () => root.render(createElement(ScopeBoard, { collection, enabled }));
    await mount(createElement(ScopeBoard, { collection, enabled }));
    collection = "The Kilowatt Collection";
    enabled = true;
    await act(async () => { paint(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(lists().every((url) => url.includes("collection="))).toBe(true);
    expect(host.querySelectorAll(".preview-card")).toHaveLength(0);
  });

  it("switching collections does not flash the empty board", async () => {
    let release: (value: ReturnType<typeof limited>) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      const href = String(url);
      if (href.includes("collection=Beta")) return new Promise((resolve) => { release = resolve; });
      return listBody(2);
    }));
    let collection = "Alpha";
    const paint = () => root.render(createElement(ScopeBoard, { collection, enabled: true }));
    await mount(createElement(ScopeBoard, { collection, enabled: true }));
    expect(host.querySelectorAll(".preview-card").length).toBeGreaterThan(0);

    collection = "Beta";
    await act(async () => { paint(); });
    expect(host.textContent).not.toContain(UNFILTERED_EMPTY_COPY);
    expect(host.querySelectorAll(".preview-card")).toHaveLength(0);
    expect(lists().some((url) => url.includes("collection=Beta"))).toBe(true);
    expect(lists().some((url) => !url.includes("collection="))).toBe(false);

    await act(async () => { release(limited()); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelectorAll(".preview-card")).toHaveLength(0);
    expect(host.textContent).not.toContain(UNFILTERED_EMPTY_COPY);
  });
});
