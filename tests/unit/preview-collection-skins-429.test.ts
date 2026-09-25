/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_MANUAL_COPY, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewCollectionPage } from "../../src/preview/pages/PreviewSkins.js";

function json(status: number, body: unknown, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (retryAfter && name.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => body,
    text: async () => "",
  };
}

describe("collection skins spent retry", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetBrowseFetchState();
    vi.unstubAllGlobals();
  });

  it("drops the Retrying line once the automatic skins retry is spent", async () => {
    let skinHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/collections")) {
        return json(200, [{ name: "The Kilowatt Collection", listing_count: 1 }]);
      }
      if (path.includes("/api/skin-data")) {
        skinHits += 1;
        return json(429, null, "0");
      }
      if (path.includes("/api/trade-ups")) return json(200, { trade_ups: [], tier: "pro", total: 0 });
      return json(200, {});
    }));

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        { initialEntries: ["/collections/kilowatt"] },
        createElement(Routes, null, createElement(Route, {
          path: "/collections/:name",
          element: createElement(PreviewCollectionPage),
        })),
      ));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2500)); });
    expect(skinHits).toBe(2);
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
  }, 10000);
});
