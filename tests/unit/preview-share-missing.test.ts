/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConsolePage } from "../../src/preview/lib/console-routes.js";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { PreviewShare } from "../../src/preview/pages/PreviewShare.js";

const CASES = ["abc", "1e9", "-1", "01", "1".repeat(30)];

describe("share page not-found for a bad id", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.head.querySelectorAll("meta[name='robots']").forEach((node) => node.remove());
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
    expect(robotsContents()).toEqual(["noindex, follow"]);
  });
});

function robotsContents(): string[] {
  return [...document.querySelectorAll("meta[name='robots']")].map((node) => node.getAttribute("content") ?? "");
}

function seedRobots(contents: string[]) {
  document.head.querySelectorAll("meta[name='robots']").forEach((node) => node.remove());
  for (const content of contents) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", content);
    document.head.appendChild(meta);
  }
}

describe("share page robots meta", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.head.querySelectorAll("meta[name='robots']").forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it("replaces the robots meta when a client navigation goes from a live trade-up to a missing one", async () => {
    seedRobots(["index, follow"]);
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/api/trade-ups/42")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 42,
            type: "classified_covert",
            total_cost_cents: 1000,
            expected_value_cents: 2000,
            profit_cents: 1000,
            roi_percentage: 100,
            chance_to_profit: 0.5,
            outcomes: [],
            inputs: [],
            listing_status: "active",
          }),
        };
      }
      if (target.includes("/api/trade-ups/")) {
        return { ok: false, status: 404, json: async () => ({ error: "Trade-up not found" }) };
      }
      return { ok: false, status: 401, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    function GoMissing() {
      const navigate = useNavigate();
      return createElement("button", { type: "button", onClick: () => navigate("/trade-ups/999999") }, "missing");
    }

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups/42"] },
        createElement(GoMissing),
        createElement(Routes, null,
          createElement(Route, { path: "/trade-ups/:id", element: createElement(PreviewShare) }),
        ),
      ));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("h1")?.textContent).not.toBe("Trade-up not found");
    expect(robotsContents()).toEqual(["index, follow"]);

    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("h1")?.textContent).toBe("Trade-up not found");
    expect(host.querySelector("a[href='/trade-ups']")?.textContent).toBe("Back to the board");
    expect(robotsContents()).toEqual(["noindex, follow"]);
  });

  it("collapses two shell robots tags to one noindex tag on a not-found page", async () => {
    seedRobots(["index, follow", "index, follow"]);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/trade-ups/")) throw new Error(`fetched ${url}`);
      return { ok: false, status: 401, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups/abc"] },
        createElement(Routes, null,
          createElement(Route, { path: "/trade-ups/:id", element: createElement(PreviewShare) }),
        ),
      ));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("h1")?.textContent).toBe("Trade-up not found");
    expect(robotsContents()).toEqual(["noindex, follow"]);
  });
});

describe("/trade-ups//", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders the not-found page instead of the board", async () => {
    window.history.pushState({}, "", "/trade-ups//");
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/trade-ups")) throw new Error(`fetched ${url}`);
      return { ok: false, status: 401, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    function Index() {
      const { pathname } = useLocation();
      const page = resolveConsolePage("board", pathname, window.location.pathname);
      return page === "share"
        ? createElement(PreviewShare)
        : createElement("h1", null, "Board");
    }

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups//"] },
        createElement(Routes, null,
          createElement(Route, { path: "/trade-ups/:id", element: createElement(PreviewShare) }),
          createElement(Route, { path: "/trade-ups", element: createElement(Index) }),
        ),
      ));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("h1")?.textContent).toBe("Trade-up not found");
    expect(host.textContent).not.toContain("Board");
    expect(host.querySelector("a[href='/trade-ups']")?.textContent).toBe("Back to the board");
  });
});

function boardElement(embed = false) {
  return createElement(PreviewBoard, {
    tradeUps: [],
    loading: false,
    isFree: false,
    expandedId: null,
    onExpand: () => {},
    embed,
  });
}

describe("board robots after a not-found trade-up", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.head.querySelectorAll("meta[name='robots']").forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it("sets index, follow when Back to the board leaves the 404", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/trade-ups/")) throw new Error(`fetched ${url}`);
      return { ok: false, status: 401, json: async () => null };
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups/abc"] },
        createElement(Routes, null,
          createElement(Route, { path: "/trade-ups/:id", element: createElement(PreviewShare) }),
          createElement(Route, { path: "/trade-ups", element: boardElement() }),
        ),
      ));
    });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("h1")?.textContent).toBe("Trade-up not found");
    expect(robotsContents()).toEqual(["noindex, follow"]);

    await act(async () => {
      host.querySelector("a[href='/trade-ups']")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(host.querySelector("h1")?.textContent).toBe("Live trade-ups");
    expect(robotsContents()).toEqual(["index, follow"]);
  });

  it("replaces a leftover noindex tag when the board mounts", async () => {
    seedRobots(["noindex, follow", "noindex, follow"]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, boardElement()));
    });
    expect(host.querySelector("h1")?.textContent).toBe("Live trade-ups");
    expect(robotsContents()).toEqual(["index, follow"]);
  });

  it("leaves robots alone when the board is embedded in another page", async () => {
    seedRobots(["noindex, follow"]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, boardElement(true)));
    });
    expect(robotsContents()).toEqual(["noindex, follow"]);
  });
});
