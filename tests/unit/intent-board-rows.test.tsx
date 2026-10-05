/**
 * @vitest-environment happy-dom
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewIntent } from "../../src/preview/pages/PreviewIntent.js";

function json(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function row(id: number, type: string) {
  return {
    id,
    type,
    total_cost_cents: 12000,
    profit_cents: 4200,
    roi_percentage: 35,
    chance_to_profit: 0.41,
  };
}

function Jump({ to }: { to: string }) {
  const navigate = useNavigate();
  return createElement("button", { type: "button", onClick: () => navigate(to) }, "jump");
}

function tree(start: string, next: string): ReactNode {
  return createElement(
    MemoryRouter,
    { initialEntries: [start] },
    createElement(Routes, null, createElement(Route, {
      path: "/trade-ups/tiers/:slug",
      element: createElement(PreviewIntent),
    })),
    createElement(Jump, { to: next }),
  );
}

describe("intent tier table while the next list loads", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount(start: string, next: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(tree(start, next)); });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function jump() {
    const button = host.querySelector("button");
    await act(async () => { button?.click(); });
  }

  it("clears the previous tier's rows while the next tier is loading", async () => {
    let releaseKnife: (value: ReturnType<typeof json>) => void = () => {};
    const knife = new Promise<ReturnType<typeof json>>((resolve) => { releaseKnife = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/global-stats")) return json({ active_trade_ups: 3, active_profitable_trade_ups: 3 });
      if (path.includes("type=covert_knife")) return knife;
      return json({ trade_ups: [row(2, "classified_covert")] });
    }));

    await mount("/trade-ups/tiers/covert", "/trade-ups/tiers/knife");
    expect(host.textContent).toContain("#2");

    await jump();
    expect(host.textContent).toContain("Knife and glove trade-ups");
    expect(host.textContent).toContain("Loading the live board");
    expect(host.textContent).not.toContain("#2");

    await act(async () => { releaseKnife(json({ trade_ups: [row(9, "covert_knife")] })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("#9");
    expect(host.textContent).not.toContain("#2");
  });

  it("drops a previous failure when the next tier's list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/global-stats")) return json({ active_trade_ups: 3, active_profitable_trade_ups: 3 });
      if (path.includes("type=covert_knife")) return json({ trade_ups: [] });
      return json(null, false);
    }));

    await mount("/trade-ups/tiers/covert", "/trade-ups/tiers/knife");
    expect(host.textContent).toContain("The live list did not load.");

    await jump();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("No active trade-ups above $1 expected P/L");
    expect(host.textContent).not.toContain("The live list did not load.");
  });
});
