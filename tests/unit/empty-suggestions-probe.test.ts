/**
 * @vitest-environment happy-dom
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY } from "../../src/preview/components/PreviewFilters.js";
import { LOOSEN_PROBE_DEBOUNCE_MS, probeCoolingDown, resetProbeCooldown } from "../../src/preview/lib/empty-suggestions.js";
import { browseHeldUntil, holdBrowse, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { useLoosenProbe } from "../../src/preview/lib/use-loosen-probe.js";

function QueryHarness({
  typing,
  maxCost,
  onReady,
  fetchFn,
}: {
  typing: boolean;
  maxCost: string;
  onReady: (label: string | null) => void;
  fetchFn: typeof fetch;
}) {
  const suggestion = useLoosenProbe({
    enabled: true,
    typing,
    query: { ...DEFAULT_QUERY, maxCost },
    fetchFn,
  });
  onReady(suggestion?.label ?? null);
  return null;
}

function Harness({
  typing,
  onReady,
  fetchFn,
}: {
  typing: boolean;
  onReady: (label: string | null) => void;
  fetchFn: typeof fetch;
}) {
  const suggestion = useLoosenProbe({
    enabled: true,
    typing,
    query: { ...DEFAULT_QUERY, maxCost: "1" },
    fetchFn,
  });
  onReady(suggestion?.label ?? null);
  return null;
}

describe("useLoosenProbe", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    resetProbeCooldown();
    resetBrowseFetchState();
    act(() => { root?.unmount(); });
    host?.remove();
  });

  it("waits out a browse hold before probing, and a 429 holds browse", async () => {
    holdBrowse(Date.now() + LOOSEN_PROBE_DEBOUNCE_MS + 250);
    const fetchFn = vi.fn(async () => new Response("{}", {
      status: 429,
      headers: { "retry-after": "2" },
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(Harness, {
        typing: false,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: () => {},
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(fetchFn).not.toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(probeCoolingDown()).toBe(true);
    expect(browseHeldUntil()).toBeGreaterThan(Date.now());
  });

  it("does not fetch while typing, then probes once after the debounce", async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ total: 4, trade_ups: [{ id: 1 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let label: string | null = null;
    await act(async () => {
      root.render(createElement(Harness, {
        typing: true,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: (next) => { label = next; },
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(label).toBeNull();

    await act(async () => {
      root.render(createElement(Harness, {
        typing: false,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: (next) => { label = next; },
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS - 50)); });
    expect(fetchFn).not.toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(urls[0]).toContain("per_page=1");
    expect(urls[0]).toContain("max_cost=200");
    expect(label).toBe("Raise max cost to $2.00");

    await act(async () => {
      root.render(createElement(Harness, {
        typing: true,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: (next) => { label = next; },
      }));
    });
    expect(label).toBe("Raise max cost to $2.00");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(Harness, {
        typing: false,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: (next) => { label = next; },
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(label).toBe("Raise max cost to $2.00");
  });

  it("hides a suggestion for the previous query while the next one is still being typed", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ total: 4, trade_ups: [{ id: 1 }] }), { status: 200 }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let label: string | null = null;
    const paint = (typing: boolean, maxCost: string) => {
      root.render(createElement(QueryHarness, {
        typing,
        maxCost,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: (next) => { label = next; },
      }));
    };
    await act(async () => { paint(false, "1"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(label).toBe("Raise max cost to $2.00");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { paint(true, "9"); });
    expect(label).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(label).toBeNull();
  });

  it("waits 60s after a 429 before probing again", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 429 }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(Harness, {
        typing: false,
        fetchFn: fetchFn as unknown as typeof fetch,
        onReady: () => {},
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(probeCoolingDown()).toBe(true);

    function Next({ cost }: { cost: string }) {
      useLoosenProbe({
        enabled: true,
        query: { ...DEFAULT_QUERY, maxCost: cost },
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      return null;
    }
    await act(async () => { root.render(createElement(Next, { cost: "3" })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("drops a probe that starts while the filters are still changing", async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ total: 1, trade_ups: [{ id: 1 }] }), { status: 200 });
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Switcher() {
      const [cost, setCost] = useState("1");
      const suggestion = useLoosenProbe({
        enabled: true,
        query: { ...DEFAULT_QUERY, maxCost: cost },
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      return createElement("button", { onClick: () => setCost("3") }, suggestion?.label ?? "none");
    }
    await act(async () => { root.render(createElement(Switcher)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const button = host.querySelector("button");
    await act(async () => { button?.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, LOOSEN_PROBE_DEBOUNCE_MS + 40)); });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.includes("max_cost=600"))).toBe(true);
    expect(urls.some((url) => url.includes("max_cost=200"))).toBe(false);
  });
});
