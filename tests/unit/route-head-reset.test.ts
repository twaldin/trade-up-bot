/**
 * @vitest-environment happy-dom
 *
 * Client navigations must not keep a previous route's robots or canonical.
 * No server is started, so there is no port to hardcode.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement, useEffect, type ReactElement } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App.js";
import { HOME_TITLE } from "../../src/preview/lib/copy.js";
import { robotsForListingCount, SKIN_INDEX_MIN_LISTINGS } from "../../src/preview/lib/document-head.js";
import { resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";

const BAD_SLUG = "not-a-real-skin";
const THIN_SLUG = "p250-sand-dune";
const THIN_NAME = "P250 | Sand Dune";
const NORMAL_SLUG = "awp-asiimov";
const NORMAL_NAME = "AWP | Asiimov";
const NORMAL_TITLE = `${NORMAL_NAME} — CS2 Price, Float Range & Trade-Ups | TradeUpBot`;
const THIN_LISTINGS = SKIN_INDEX_MIN_LISTINGS - 1;
const NORMAL_LISTINGS = SKIN_INDEX_MIN_LISTINGS;
const CALCULATOR_CANONICAL = "https://tradeupbot.app/calculator";
const HOME_CANONICAL = "https://tradeupbot.app/";

let navigateTo: (path: string) => void = () => {};
const pageViews: string[] = [];
const detailGates = new Map<string, Promise<number>>();

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

function skinDetail(name: string, listings: number) {
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
    stats: { totalListings: listings, minPrice: null, maxPrice: null, saleCount: 0 },
  };
}

function holdDetail(name: string): (listings: number) => void {
  let release: (listings: number) => void = () => {};
  const promise = new Promise<number>((resolve) => {
    release = resolve;
  });
  detailGates.set(name, promise);
  return release;
}

function robotsContents(): string[] {
  return [...document.querySelectorAll("meta[name='robots']")].map((node) => node.getAttribute("content") ?? "");
}

function canonicalHrefs(): string[] {
  return [...document.querySelectorAll("link[rel='canonical']")].map((node) => node.getAttribute("href") ?? "");
}

function seedHead(robots: string[], canonical: string | null): void {
  document.head.replaceChildren();
  const title = document.createElement("title");
  title.textContent = "TradeUpBot";
  document.head.appendChild(title);
  for (const content of robots) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", content);
    document.head.appendChild(meta);
  }
  if (canonical) {
    const link = document.createElement("link");
    link.rel = "canonical";
    link.setAttribute("href", canonical);
    document.head.appendChild(link);
  }
}

function Probe(): ReactElement {
  const navigate = useNavigate();
  useEffect(() => {
    navigateTo = navigate;
  }, [navigate]);
  return createElement("span", { "data-probe": "head" });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function until(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let i = 0; i < 40; i += 1) {
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

describe("route-change document head", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    document.head.replaceChildren();
    document.title = "";
    detailGates.clear();
    pageViews.length = 0;
    navigateTo = () => {};
    resetBrowseFetchState();
    vi.unstubAllGlobals();
  });

  async function mount(path: string, robots: string[] = ["index, follow"], canonical: string | null = "https://tradeupbot.app/trade-ups"): Promise<void> {
    seedHead(robots, canonical);
    window.gtag = (command: string, name: string) => {
      if (command === "event" && name === "page_view") pageViews.push(name);
    };
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes(`/api/skin-by-slug/${BAD_SLUG}`)) return respond(404, { error: "Skin not found" });
      if (url.includes(`/api/skin-by-slug/${THIN_SLUG}`)) return respond(200, { name: THIN_NAME });
      if (url.includes(`/api/skin-by-slug/${NORMAL_SLUG}`)) return respond(200, { name: NORMAL_NAME });
      if (url.includes("/api/skin-data/")) {
        const encoded = url.split("/api/skin-data/")[1]?.split("?")[0] ?? "";
        const name = decodeURIComponent(encoded);
        const gate = detailGates.get(name);
        const listings = gate ? await gate : (name === THIN_NAME ? THIN_LISTINGS : NORMAL_LISTINGS);
        return respond(200, skinDetail(name, listings));
      }
      if (url.includes("/api/listing-sniper/filter-options")) return respond(200, { skins: [], collections: [] });
      if (url.includes("/api/listing-sniper")) return respond(200, { listings: [], total: 0 });
      if (url.includes("/api/trade-ups")) {
        return respond(200, { trade_ups: [], tier: "pro", total: 0, total_profitable: 0, signed_in: false });
      }
      if (url.includes("/api/global-stats")) return respond(200, {});
      if (url.includes("/api/preview/faces")) return respond(200, {});
      return respond(401, null);
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [path] },
        createElement(Probe),
        createElement(App),
      ));
    });
    await flush();
  }

  async function go(path: string): Promise<void> {
    await act(async () => {
      navigateTo(path);
    });
  }

  it("follows the server thin-skin listing cutoff", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../server/index.ts"), "utf8");
    expect(source).toContain(`listingCount < ${SKIN_INDEX_MIN_LISTINGS} ? "noindex, follow" : "index, follow"`);
    expect(robotsForListingCount(THIN_LISTINGS)).toBe("noindex, follow");
    expect(robotsForListingCount(NORMAL_LISTINGS)).toBe("index, follow");
  });

  it("resets robots and canonical from a skin 404 through the calculator to home", async () => {
    await mount(`/skins/${BAD_SLUG}`);
    await until(() => {
      expect(host.textContent).toContain("Skin not found");
      expect(host.querySelector(".preview-page a[href='/skins']")?.textContent).toBe("Browse skins");
      expect(robotsContents()).toEqual(["noindex"]);
      expect(canonicalHrefs()).toEqual([]);
    });

    await go("/calculator");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("CS2 Trade-Up Calculator");
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([CALCULATOR_CANONICAL]);
    });

    await go("/");
    await until(() => {
      expect(document.title).toBe(HOME_TITLE);
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([HOME_CANONICAL]);
    });
    expect(pageViews).toEqual([]);
  });

  it("marks an in-app thin skin noindex, follow and a normal skin index, follow", async () => {
    await mount("/calculator", ["index, follow"], CALCULATOR_CANONICAL);
    await until(() => {
      expect(robotsContents()).toEqual(["index, follow"]);
    });

    await go(`/skins/${THIN_SLUG}`);
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Sand Dune");
      expect(robotsContents()).toEqual(["noindex, follow"]);
      expect(canonicalHrefs()).toEqual([`https://tradeupbot.app/skins/${THIN_SLUG}`]);
    });

    const release = holdDetail(NORMAL_NAME);
    await go(`/skins/${NORMAL_SLUG}`);
    await until(() => {
      expect(document.title).toBe(NORMAL_TITLE);
    });
    expect(robotsContents()).toEqual(["index, follow"]);
    expect(canonicalHrefs()).toEqual([`https://tradeupbot.app/skins/${NORMAL_SLUG}`]);

    await act(async () => {
      release(NORMAL_LISTINGS);
    });
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Asiimov");
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([`https://tradeupbot.app/skins/${NORMAL_SLUG}`]);
    });
    expect(pageViews).toEqual([]);
  });

  it("keeps a direct thin-skin load noindex, follow without flashing index", async () => {
    const release = holdDetail(THIN_NAME);
    await mount(
      `/skins/${THIN_SLUG}`,
      ["noindex, follow"],
      `https://tradeupbot.app/skins/${THIN_SLUG}`,
    );
    await until(() => {
      expect(document.title).toBe(`${THIN_NAME} — CS2 Price, Float Range & Trade-Ups | TradeUpBot`);
    });
    expect(robotsContents()).toEqual(["noindex, follow"]);

    await act(async () => {
      release(THIN_LISTINGS);
    });
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Sand Dune");
      expect(robotsContents()).toEqual(["noindex, follow"]);
    });
    expect(pageViews).toEqual([]);
  });

  it("resets noindex, follow left by a missing tier and a missing trade-up", async () => {
    await mount("/trade-ups/tiers/not-a-tier");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Tier not found");
      expect(robotsContents()).toEqual(["noindex, follow"]);
    });

    await go("/calculator");
    await until(() => {
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([CALCULATOR_CANONICAL]);
    });

    await go("/trade-ups/abc");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Trade-up not found");
      expect(robotsContents()).toEqual(["noindex, follow"]);
    });

    await go("/calculator");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("CS2 Trade-Up Calculator");
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([CALCULATOR_CANONICAL]);
    });
    expect(pageViews).toEqual([]);
  });

  it("resets listing-sniper noindex, follow when opening the calculator", async () => {
    await mount("/listing-sniper", ["index, follow"], "https://tradeupbot.app/");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Listing Sniper");
      expect(robotsContents()).toEqual(["noindex, follow"]);
      expect(canonicalHrefs()).toEqual(["https://tradeupbot.app/listing-sniper"]);
    });

    await go("/calculator");
    await until(() => {
      expect(host.querySelector("h1")?.textContent).toBe("CS2 Trade-Up Calculator");
      expect(robotsContents()).toEqual(["index, follow"]);
      expect(canonicalHrefs()).toEqual([CALCULATOR_CANONICAL]);
    });
    expect(pageViews).toEqual([]);
  });
});
