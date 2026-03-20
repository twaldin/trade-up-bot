/**
 * Engine performance stress tests.
 * Tests that core operations perform within acceptable bounds
 * under heavy load — catches OOM and quadratic complexity regressions.
 */

import { describe, it, expect } from "vitest";
import { TradeUpStore } from "../../server/engine/store.js";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "../../server/engine/core.js";
import { computeChanceToProfit, computeBestWorstCase, listingSig } from "../../server/engine/utils.js";
import { addAdjustedFloat, selectForFloatTarget } from "../../server/engine/selection.js";
import { makeTradeUp, makeListing, makeOutcome } from "../helpers/fixtures.js";
import type { ListingWithCollection, AdjustedListing } from "../../server/engine/types.js";

// ─── TradeUpStore at scale ───────────────────────────────────────────────────

describe("TradeUpStore performance", () => {
  it("handles 100K insertions without OOM", () => {
    const store = new TradeUpStore(50);
    const start = performance.now();

    for (let i = 0; i < 100_000; i++) {
      store.add(makeTradeUp({
        listingIds: [`${i}-a`, `${i}-b`],
        collectionName: `Collection ${i % 100}`,
        profit_cents: Math.floor(Math.random() * 10000),
        expected_value_cents: 5000 + Math.floor(Math.random() * 10000),
      }));
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10000); // < 10 seconds
    // With maxPerSignature=50 and 100 collections, max = 5000 trade-ups
    expect(store.total).toBeLessThanOrEqual(5000);
    expect(store.getSignatureCount()).toBeLessThanOrEqual(100);
  });

  it("hasSig lookups are fast after 50K insertions", () => {
    const store = new TradeUpStore(20);

    // Pre-load
    for (let i = 0; i < 50_000; i++) {
      store.add(makeTradeUp({
        listingIds: [`pre-${i}`],
        collectionName: `Collection ${i % 50}`,
        profit_cents: 100 + (i % 1000),
        expected_value_cents: 600 + (i % 1000),
      }));
    }

    // Time 10K hasSig lookups
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      store.hasSig(`pre-${i}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500); // < 500ms for 10K lookups
  });
});

// ─── calculateOutputFloat at scale ───────────────────────────────────────────

describe("calculateOutputFloat performance", () => {
  it("handles 100K calculations", () => {
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: Math.random() * 0.5,
      min_float: 0,
      max_float: 1,
    }));

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      calculateOutputFloat(inputs, 0.06, 0.80);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000); // < 2 seconds
  });
});

// ─── calculateOutcomeProbabilities at scale ──────────────────────────────────

describe("calculateOutcomeProbabilities performance", () => {
  it("handles 50K calculations with multi-collection inputs", () => {
    const inputs: ListingWithCollection[] = Array.from({ length: 10 }, (_, i) =>
      makeListing({
        id: `inp-${i}`,
        collection_id: `col-${i % 3}`,
        collection_name: `Collection ${i % 3}`,
      })
    );
    const outcomes = Array.from({ length: 6 }, (_, i) =>
      makeOutcome({
        id: `out-${i}`,
        name: `Skin ${i}`,
        collection_id: `col-${i % 3}`,
        collection_name: `Collection ${i % 3}`,
      })
    );

    const start = performance.now();
    for (let i = 0; i < 50_000; i++) {
      calculateOutcomeProbabilities(inputs, outcomes);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000); // < 3 seconds
  });
});

// ─── listingSig at scale ─────────────────────────────────────────────────────

describe("listingSig performance", () => {
  it("handles 100K signature computations", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `listing-${9 - i}`);

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      listingSig(ids);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── Selection at scale ──────────────────────────────────────────────────────

describe("Selection strategy performance", () => {
  it("selectForFloatTarget with 1000 listings per collection", () => {
    const pool: AdjustedListing[] = Array.from({ length: 1000 }, (_, i) => ({
      ...makeListing({
        id: `big-${i}`,
        collection_name: "Big Collection",
        float_value: Math.random() * 0.5,
        price_cents: 500 + Math.floor(Math.random() * 5000),
        min_float: 0,
        max_float: 1,
      }),
      adjustedFloat: Math.random() * 0.5,
    }));

    const byCol = new Map([["Big Collection", pool]]);
    const quotas = new Map([["Big Collection", 10]]);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      selectForFloatTarget(byCol, quotas, 0.3, 10);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000); // 100 selections < 2s
  });
});

// ─── computeChanceToProfit + computeBestWorstCase at scale ───────────────────

describe("Evaluation helper performance", () => {
  it("handles 100K chance-to-profit calculations", () => {
    const outcomes = Array.from({ length: 20 }, (_, i) => ({
      estimated_price_cents: 1000 + i * 500,
      probability: 1 / 20,
    }));

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      computeChanceToProfit(outcomes, 5000 + (i % 1000));
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
