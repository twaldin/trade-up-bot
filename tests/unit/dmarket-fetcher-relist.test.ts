import { describe, expect, it } from "vitest";
import {
  assetIdFromInspect,
  planDMarketRelinks,
  type DMarketRelistSide,
} from "../../server/dmarket-fetcher-relist.js";

function side(overrides: Partial<DMarketRelistSide> = {}): DMarketRelistSide {
  return {
    id: "dmarket:old",
    skinName: "MP7 | Abyssal Apparition",
    floatValue: 0.1523456789,
    paintSeed: 412,
    assetId: null,
    priceCents: 554,
    ...overrides,
  };
}

describe("planDMarketRelinks", () => {
  it("relinks a missing offer onto the same skin, float, and paint seed", () => {
    const stored = side();
    const incoming = side({ id: "dmarket:new", priceCents: 538, floatValue: stored.floatValue + 5e-8 });
    expect(planDMarketRelinks([stored], [incoming])).toEqual({
      relinks: [{ oldId: "dmarket:old", newId: "dmarket:new", priceCents: 538 }],
      deleteIds: [],
    });
  });

  it("keeps a still-present offer and does not relink it", () => {
    const stored = side();
    expect(planDMarketRelinks([stored], [stored])).toEqual({ relinks: [], deleteIds: [] });
  });

  it("deletes a missing offer that has no relist", () => {
    const stored = side();
    const other = side({ id: "dmarket:other", skinName: "AWP | Fade", floatValue: 0.01 });
    expect(planDMarketRelinks([stored], [other])).toEqual({
      relinks: [],
      deleteIds: ["dmarket:old"],
    });
  });

  it("does not relink a different paint seed when both are known", () => {
    const stored = side();
    const incoming = side({ id: "dmarket:new", paintSeed: 7 });
    expect(planDMarketRelinks([stored], [incoming]).deleteIds).toEqual(["dmarket:old"]);
  });

  it("prefers a shared inspect asset id when the payload has one", () => {
    const stored = side({ assetId: "40000000000", floatValue: 0.2 });
    const incoming = side({
      id: "dmarket:new",
      assetId: "40000000000",
      floatValue: 0.9,
      paintSeed: 1,
      priceCents: 500,
    });
    const plan = planDMarketRelinks([stored], [incoming]);
    expect(plan.relinks).toEqual([{ oldId: "dmarket:old", newId: "dmarket:new", priceCents: 500 }]);
  });

  it("does not relink two stored rows onto one incoming offer", () => {
    const incoming = side({ id: "dmarket:new", priceCents: 500 });
    const plan = planDMarketRelinks([
      side({ id: "dmarket:a" }),
      side({ id: "dmarket:b" }),
    ], [incoming]);
    expect(plan.relinks).toEqual([]);
    expect(plan.deleteIds.sort()).toEqual(["dmarket:a", "dmarket:b"]);
  });
});

describe("assetIdFromInspect", () => {
  it("returns null when the offer has no inspect asset id", () => {
    expect(assetIdFromInspect(undefined)).toBeNull();
  });
});
