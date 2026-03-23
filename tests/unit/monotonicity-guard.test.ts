import { describe, it, expect, beforeEach } from "vitest";
import { applyMonotonicityGuard, priceCache } from "../../server/engine/pricing.js";

describe("applyMonotonicityGuard", () => {
  beforeEach(() => {
    priceCache.clear();
  });

  it("clamps BS price to WW when BS > WW", () => {
    priceCache.set("M4A4 | Radiation Hazard:Well-Worn", 3374);
    const result = applyMonotonicityGuard(8400, "M4A4 | Radiation Hazard", 0.55);
    expect(result).toBe(3374);
  });

  it("does not clamp when BS < WW", () => {
    priceCache.set("M4A4 | Radiation Hazard:Well-Worn", 3374);
    const result = applyMonotonicityGuard(2000, "M4A4 | Radiation Hazard", 0.55);
    expect(result).toBe(2000);
  });

  it("skips for FN (no better condition)", () => {
    const result = applyMonotonicityGuard(50000, "AK-47 | Redline", 0.03);
    expect(result).toBe(50000);
  });

  it("skips when no better condition price exists", () => {
    // WW has no FT price in cache
    const result = applyMonotonicityGuard(5000, "Some Skin", 0.42);
    expect(result).toBe(5000);
  });

  it("clamps WW to FT when WW > FT", () => {
    priceCache.set("AK-47 | Safari Mesh:Field-Tested", 1500);
    const result = applyMonotonicityGuard(2000, "AK-47 | Safari Mesh", 0.42);
    expect(result).toBe(1500);
  });

  it("clamps FT to MW when FT > MW", () => {
    priceCache.set("P250 | Undertow:Minimal Wear", 800);
    const result = applyMonotonicityGuard(1200, "P250 | Undertow", 0.25);
    expect(result).toBe(800);
  });

  it("does not walk up chain — only checks immediate better condition", () => {
    // BS with no WW price, but FT price exists — should NOT use FT
    priceCache.set("Some Skin:Field-Tested", 1000);
    // No WW entry
    const result = applyMonotonicityGuard(5000, "Some Skin", 0.55);
    expect(result).toBe(5000); // unchanged — WW not found, stop
  });
});
