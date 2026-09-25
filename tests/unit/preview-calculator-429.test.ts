/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_MANUAL_COPY } from "../../src/preview/lib/page-fetch.js";
import { PreviewCalculator } from "../../src/preview/pages/PreviewCalculator.js";

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

const slot = {
  skinName: "AK-47 | Redline",
  floatValue: "0.15",
  priceCents: "100",
  resolved: {
    name: "AK-47 | Redline",
    weapon: "AK-47",
    rarity: "Classified",
    min_float: 0,
    max_float: 1,
    collection_name: "The Phoenix Collection",
    floor_price_cents: 100,
  },
};

describe("calculator 429", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(PreviewCalculator)); });
    await act(async () => { await Promise.resolve(); });
  }

  it("uses the manual copy when Load example is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, null)));
    await mount();
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Load example"));
    await act(async () => { button?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
  });

  it("uses the manual copy when Evaluate is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/calculator/example")) return json(200, { inputs: [slot] });
      return json(429, null);
    }));
    await mount();
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Load example"));
    await act(async () => { button?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
  });
});
