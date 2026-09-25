/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import { END_OF_LIST_COPY, LIST_CAP_COPY } from "../../src/preview/lib/board-notice.js";
import { RATE_LIMIT_MANUAL_COPY, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewBoard, usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";
import { PreviewCollectionPage } from "../../src/preview/pages/PreviewSkins.js";

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

function ScopeHarness({ collection, onReady }: { collection: string; onReady: (api: Api) => void }) {
  const next = usePreviewTradeUps({ collection, perPage: 12 });
  onReady(next);
  return null;
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
    endKind: api.endKind,
    throttle: api.throttle,
    pagingThrottle: api.pagingThrottle,
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

  it("shows Load more while idle and the loading line only while page 2 is in flight", async () => {
    let release: (value: ReturnType<typeof ok>) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const page = new URL(String(url), "http://local").searchParams.get("page");
      if (page === "2") return new Promise<ReturnType<typeof ok>>((resolve) => { release = resolve; });
      return ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 36);
    }));
    window.history.replaceState({}, "", "/trade-ups?sort=profit");
    await mount();
    paint();
    expect(host.textContent).toContain("Load more");
    expect(host.textContent).not.toMatch(/Loading more trade-ups/);
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Load more");
    await act(async () => { button?.click(); });
    paint();
    expect(host.textContent).toMatch(/Loading more trade-ups/);
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Load more")).toBe(false);
    await act(async () => { release(ok([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], 36)); });
    await act(async () => { await Promise.resolve(); });
    paint();
    expect(api.tradeUps).toHaveLength(24);
    expect(host.textContent).toContain("Load more");
  });

  it("uses the cap line when a full page reaches the count ceiling, and the end line on a short page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/trade-ups");
    await mount();
    const sample = api.tradeUps[0];
    const paintKind = (endKind: "end" | "capped") => {
      root.render(createElement(MemoryRouter, null, createElement(PreviewBoard, {
        tradeUps: sample ? [sample] : [],
        loading: false,
        isFree: false,
        expandedId: null,
        onExpand: () => {},
        loadMore: () => {},
        exhausted: true,
        endKind,
      })));
    };
    act(() => { paintKind("end"); });
    expect(host.textContent).toContain(END_OF_LIST_COPY);
    expect(host.textContent).not.toContain(LIST_CAP_COPY);
    act(() => { paintKind("capped"); });
    expect(host.textContent).toContain(LIST_CAP_COPY);
    expect(host.textContent).not.toContain(END_OF_LIST_COPY);
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

  async function leavesOnOneBack(url: string) {
    if (root) act(() => { root.unmount(); });
    host?.remove();
    vi.stubGlobal("fetch", vi.fn(async () => ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 36)));
    window.history.replaceState({}, "", "/elsewhere");
    window.history.pushState({}, "", url);
    const length = window.history.length;
    await mount();
    expect(window.history.length).toBe(length);
    window.history.back();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    paint();
    expect(window.location.pathname).toBe("/elsewhere");
  }

  it("replaces a non-canonical landing URL so one Back leaves", async () => {
    await leavesOnOneBack("/trade-ups?sort=profit&utm_source=google");
    expect(window.location.pathname).toBe("/elsewhere");
  });

  it("replaces param-order, sort alias, and clamped chance without a history entry", async () => {
    await leavesOnOneBack("/trade-ups?sort=profit&min_chance=80");
    await leavesOnOneBack("/trade-ups?sort=score");
    await leavesOnOneBack("/trade-ups?min_chance=150");
    await leavesOnOneBack("/collections/kilowatt?sort=profit&min_chance=80");
  });

  it("hides Load more during the first page load and a filter refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    window.history.replaceState({}, "", "/trade-ups");
    await mount();
    paint();
    expect(host.textContent).toContain("Loading trade-ups…");
    expect(host.textContent).not.toContain("Load more");
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(PreviewBoard, {
        tradeUps: [row(1)] as Api["tradeUps"],
        loading: true,
        loadingMore: false,
        isFree: false,
        expandedId: null,
        onExpand: () => {},
        loadMore: () => {},
      })));
    });
    expect(host.textContent).not.toContain("Load more");
  });

  it("puts a later-page 429 in the bottom status and not a second notice", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const page = new URL(String(url), "http://local").searchParams.get("page");
      if (page === "2") return limited("30");
      return ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 36);
    }));
    window.history.replaceState({}, "", "/trade-ups?sort=profit");
    await mount();
    await act(async () => { api.loadMore(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    paint();
    const statuses = [...host.querySelectorAll("[role='status']")];
    const withCopy = statuses.filter((node) => node.textContent?.includes(RATE_LIMIT_MANUAL_COPY) || node.textContent?.includes("Too many requests"));
    expect(withCopy).toHaveLength(1);
    expect(withCopy[0]?.classList.contains("preview-sentinel")).toBe(true);
    expect(host.querySelector(".preview-sentinel")?.textContent).toContain("Too many requests");
  });

  it("pushes a later edit of the same field after the debounce burst", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/trade-ups");
    await mount();
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "8" }); });
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "80" }); });
    const lengthAtBurst = window.history.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)); });
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "81" }); });
    expect(window.history.length).toBe(lengthAtBurst + 1);
    expect(window.location.search).toContain("min_chance=81");
  });

  it("reloads filters from the URL when the collection scope changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/collections/kilowatt?min_chance=80");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(ScopeHarness, { collection: "Kilowatt", onReady: (next) => { api = next; } }));
    });
    expect(api.query.minChance).toBe("80");
    window.history.pushState({}, "", "/collections/gallery");
    await act(async () => {
      root.render(createElement(ScopeHarness, { collection: "Gallery", onReady: (next) => { api = next; } }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(api.query.minChance).toBe("");
    expect(window.location.pathname).toBe("/collections/gallery");
    expect(window.location.search).not.toContain("min_chance");
  });

  it("pushes collection-page filter edits and restores them on Back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/collections/kilowatt");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(ScopeHarness, { collection: "The Kilowatt Collection", onReady: (next) => { api = next; } }));
    });
    const lengthAtStart = window.history.length;
    await act(async () => {
      api.onQuery({ ...DEFAULT_QUERY, minChance: "80", maxCost: "50", sort: "profit" });
    });
    expect(window.location.pathname).toBe("/collections/kilowatt");
    expect(window.location.search).toContain("min_chance=80");
    expect(window.location.search).toContain("max_cost=5000");
    expect(window.location.search).toContain("sort=profit");
    expect(window.history.length).toBe(lengthAtStart + 1);
    window.history.back();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(api.query.minChance).toBe("");
    expect(api.query.sort).toBe("trade_up_score");
    expect(window.location.search).toBe("");
    window.history.forward();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(api.query.minChance).toBe("80");
    expect(api.query.maxCost).toBe("50");
    expect(api.query.sort).toBe("profit");
  });

  it("keeps a deep-linked collection filter when the collection name resolves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/collections/kilowatt?min_chance=80&max_cost=5000&sort=profit");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness({ collection }: { collection?: string }) {
      const next = usePreviewTradeUps({ collection, perPage: 6, enabled: Boolean(collection) });
      api = next;
      return null;
    }
    await act(async () => {
      root.render(createElement(Harness, {}));
    });
    expect(api.query.minChance).toBe("80");
    await act(async () => {
      root.render(createElement(Harness, { collection: "The Kilowatt Collection" }));
    });
    expect(api.query.minChance).toBe("80");
    expect(api.query.maxCost).toBe("50");
    expect(api.query.sort).toBe("profit");
    expect(window.location.search).toContain("min_chance=80");
    expect(window.history.length).toBeGreaterThan(0);
  });

  it("resets the typing-history burst on blur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([1], 1)));
    window.history.replaceState({}, "", "/trade-ups");
    await mount();
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "8" }); });
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "80" }); });
    const lengthAtBurst = window.history.length;
    await act(async () => { api.onFilterBlur(); });
    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "81" }); });
    expect(window.history.length).toBe(lengthAtBurst + 1);
  });

  it("keeps Load more focusable while a page is in flight", async () => {
    let release: (value: ReturnType<typeof ok>) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const page = new URL(String(url), "http://local").searchParams.get("page");
      if (page === "2") return new Promise<ReturnType<typeof ok>>((resolve) => { release = resolve; });
      return ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 36);
    }));
    window.history.replaceState({}, "", "/trade-ups?sort=profit");
    await mount();
    paint();
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Load more");
    expect(button).toBeTruthy();
    expect(button?.getAttribute("disabled")).toBeNull();
    button?.focus();
    await act(async () => { button?.click(); });
    paint();
    const loading = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Loading more"));
    expect(loading?.getAttribute("aria-disabled")).toBe("true");
    expect(loading?.getAttribute("disabled")).toBeNull();
    expect(document.activeElement).toBe(loading);
    expect(host.querySelector(".preview-bento")?.getAttribute("aria-busy")).toBe("true");
    const sentinel = host.querySelector(".preview-sentinel");
    expect(sentinel?.getAttribute("role")).toBe("status");
    expect(sentinel?.getAttribute("aria-live")).toBe("polite");
    await act(async () => { loading?.click(); });
    await act(async () => { release(ok([13], 36)); });
  });

  it("renders the bottom status slot before it has anything to say", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    window.history.replaceState({}, "", "/trade-ups");
    await mount();
    paint();
    const sentinel = host.querySelector(".preview-sentinel");
    expect(sentinel?.getAttribute("role")).toBe("status");
    expect(sentinel?.getAttribute("aria-live")).toBe("polite");
    expect(sentinel?.textContent?.trim()).toBe("");
  });

  it("restores collection filters from the address bar on the collection page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("/api/collections")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => [{
            name: "The Kilowatt Collection",
            skin_count: 1,
            listing_count: 1,
            covert_count: 0,
            has_knives: false,
            has_gloves: false,
          }],
        };
      }
      if (href.includes("/api/skin-data")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
      }
      return ok([1], 1);
    }));
    window.history.replaceState({}, "", "/collections/kilowatt?min_chance=80&max_cost=5000&sort=profit");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/collections/kilowatt?min_chance=80&max_cost=5000&sort=profit"] },
        createElement(Routes, null,
          createElement(Route, { path: "/collections/:name", element: createElement(PreviewCollectionPage) }),
        )));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const chance = [...host.querySelectorAll("label")].find((node) => node.textContent?.includes("Min above cost"));
    expect((chance?.querySelector("input") as HTMLInputElement | null)?.value).toBe("80");
    const sort = [...host.querySelectorAll("label")].find((node) => node.textContent?.includes("Sort"));
    expect((sort?.querySelector("select") as HTMLSelectElement | null)?.value).toBe("profit");
    const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href");
    expect(canonical).toBe("https://tradeupbot.app/collections/kilowatt");
    expect(canonical).not.toContain("?");
  });
});
