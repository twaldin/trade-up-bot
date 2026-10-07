/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewShare } from "../../src/preview/pages/PreviewShare.js";

const CASES = ["abc", "1e9", "-1", "01", "1".repeat(30)];

describe("share page not-found for a bad id", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount(id: string) {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/trade-ups/")) {
        throw new Error(`fetched ${url}`);
      }
      return { ok: false, status: 401, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [`/trade-ups/${id}`] },
        createElement(Routes, null,
          createElement(Route, { path: "/trade-ups/:id", element: createElement(PreviewShare) }),
        ),
      ));
    });
    await act(async () => { await Promise.resolve(); });
    return fetchMock;
  }

  it.each(CASES)("shows the kit not-found page for %s without loading a contract", async (id) => {
    const fetchMock = await mount(id);
    expect(host.querySelector("h1")?.textContent).toBe("Trade-up not found");
    expect(host.textContent).not.toContain("Loading trade-up");
    expect(host.textContent).not.toContain("Verify");
    expect(host.textContent).not.toContain(id);
    expect(host.querySelector("a[href='/trade-ups']")).not.toBeNull();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/trade-ups/"))).toBe(false);
  });
});
