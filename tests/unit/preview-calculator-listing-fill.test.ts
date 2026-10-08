/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_LISTINGS_COPY } from "../../shared/calculator-example.js";
import { PreviewCalculator } from "../../src/preview/pages/PreviewCalculator.js";

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

const leet = {
  name: "AK-47 | Leet Museo",
  weapon: "AK-47",
  rarity: "Classified",
  min_float: 0,
  max_float: 0.65,
  collection_name: "The 2021 Train Collection",
  floor_price_cents: 6075,
  floor_float: 0.5,
};

const splash = {
  name: "SCAR-20 | Splash Jam",
  weapon: "SCAR-20",
  rarity: "Restricted",
  min_float: 0.06,
  max_float: 0.8,
  collection_name: "The 2021 Train Collection",
  floor_price_cents: null,
  floor_float: null,
};

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("calculator listing fill", () => {
  let root: Root;
  let host: HTMLDivElement;
  const calls: { url: string; method: string; body: string }[] = [];

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    calls.length = 0;
    vi.unstubAllGlobals();
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(PreviewCalculator)); });
    await act(async () => { await Promise.resolve(); });
  }

  async function searchAndAdd(query: string, label: string) {
    const input = host.querySelector("input.preview-input");
    if (!(input instanceof HTMLInputElement)) throw new Error("search missing");
    await act(async () => { setInput(input, query); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const button = [...host.querySelectorAll("button.preview-row")].find((node) => node.textContent?.includes(label));
    if (!(button instanceof HTMLButtonElement)) throw new Error(`missing ${label}`);
    await act(async () => { button.click(); });
  }

  it("shows the listing float, price, and matching wear, and leaves an unlisted skin out of Evaluate", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
      const path = String(url);
      if (path.includes("Splash")) return json(200, { results: [splash] });
      if (path.includes("Leet")) return json(200, { results: [leet] });
      return json(400, { error: "not used" });
    }));
    await mount();
    await searchAndAdd("Leet Museo", "Leet Museo");

    const priced = host.querySelector(".preview-listing:not(.preview-listing--unlisted)");
    expect(priced?.textContent).toContain("0.5000");
    expect(priced?.textContent).toContain("$60.75");
    expect(priced?.textContent).toContain("BS");
    expect(priced?.textContent).not.toContain("0.3250");
    expect(priced?.textContent).not.toContain("FT");

    await searchAndAdd("Splash Jam", "Splash Jam");
    expect(host.textContent).toContain(NO_LISTINGS_COPY);
    expect(host.textContent).not.toContain("$0.00");
    expect(host.querySelector(".preview-panel__meta")?.textContent).toContain("1 / 10");
    expect(host.querySelector(".preview-panel__meta")?.textContent).not.toContain("2 / 10");

    const evaluate = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Evaluate"));
    if (!(evaluate instanceof HTMLButtonElement)) throw new Error("Evaluate missing");
    expect(evaluate.disabled).toBe(false);
    const postsBefore = calls.filter((call) => call.method === "POST").length;
    await act(async () => { evaluate.click(); });
    await act(async () => { await Promise.resolve(); });
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.length).toBe(postsBefore + 1);
    const body = JSON.parse(posts[0].body) as { inputs: { skinName: string; priceCents: number; floatValue: number }[] };
    expect(body.inputs).toEqual([
      { skinName: "AK-47 | Leet Museo", floatValue: 0.5, priceCents: 6075 },
    ]);
    expect(body.inputs.some((input) => input.priceCents <= 0)).toBe(false);
    expect(body.inputs.some((input) => input.skinName.includes("Splash"))).toBe(false);
  });

  it("does not evaluate a skin that has no listings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
      return json(200, { results: [splash] });
    }));
    await mount();
    await searchAndAdd("Splash", "Splash Jam");
    const evaluate = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Evaluate"));
    if (!(evaluate instanceof HTMLButtonElement)) throw new Error("Evaluate missing");
    expect(evaluate.disabled).toBe(true);
    expect(host.querySelector(".preview-panel__meta")?.textContent).toContain("0 / 10");
    await act(async () => { evaluate.click(); });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(host.textContent).toContain(NO_LISTINGS_COPY);
  });

  it("renders a Load example slot with that listing's float, price, and wear", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
      if (String(url).includes("/api/calculator/example")) {
        return json(200, {
          inputs: [{
            skinName: "AK-47 | Leet Museo",
            floatValue: "0.5",
            priceCents: "6075",
            resolved: {
              name: "AK-47 | Leet Museo",
              weapon: "AK-47",
              rarity: "Classified",
              min_float: 0,
              max_float: 0.65,
              collection_name: "The 2021 Train Collection",
              floor_price_cents: 6075,
            },
          }],
        });
      }
      return json(400, { error: "held" });
    }));
    await mount();
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Load example"));
    await act(async () => { button?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const row = host.querySelector(".preview-listing");
    expect(row?.textContent).toContain("0.5000");
    expect(row?.textContent).toContain("$60.75");
    expect(row?.textContent).toContain("BS");
    expect(row?.textContent).not.toContain("0.3250");
  });
});
