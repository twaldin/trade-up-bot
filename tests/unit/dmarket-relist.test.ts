import { describe, expect, it } from "vitest";
import {
  assetIdFromInspect,
  isExactDMarketRelist,
  pickDMarketRelist,
  type RelistCandidate,
  type RelistIdentity,
} from "../../server/dmarket-relist.js";
import { parseReviveArgs } from "../../scripts/revive-dmarket-relists.js";

const missing: RelistIdentity = {
  skinName: "MP7 | Abyssal Apparition",
  floatValue: 0.1523456789,
  paintSeed: 412,
  assetId: null,
};

function candidate(overrides: Partial<RelistCandidate> = {}): RelistCandidate {
  return {
    id: "dmarket:new-offer",
    skinName: missing.skinName,
    floatValue: missing.floatValue + 5e-8,
    paintSeed: 412,
    assetId: null,
    ...overrides,
  };
}

describe("isExactDMarketRelist", () => {
  it("matches the same skin within 1e-7 float when paint seeds agree", () => {
    expect(isExactDMarketRelist(missing, candidate())).toBe(true);
  });

  it("rejects a float further than 1e-7", () => {
    expect(isExactDMarketRelist(missing, candidate({ floatValue: missing.floatValue + 2e-7 }))).toBe(false);
  });

  it("rejects a different skin", () => {
    expect(isExactDMarketRelist(missing, candidate({ skinName: "MP7 | Fade" }))).toBe(false);
  });

  it("rejects a different paint seed when both are known", () => {
    expect(isExactDMarketRelist(missing, candidate({ paintSeed: 7 }))).toBe(false);
  });

  it("allows an unknown paint seed on either side", () => {
    expect(isExactDMarketRelist({ ...missing, paintSeed: null }, candidate({ paintSeed: 7 }))).toBe(true);
    expect(isExactDMarketRelist(missing, candidate({ paintSeed: null }))).toBe(true);
  });

  it("prefers a shared asset id over float", () => {
    const withAsset = { ...missing, assetId: "40000000000" };
    expect(isExactDMarketRelist(withAsset, candidate({
      assetId: "40000000000",
      floatValue: 0.99,
      paintSeed: 1,
    }))).toBe(true);
    expect(isExactDMarketRelist(withAsset, candidate({ assetId: "999", floatValue: missing.floatValue }))).toBe(false);
  });
});

describe("pickDMarketRelist", () => {
  it("returns the single relist", () => {
    const match = candidate();
    const picked = pickDMarketRelist(missing, [match, candidate({ id: "dmarket:other", skinName: "AWP | Fade" })]);
    expect(picked).toEqual({ ok: true, match });
  });

  it("skips when nothing matches", () => {
    expect(pickDMarketRelist(missing, [candidate({ skinName: "AWP | Fade" })])).toEqual({
      ok: false,
      reason: "no_relist",
    });
  });

  it("skips two float-equal listings as ambiguous", () => {
    const picked = pickDMarketRelist(missing, [
      candidate({ id: "dmarket:a" }),
      candidate({ id: "dmarket:b" }),
    ]);
    expect(picked).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("uses the asset id to break an otherwise ambiguous float pair", () => {
    const withAsset = { ...missing, assetId: "40000000000" };
    const picked = pickDMarketRelist(withAsset, [
      candidate({ id: "dmarket:a", assetId: null }),
      candidate({ id: "dmarket:b", assetId: "40000000000" }),
    ]);
    expect(picked.ok).toBe(true);
    if (picked.ok) expect(picked.match.id).toBe("dmarket:b");
  });
});

describe("parseReviveArgs", () => {
  it("defaults to a 36h dry-run", () => {
    expect(parseReviveArgs([])).toEqual({ dryRun: true, hold: false, hours: 36 });
  });

  it("rejects combining --apply with --dry-run", () => {
    expect(() => parseReviveArgs(["--apply", "--dry-run"])).toThrow(/not both/);
  });
});

describe("assetIdFromInspect", () => {
  it("reads the A…D asset id from an inspect URI", () => {
    const uri = "steam://run/730//+csgo_econ_action_preview%20S76561199000000001A40000000000D4649654965123456789";
    expect(assetIdFromInspect(uri)).toBe("40000000000");
  });

  it("returns null when the payload has no inspect asset id", () => {
    expect(assetIdFromInspect(null)).toBeNull();
    expect(assetIdFromInspect("steam://run/730")).toBeNull();
  });
});
