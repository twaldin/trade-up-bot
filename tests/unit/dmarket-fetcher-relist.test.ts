import { describe, expect, it } from "vitest";
import {
  assetIdFromInspect,
  listingIdsToDelete,
  planDMarketRelinks,
  type DMarketRelinkPlan,
  type DMarketRelistSide,
  type RelinkApplyResult,
} from "../../server/dmarket-fetcher-relist.js";
import { formatDMarketStalenessLog } from "../../server/sync/dmarket.js";

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
      contested: 0,
    });
  });

  it("keeps a still-present offer and does not relink it", () => {
    const stored = side();
    expect(planDMarketRelinks([stored], [stored])).toEqual({ relinks: [], deleteIds: [], contested: 0 });
  });

  it("deletes a missing offer that has no relist", () => {
    const stored = side();
    const other = side({ id: "dmarket:other", skinName: "AWP | Fade", floatValue: 0.01 });
    expect(planDMarketRelinks([stored], [other])).toEqual({
      relinks: [],
      deleteIds: ["dmarket:old"],
      contested: 0,
    });
  });

  it("does not relink a different paint seed when both are known", () => {
    const stored = side();
    const incoming = side({ id: "dmarket:new", paintSeed: 7 });
    expect(planDMarketRelinks([stored], [incoming]).deleteIds).toEqual(["dmarket:old"]);
  });

  it("does not relink a different float just because both inspect links parsed the same asset id", () => {
    const stored = side({ assetId: "0", floatValue: 0.21 });
    const incoming = side({
      id: "dmarket:new",
      assetId: "0",
      floatValue: 0.87,
      paintSeed: stored.paintSeed,
      priceCents: 500,
    });
    const plan = planDMarketRelinks([stored], [incoming]);
    expect(plan.relinks).toEqual([]);
    expect(plan.deleteIds).toEqual(["dmarket:old"]);
  });

  it("uses a classic asset id only to break a float-and-seed tie", () => {
    const stored = side({ assetId: "40000000000" });
    const plan = planDMarketRelinks([stored], [
      side({ id: "dmarket:other", assetId: "111", priceCents: 400 }),
      side({ id: "dmarket:same", assetId: "40000000000", priceCents: 500 }),
    ]);
    expect(plan.relinks).toEqual([{ oldId: "dmarket:old", newId: "dmarket:same", priceCents: 500 }]);
  });

  it("does not match float 0 or paint seed 0", () => {
    const zeroFloat = planDMarketRelinks(
      [side({ floatValue: 0 })],
      [side({ id: "dmarket:new", floatValue: 0 })],
    );
    const zeroSeed = planDMarketRelinks(
      [side({ paintSeed: 0 })],
      [side({ id: "dmarket:new", paintSeed: 0 })],
    );
    expect(zeroFloat.relinks).toEqual([]);
    expect(zeroSeed.relinks).toEqual([]);
  });

  it("does not relink across Doppler phases when both sides have one", () => {
    const plan = planDMarketRelinks(
      [side({ phase: "Phase 1" })],
      [side({ id: "dmarket:new", phase: "Phase 2" })],
    );
    expect(plan.relinks).toEqual([]);
  });

  it("does not assign a contested offer to a later claimant", () => {
    const incoming = side({ id: "dmarket:new", priceCents: 500 });
    const plan = planDMarketRelinks([
      side({ id: "dmarket:a" }),
      side({ id: "dmarket:b" }),
      side({ id: "dmarket:c" }),
    ], [incoming]);
    expect(plan.relinks).toEqual([]);
    expect(plan.deleteIds.sort()).toEqual(["dmarket:a", "dmarket:b", "dmarket:c"]);
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

  it("reads the asset id from a classic Steam inspect link", () => {
    const classic = "steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S76561198000000000A40000000000D1234567890123456789";
    expect(assetIdFromInspect(classic)).toBe("40000000000");
  });

  it("does not read an asset id that is not at the start of the inspect argument", () => {
    const embedded = "steam://run/730//+csgo_econ_action_preview%2000S76561198000000000A40000000000D1234567890123456789";
    expect(assetIdFromInspect(embedded)).toBeNull();
  });

  it("returns null for Valve's hex preview link instead of a junk digit", () => {
    const hex = "steam://run/730//+csgo_econ_action_preview%20001C0C5A1B2D3E4F5A6B7C8D9E0F112233445566778899AABBCCDDEEFF001122";
    expect(assetIdFromInspect(hex)).toBeNull();
    expect(assetIdFromInspect("steam://run/730//+csgo_econ_action_preview%200018000000000000000000000000000000000000000000000000000000000000")).toBeNull();
  });
});

describe("listingIdsToDelete", () => {
  const plan: DMarketRelinkPlan = {
    relinks: [],
    deleteIds: ["dmarket:gone"],
    contested: 0,
  };
  const applied: RelinkApplyResult = {
    applied: 0,
    failedIds: ["dmarket:failed"],
    skipped: [{ oldId: "dmarket:skip", reason: "claimed_target" }],
    referenceLoadFailed: false,
  };

  it("includes unmatched, failed, and skipped ids", () => {
    expect(listingIdsToDelete(plan, applied).sort()).toEqual([
      "dmarket:failed",
      "dmarket:gone",
      "dmarket:skip",
    ]);
  });

  it("deletes nothing when the reference-price load failed", () => {
    expect(listingIdsToDelete(plan, { ...applied, referenceLoadFailed: true })).toEqual([]);
  });
});

describe("formatDMarketStalenessLog", () => {
  it("counts relinked, deleted, contested, and failed with skip reasons", () => {
    expect(formatDMarketStalenessLog({
      checked: 5,
      relinked: 2,
      deleted: 3,
      contested: 1,
      failed: 1,
      reasons: ["claimed_target", "new_id_already_input"],
    })).toBe(
      "    DMarket staleness: 5 checked, relinked 2 deleted 3 contested 1 failed 1 (claimed_target,new_id_already_input)",
    );
  });
});
