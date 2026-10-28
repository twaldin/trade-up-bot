/**
 * @vitest-environment happy-dom
 *
 * A direct GET of an unknown /skins/:slug is the hard 404 from slugNotFoundHtml.
 * Client-side routing must land on that same title, robots, canonical, and copy,
 * then a later valid skin must put index, the skin title, and its canonical back.
 * No server is started, so there is no port to hardcode.
 */
import { act, createElement, type ReactElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { slugNotFoundHtml } from "../../server/seo.js";
import { resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewSkinPage } from "../../src/preview/pages/PreviewSkins.js";

const DEFAULT_TITLE = "TradeUpBot — CS2 Trade-Ups Built from Real, Buyable Listings";
const BAD_SLUG = "not-a-real-skin";
const VALID_SLUG = "awp-asiimov";
const VALID_NAME = "AWP | Asiimov";
const VALID_TITLE = `${VALID_NAME} — CS2 Price, Float Range & Trade-Ups | TradeUpBot`;

function directLoadNotFound() {
  const html = slugNotFoundHtml("Skin not found");
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const robots = html.match(/name="robots" content="([^"]*)"/)?.[1] ?? "";
  const body = html.match(/<p>([^<]*)<\/p>/)?.[1] ?? "";
  return { title, robots, body, hasCanonical: html.includes("canonical") };
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function skinDetail(name: string) {
  return {
    skin: {
      id: "skin-1",
      name,
      rarity: "Classified",
      weapon: name.split("|")[0]?.trim() || "AWP",
      min_float: 0.18,
      max_float: 1,
      collection_name: "The Phoenix Collection",
    },
    listings: [],
    priceSources: [],
    stats: { totalListings: 8, minPrice: null, maxPrice: null, saleCount: 0 },
  };
}

function robotsContents(): string[] {
  return [...document.querySelectorAll("meta[name='robots']")].map((node) => node.getAttribute("content") ?? "");
}

function canonicalHrefs(): string[] {
  return [...document.querySelectorAll("link[rel='canonical']")].map((node) => node.getAttribute("href") ?? "");
}

function seedShellHead(robots: string[]): void {
  document.head.replaceChildren();
  const title = document.createElement("title");
  title.textContent = DEFAULT_TITLE;
  document.head.appendChild(title);
  document.title = DEFAULT_TITLE;
  for (const content of robots) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", content);
    document.head.appendChild(meta);
  }
  const link = document.createElement("link");
  link.rel = "canonical";
  link.setAttribute("href", "https://tradeupbot.app/trade-ups");
  document.head.appendChild(link);
}

function NavButtons(): ReactElement {
  const navigate = useNavigate();
  return createElement("nav", null,
    createElement("button", { type: "button", "data-nav": "bad", onClick: () => navigate(`/skins/${BAD_SLUG}`) }, "bad"),
    createElement("button", { type: "button", "data-nav": "valid", onClick: () => navigate(`/skins/${VALID_SLUG}`) }, "valid"),
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function until(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let i = 0; i < 30; i += 1) {
    await flush();
    try {
      assertion();
      return;
    } catch (err) {
      error = err;
    }
  }
  throw error;
}

describe("client navigation to an unknown skin slug", () => {
  let root: Root;
  let host: HTMLDivElement;
  const pageViews: string[] = [];

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    document.head.replaceChildren();
    document.title = "";
    resetBrowseFetchState();
    vi.unstubAllGlobals();
    pageViews.length = 0;
  });

  async function mount(robots = ["index, follow", "index, follow"]): Promise<void> {
    seedShellHead(robots);
    window.gtag = (command: string, name: string) => {
      if (command === "event" && name === "page_view") pageViews.push(name);
    };
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes(`/api/skin-by-slug/${BAD_SLUG}`)) return respond(404, { error: "Skin not found" });
      if (url.includes(`/api/skin-by-slug/${VALID_SLUG}`)) return respond(200, { name: VALID_NAME });
      if (url.includes("/api/skin-data/")) {
        const encoded = url.split("/api/skin-data/")[1]?.split("?")[0] ?? "";
        return respond(200, skinDetail(decodeURIComponent(encoded)));
      }
      if (url.includes("/api/trade-ups")) {
        return respond(200, { trade_ups: [], tier: "pro", total: 0, total_profitable: 0, signed_in: false });
      }
      if (url.includes("/api/preview/faces")) return respond(200, {});
      return respond(401, null);
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/trade-ups"] },
        createElement(NavButtons),
        createElement(Routes, null,
          createElement(Route, { path: "/trade-ups", element: createElement("p", null, "Board") }),
          createElement(Route, { path: "/skins/:slug", element: createElement(PreviewSkinPage) }),
        ),
      ));
    });
  }

  async function go(which: "bad" | "valid"): Promise<void> {
    await act(async () => {
      host.querySelector(`button[data-nav="${which}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("uses the direct-load 404 head and copy, then restores a valid skin", async () => {
    const direct = directLoadNotFound();
    expect(direct.hasCanonical).toBe(false);
    expect(direct.robots).toBe("noindex");
    expect(direct.title).toBe("Skin not found");
    expect(direct.body).toBe("Skin not found");

    await mount();
    expect(document.title).toBe(DEFAULT_TITLE);
    expect(robotsContents()).toEqual(["index, follow", "index, follow"]);
    expect(pageViews).toEqual([]);

    await go("bad");
    await until(() => {
      expect(host.querySelector(".preview-page")?.textContent).toBe(direct.body);
      expect(document.title).toBe(direct.title);
      expect(robotsContents()).toEqual([direct.robots]);
      expect(canonicalHrefs()).toEqual([]);
    });
    expect(host.textContent).not.toContain("That skin is not in the live dataset.");
    expect(pageViews).toEqual([]);

    await go("valid");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Asiimov");
      expect(document.title).toBe(VALID_TITLE);
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([`https://tradeupbot.app/skins/${VALID_SLUG}`]);
    });
    expect(pageViews).toEqual([]);
  });

  it("keeps a thin skin's noindex, follow while setting the skin title", async () => {
    await mount(["noindex, follow"]);
    await go("valid");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Asiimov");
      expect(document.title).toBe(VALID_TITLE);
      expect(robotsContents()).toEqual(["noindex, follow"]);
      expect(canonicalHrefs()).toEqual([`https://tradeupbot.app/skins/${VALID_SLUG}`]);
    });
    expect(pageViews).toEqual([]);
  });
});
