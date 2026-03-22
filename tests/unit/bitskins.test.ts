/**
 * BitSkins integration tests — fees, API response parsing, data handling.
 * Tests the sync/bitskins module and fee constants.
 */

import { describe, it, expect } from "vitest";
import { MARKETPLACE_FEES, effectiveBuyCostRaw, effectiveSellProceeds } from "../../server/engine/fees.js";

// ---------- Fee constants ----------

describe("BitSkins fee constants", () => {
  it("buyer: 0% fee, no flat fee", () => {
    expect(MARKETPLACE_FEES.bitskins).toBeDefined();
    expect(MARKETPLACE_FEES.bitskins.buyerFeePct).toBe(0);
    expect(MARKETPLACE_FEES.bitskins.buyerFeeFlat).toBe(0);
  });

  it("seller: 4.75%", () => {
    expect(MARKETPLACE_FEES.bitskins.sellerFee).toBe(0.0475);
  });

  it("buyer pays exactly listing price (0% fee)", () => {
    const result = effectiveBuyCostRaw(5000, "bitskins");
    expect(result).toBe(5000);
  });

  it("buyer pays exactly listing price for expensive items", () => {
    const result = effectiveBuyCostRaw(100000, "bitskins");
    expect(result).toBe(100000);
  });

  it("seller proceeds after 4.75% fee", () => {
    const result = effectiveSellProceeds(10000, "bitskins");
    expect(result).toBe(Math.round(10000 * (1 - 0.0475)));
  });

  it("seller fee is less than skinport (8%) but more than csfloat (2%)", () => {
    expect(MARKETPLACE_FEES.bitskins.sellerFee).toBeGreaterThan(MARKETPLACE_FEES.csfloat.sellerFee);
    expect(MARKETPLACE_FEES.bitskins.sellerFee).toBeLessThan(MARKETPLACE_FEES.skinport.sellerFee);
  });
});

// ---------- API response parsing ----------

describe("BitSkins API response parsing", () => {
  it("parseSkinCatalog: maps name → skin_id", async () => {
    // This will import from sync/bitskins once it exists
    const { parseSkinCatalog } = await import("../../server/sync/bitskins.js");

    const catalog = [
      { id: 12345, name: "AK-47 | Redline (Field-Tested)", class_id: "310777191", suggested_price: 4500 },
      { id: 12346, name: "AK-47 | Redline (Minimal Wear)", class_id: "310777192", suggested_price: 12000 },
      { id: 99999, name: "★ Karambit | Fade (Factory New)", class_id: "123456", suggested_price: 200000 },
    ];

    const map = parseSkinCatalog(catalog);
    expect(map.get("AK-47 | Redline (Field-Tested)")).toBe(12345);
    expect(map.get("AK-47 | Redline (Minimal Wear)")).toBe(12346);
    expect(map.get("★ Karambit | Fade (Factory New)")).toBe(99999);
    expect(map.get("nonexistent")).toBeUndefined();
  });

  it("parseSearchResponse: extracts listings from search result", async () => {
    const { parseSearchResponse } = await import("../../server/sync/bitskins.js");

    const raw = {
      counter: { total: 100, filtered: 2 },
      list: [
        { id: "uuid-1", asset_id: "asset-1", skin_id: 12345, price: 4500, name: "AK-47 | Redline (Field-Tested)", ss: 0, status: 3, suggested_price: 4600, discount: 2, class_id: "310777191", bot_id: 1, tradehold: 0, sticker_counter: 0, skin_status: 1 },
        { id: "uuid-2", asset_id: "asset-2", skin_id: 12345, price: 4700, name: "AK-47 | Redline (Field-Tested)", ss: 1, status: 3, suggested_price: 4600, discount: 0, class_id: "310777191", bot_id: 1, tradehold: 0, sticker_counter: 2, skin_status: 1 },
      ],
    };

    const result = parseSearchResponse(raw);
    expect(result.total).toBe(100);
    expect(result.listings).toHaveLength(2);

    const first = result.listings[0];
    expect(first.id).toBe("uuid-1");
    expect(first.priceCents).toBe(4500);
    expect(first.skinId).toBe(12345);
    expect(first.stattrak).toBe(false);
    expect(first.marketHashName).toBe("AK-47 | Redline (Field-Tested)");

    const second = result.listings[1];
    expect(second.stattrak).toBe(true); // ss=1 means StatTrak
  });

  it("parseSaleHistory: extracts sales with float values", async () => {
    const { parseSaleHistory } = await import("../../server/sync/bitskins.js");

    const raw = [
      { price: 4500, created_at: "2026-03-15T12:00:00.000Z", float_value: 0.2615432, stickers: [], phase_id: null },
      { price: 4700, created_at: "2026-03-14T10:00:00.000Z", float_value: 0.1523456, stickers: [{ name: "Navi" }], phase_id: null },
      { price: 3000, created_at: "2026-03-13T08:00:00.000Z", float_value: -1, stickers: [], phase_id: null },
    ];

    const sales = parseSaleHistory(raw);
    expect(sales).toHaveLength(3);

    expect(sales[0].priceCents).toBe(4500);
    expect(sales[0].floatValue).toBeCloseTo(0.2615432);
    expect(sales[0].transactTime).toBe(Math.floor(new Date("2026-03-15T12:00:00.000Z").getTime() / 1000));

    // Invalid float (-1) should be preserved as-is (caller decides what to do)
    expect(sales[2].floatValue).toBe(-1);
  });

  it("parseSaleHistory: handles typo field names from BitSkins API", async () => {
    const { parseSaleHistory } = await import("../../server/sync/bitskins.js");

    // BitSkins API has known typos: "created_ad" instead of "created_at", "fload_value" instead of "float_value"
    const raw = [
      { price: 4500, created_ad: "2026-03-15T12:00:00.000Z", fload_value: 0.2615432, stickers: [], phase_id: null },
    ];

    const sales = parseSaleHistory(raw);
    expect(sales).toHaveLength(1);
    expect(sales[0].priceCents).toBe(4500);
    expect(sales[0].floatValue).toBeCloseTo(0.2615432);
  });
});

// ---------- Sale ID composition ----------

describe("BitSkins sale ID composition", () => {
  it("composeSaleId: creates unique composite key", async () => {
    const { composeSaleId } = await import("../../server/sync/bitskins.js");

    const id = composeSaleId(12345, 1710504000, 4500);
    expect(id).toBe("bitskins:12345:1710504000:4500");
  });

  it("composeSaleId: different skin_ids produce different IDs", async () => {
    const { composeSaleId } = await import("../../server/sync/bitskins.js");

    const id1 = composeSaleId(12345, 1710504000, 4500);
    const id2 = composeSaleId(12346, 1710504000, 4500);
    expect(id1).not.toBe(id2);
  });

  it("composeSaleId: different timestamps produce different IDs", async () => {
    const { composeSaleId } = await import("../../server/sync/bitskins.js");

    const id1 = composeSaleId(12345, 1710504000, 4500);
    const id2 = composeSaleId(12345, 1710504001, 4500);
    expect(id1).not.toBe(id2);
  });
});

// ---------- Skin name helpers ----------

describe("BitSkins skin name helpers", () => {
  it("stripCondition: removes condition suffix from market_hash_name", async () => {
    const { stripCondition } = await import("../../server/sync/bitskins.js");

    expect(stripCondition("AK-47 | Redline (Field-Tested)")).toBe("AK-47 | Redline");
    expect(stripCondition("★ Karambit | Fade (Factory New)")).toBe("★ Karambit | Fade");
    expect(stripCondition("★ Karambit")).toBe("★ Karambit"); // vanilla knife unchanged
  });

  it("extractCondition: gets condition from market_hash_name", async () => {
    const { extractCondition } = await import("../../server/sync/bitskins.js");

    expect(extractCondition("AK-47 | Redline (Field-Tested)")).toBe("Field-Tested");
    expect(extractCondition("★ Karambit | Fade (Factory New)")).toBe("Factory New");
    expect(extractCondition("★ Karambit")).toBeNull(); // vanilla knife has no condition
  });

  it("isVanillaKnife: identifies vanilla knives correctly", async () => {
    const { isVanillaKnife } = await import("../../server/sync/bitskins.js");

    expect(isVanillaKnife("★ Karambit")).toBe(true);
    expect(isVanillaKnife("★ M9 Bayonet")).toBe(true);
    expect(isVanillaKnife("★ Karambit | Fade (Factory New)")).toBe(false);
    expect(isVanillaKnife("AK-47 | Redline (Field-Tested)")).toBe(false);
  });
});
