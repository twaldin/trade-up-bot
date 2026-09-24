/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreviewTradeUps } from "../../src/preview/pages/PreviewBoard.js";

type Api = ReturnType<typeof usePreviewTradeUps>;

function Harness({ onReady }: { onReady: (api: Api) => void }) {
  const api = usePreviewTradeUps({ perPage: 12 });
  onReady(api);
  return null;
}

describe("board filters survive a reload", () => {
  let root: Root;
  let host: HTMLDivElement;
  let api: Api;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ trade_ups: [], total: 0, tier: "pro" }),
    })));
    window.history.replaceState({}, "", "/trade-ups?min_chance=80&sort=cost&order=asc&max_cost=2500&type=classified_covert&q=ak");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("reads the query string back into the board controls", async () => {
    await act(async () => {
      root.render(createElement(Harness, { onReady: (next) => { api = next; } }));
    });
    expect(api.query.minChance).toBe("80");
    expect(api.query.sort).toBe("cost");
    expect(api.query.order).toBe("asc");
    expect(api.query.maxCost).toBe("25");
    expect(api.query.type).toBe("classified_covert");
    expect(api.search).toBe("ak");
    expect(window.location.pathname).toBe("/trade-ups");
    expect(new URLSearchParams(window.location.search).get("min_chance")).toBe("80");
  });
});
