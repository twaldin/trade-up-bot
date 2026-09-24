/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import { usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";

type Api = ReturnType<typeof usePreviewTradeUps>;

const pages: string[] = [];

function listResponse(count: number, total = 48) {
  const trade_ups = Array.from({ length: count }, (_, i) => ({
    id: pages.length * 100 + i + 1,
    inputs: [{ skin_name: "In" }],
    outcomes: [{ skin_name: "Out" }],
  }));
  return {
    ok: true,
    status: 200,
    json: async () => ({ trade_ups, total, tier: "pro" }),
  };
}

function Harness({ onReady }: { onReady: (api: Api) => void }) {
  const api = usePreviewTradeUps({ perPage: 12 });
  onReady(api);
  return null;
}

describe("usePreviewTradeUps page reset", () => {
  let root: Root;
  let host: HTMLDivElement;
  let api: Api;

  beforeEach(() => {
    pages.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      pages.push(url);
      const page = Number(new URL(url, "http://local").searchParams.get("page"));
      const filtered = url.includes("min_chance=") || url.includes("sort=profit");
      if (filtered) return listResponse(0, 0);
      return listResponse(page >= 4 ? 0 : 12);
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => {
      root.render(createElement(Harness, { onReady: (next) => { api = next; } }));
    });
    await act(async () => { await Promise.resolve(); });
  }

  function rerender() {
    act(() => {
      root.render(createElement(Harness, { onReady: (next) => { api = next; } }));
    });
  }

  async function settle() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    rerender();
  }

  async function settleFilters() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await settle();
  }

  function listUrls() {
    return pages.filter((url) => url.includes("/api/trade-ups?"));
  }

  it("returns to page 1 after scrolling, filtering to nothing, and clearing", async () => {
    await mount();
    expect(listUrls().at(-1)).toContain("page=1");

    await act(async () => { api.loadMore(); });
    await settle();
    await act(async () => { api.loadMore(); });
    await settle();
    expect(listUrls().at(-1)).toContain("page=3");

    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, minChance: "100" }); });
    await settleFilters();
    const filtered = listUrls().at(-1) ?? "";
    expect(filtered).toContain("min_chance=100");
    expect(filtered).toContain("page=1");
    expect(filtered).not.toContain("page=3");

    await act(async () => { api.clearFilters(); });
    await settleFilters();
    const cleared = listUrls().filter((url) => !url.includes("min_chance="));
    expect(cleared.at(-1)).toContain("page=1");
    expect(cleared.at(-1)).not.toContain("page=3");
  });

  it("returns to page 1 when a sort is applied and then put back", async () => {
    await mount();
    await act(async () => { api.loadMore(); });
    await settle();
    await act(async () => { api.loadMore(); });
    await settle();
    expect(listUrls().at(-1)).toContain("page=3");

    await act(async () => { api.onQuery({ ...DEFAULT_QUERY, sort: "profit" }); });
    await settleFilters();
    expect(listUrls().at(-1)).toContain("sort=profit");
    expect(listUrls().at(-1)).toContain("page=1");

    await act(async () => { api.onQuery(DEFAULT_QUERY); });
    await settleFilters();
    const back = listUrls().filter((url) => url.includes("sort=trade_up_score"));
    expect(back.at(-1)).toContain("page=1");
    expect(back.at(-1)).not.toContain("page=3");
  });

  it("does not mark the board refreshing while a later page loads", async () => {
    await mount();
    await settle();
    expect(api.refreshing).toBe(false);
    let release: (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { release = resolve; })));
    await act(async () => { api.loadMore(); });
    rerender();
    expect(api.loading).toBe(true);
    expect(api.refreshing).toBe(false);
    await act(async () => { release(listResponse(12)); });
    await settle();
    expect(api.refreshing).toBe(false);
  });
});
