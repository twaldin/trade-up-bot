/**
 * DMarket v2 migration — mapV2Offer (pure unit).
 *
 * 2026-07-16: DMarket retired /exchange/v1/market/items (HTTP 410 → "Use
 * /marketplace-api/v2/offers"). The v2 response nests item data under
 * attributes/cs2 and moves price to a top-level priceCents string. mapV2Offer
 * converts a v2 offer into the legacy DMarketItem shape so all downstream
 * consumers (sync, fetcher, staleness, routes) stay unchanged.
 */

import { describe, it, expect } from "vitest";
import { mapV2Offer } from "../../server/sync/dmarket.js";

const v2Offer = {
  offerId: "5217dc9a-737b-4039-93c9-4675f52c69a5",
  priceCents: "2474",
  createdAt: "2026-07-17T14:30:57Z",
  locked: false,
  attributes: {
    title: "AK-47 | Redline (Well-Worn)",
    name: "AK-47 | Redline",
    categoryPath: "rifle/ak-47",
    cs2: {
      category: "CATEGORY_NORMAL",
      exterior: "EXTERIOR_WELL_WORN",
      float: "0.4297356605529785",
      paintSeed: 289,
      phase: "",
      inspectInGameUri: "steam://run/730//+csgo_econ_action_preview%20...",
    },
  },
};

describe("mapV2Offer", () => {
  it("maps a v2 offer to the legacy DMarketItem shape", () => {
    const item = mapV2Offer(v2Offer);
    expect(item.itemId).toBe("5217dc9a-737b-4039-93c9-4675f52c69a5");
    expect(item.title).toBe("AK-47 | Redline (Well-Worn)");
    expect(item.price.USD).toBe("2474");
    expect(item.extra.floatValue).toBeCloseTo(0.4297356605529785, 12);
    expect(item.extra.paintSeed).toBe(289);
    expect(item.extra.phase).toBe("");
    expect(item.extra.category).not.toBe("souvenir");
  });

  it("maps CATEGORY_SOUVENIR to the legacy 'souvenir' marker", () => {
    const item = mapV2Offer({
      ...v2Offer,
      attributes: {
        ...v2Offer.attributes,
        cs2: { ...v2Offer.attributes.cs2, category: "CATEGORY_SOUVENIR" },
      },
    });
    expect(item.extra.category).toBe("souvenir");
  });

  it("yields NaN floatValue for missing/empty float so downstream skips it", () => {
    const noFloat = mapV2Offer({
      ...v2Offer,
      attributes: {
        ...v2Offer.attributes,
        cs2: { ...v2Offer.attributes.cs2, float: "" },
      },
    });
    // The sync loop's guard `!floatValue && floatValue !== 0` must reject NaN.
    expect(Number.isNaN(noFloat.extra.floatValue)).toBe(true);
    const f = noFloat.extra.floatValue;
    expect(!f && f !== 0).toBe(true);
  });

  it("tolerates absent cs2/attributes without throwing", () => {
    const item = mapV2Offer({ offerId: "x", priceCents: "100", attributes: { title: "T" } });
    expect(item.itemId).toBe("x");
    expect(item.price.USD).toBe("100");
    expect(Number.isNaN(item.extra.floatValue)).toBe(true);
  });
});
