import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateBoardCard } from "../../src/preview/lib/board-hydrate.js";
import { SLOW_DOWN_COPY, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import { makeTradeUp } from "../helpers/fixtures.js";

function bareCard() {
  return makeTradeUp({ id: 42, listingIds: [], outcomes: [] });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function limited(retryAfter = "1") {
  return new Response("Too many requests, please try again later.", {
    status: 429,
    headers: { "retry-after": retryAfter, "content-type": "text/html" },
  });
}

afterEach(() => {
  resetBrowseFetchState();
});

describe("board card hydration 429", () => {
  it("retries each 429 once, then marks the card slow-down instead of leaving it bare", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url === "/api/trade-up/42/outcomes" || url === "/api/trade-up/42/inputs").toBe(true);
      return limited();
    });

    const card = await hydrateBoardCard(bareCard(), fetchFn as unknown as typeof fetch, sleep);

    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(card.outcomes).toHaveLength(0);
    expect(card.inputs).toHaveLength(0);
    expect(card.hydrateNotice).toBe(SLOW_DOWN_COPY);
  });

  it("keeps the tiles when the single retry succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetches = new Map<string, number>();
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const n = (fetches.get(url) ?? 0) + 1;
      fetches.set(url, n);
      if (url.endsWith("/outcomes") && n === 1) return limited("0");
      if (url.endsWith("/outcomes")) {
        return jsonResponse({
          outcomes: [{
            skin_id: "out-1",
            skin_name: "AK-47 | Fire Serpent",
            collection_name: "Test Collection",
            probability: 1,
            predicted_float: 0.15,
            predicted_condition: "Field-Tested",
            estimated_price_cents: 12000,
          }],
        });
      }
      return jsonResponse({
        inputs: [{
          listing_id: "l1",
          skin_id: "skin-1",
          skin_name: "AK-47 | Redline",
          collection_name: "Test Collection",
          price_cents: 500,
          float_value: 0.15,
          condition: "Field-Tested",
          source: "csfloat",
        }],
      });
    });

    const card = await hydrateBoardCard(bareCard(), fetchFn as unknown as typeof fetch, sleep);

    expect(fetches.get("/api/trade-up/42/outcomes")).toBe(2);
    expect(fetches.get("/api/trade-up/42/inputs")).toBe(1);
    expect(card.outcomes).toHaveLength(1);
    expect(card.inputs).toHaveLength(1);
    expect(card.hydrateNotice).toBeUndefined();
  });

  it("does not retry a non-429 failure and does not invent a slow-down", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const card = await hydrateBoardCard(bareCard(), fetchFn as unknown as typeof fetch, sleep);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    expect(card.hydrateNotice).toBeUndefined();
  });
});
