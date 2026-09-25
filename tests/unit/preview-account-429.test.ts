/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_MANUAL_COPY, SLOW_DOWN_COPY, browseHeldUntil, holdBrowse, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
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
    expect(host.textContent).toContain(SLOW_DOWN_COPY);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2500)); });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Retrying");
    expect(host.textContent).not.toContain("No active claims.");
    const retry = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Retry");
    expect(retry).toBeTruthy();
    const userFetch = vi.mocked(fetch);
    const prior = userFetch.mock.calls.length;
    await act(async () => { holdBrowse(Date.now() + 30_000); });
    await act(async () => { retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(userFetch.mock.calls.length).toBe(prior);
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Retry")).toBe(false);
  });

  it("refetches spent claims after the hold ends", async () => {
    const user = { steam_id: "1", display_name: "Ada", avatar_url: "", tier: "pro", is_admin: false };
    let claims = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, user);
      if (path.includes("my_claims=true")) {
        claims += 1;
        if (claims <= 2) return json(429, null, "0");
        return json(200, { trade_ups: [] });
      }
      return json(200, { trade_ups: [] });
    }));
    await mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2500)); });
    const retry = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Retry");
    expect(retry).toBeTruthy();
    const userFetch = vi.mocked(fetch);
    const prior = userFetch.mock.calls.length;
    await act(async () => { retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    const claimsCalls = userFetch.mock.calls.slice(prior).filter((call) => String(call[0]).includes("my_claims=true"));
    expect(claimsCalls.length).toBeGreaterThan(0);
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
    await act(async () => {
      const deadline = Date.now() + 4000;
      while (browseHeldUntil() > Date.now() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Retry")).toBe(true);
    expect(host.textContent).not.toContain("Retrying");
  }, 10000);

  it("hides claim-card Retry during a hold so extra clicks do not refetch", async () => {
    const user = { steam_id: "1", display_name: "Ada", avatar_url: "", tier: "pro", is_admin: false };
    const claim = {
      id: 7,
      type: "classified_covert",
      inputs: [],
      outcomes: [{
        skin_id: "out-1",
        skin_name: "AK-47 | Fire Serpent",
        collection_name: "Test",
        probability: 1,
        predicted_float: 0.15,
        predicted_condition: "Field-Tested",
        estimated_price_cents: 12000,
      }],
      total_cost_cents: 1000,
      expected_value_cents: 1800,
      profit_cents: 800,
      roi_percentage: 10,
      chance_to_profit: 1,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    let claims = 0;
    let details = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes("/api/auth/me")) return json(200, user);
      if (path.includes("/inputs")) {
        details += 1;
        return json(429, null, "0");
      }
      if (path.includes("my_claims=true")) {
        claims += 1;
        return json(200, { trade_ups: [claim], tier: "pro" });
      }
      return json(200, { trade_ups: [], stats: {} });
    }));
    await mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2200)); });
    const claimsAtHold = claims;
    const detailsAtHold = details;
    await act(async () => { holdBrowse(Date.now() + 30_000); });
    const retry = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Retry");
    expect(retry == null || (retry as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(claims).toBe(claimsAtHold);
    expect(details).toBe(detailsAtHold);
    expect(claims).toBeLessThanOrEqual(1);
    expect(details).toBeLessThanOrEqual(2);
  }, 10000);
});
