/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_MANUAL_COPY, SLOW_DOWN_COPY, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { PreviewAccount } from "../../src/preview/pages/PreviewAccount.js";

function json(status: number, body: unknown, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (retryAfter && name.toLowerCase() === "retry-after" ? retryAfter : null) },
    json: async () => body,
  };
}

describe("account 429", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetBrowseFetchState();
    vi.unstubAllGlobals();
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ["/my-trade-ups"] }, createElement(PreviewAccount)));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  it("keeps the session UI on an auth 429 and offers Retry after one automatic try", async () => {
    let authHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/auth/me")) {
        authHits += 1;
        return json(429, null, "0");
      }
      return json(200, {});
    }));
    await mount();
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
    expect(host.textContent).not.toContain("Sign in with Steam");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(authHits).toBe(2);
    expect(host.textContent).toContain("Retry");
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
    expect(host.textContent).not.toContain("Sign in with Steam");
  });

  it("does not pair a claims 429 with the empty-claims panel", async () => {
    const user = { steam_id: "1", display_name: "Ada", avatar_url: "", tier: "pro", is_admin: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, user);
      if (path.includes("my_claims=true")) return json(429, null, "60");
      return json(200, { trade_ups: [] });
    }));
    await mount();
    expect(host.textContent).toContain(SLOW_DOWN_COPY);
    expect(host.textContent).not.toContain("No active claims.");
    expect(host.textContent).toContain("Ada");
  });

  it("uses the manual copy after the claims retry is spent", async () => {
    const user = { steam_id: "1", display_name: "Ada", avatar_url: "", tier: "pro", is_admin: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, user);
      if (path.includes("my_claims=true")) return json(429, null, "0");
      return json(200, { trade_ups: [] });
    }));
    await mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
    expect(host.textContent).not.toContain("No active claims.");
  });

  it("offers Retry with the manual copy when claim card details stay throttled", async () => {
    const user = { steam_id: "1", display_name: "Ada", avatar_url: "", tier: "pro", is_admin: false };
    const claim = {
      id: 7,
      type: "classified_covert",
      inputs: [],
      outcomes: [],
      total_cost_cents: 1000,
      expected_value_cents: 1800,
      profit_cents: 800,
      roi_percentage: 10,
      chance_to_profit: 1,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, user);
      if (path.includes("/outcomes") || path.includes("/inputs")) return json(429, null, "0");
      if (path.includes("my_claims=true")) return json(200, { trade_ups: [claim], tier: "pro" });
      return json(200, { trade_ups: [], stats: {} });
    }));
    await mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2500)); });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Retry")).toBe(true);
    expect(host.textContent).not.toContain("Retrying");
  }, 10000);
});
