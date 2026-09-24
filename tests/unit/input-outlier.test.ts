import { describe, it, expect } from "vitest";
import { storedInputCost } from "../../server/engine/fees.js";
import {
  exceedsReferenceCap,
  inputReferenceCents,
  isInputPriceOutlier,
} from "../../server/engine/input-outlier.js";
import { ratioBucket as scriptRatioBucket } from "../../scripts/mark-outlier-stale.js";

const SKIN = "Five-SeveN | Fraise Crane";
const FT = "Field-Tested";

function maps(ref?: number, sp?: number) {
  return {
    ref: ref === undefined ? new Map<string, number>() : new Map([[`${SKIN}:${FT}`, ref]]),
    skinport: sp === undefined ? new Map<string, number>() : new Map([[`${SKIN}:${FT}`, sp]]),
  };
}

/** Discovery's previous inline predicate, copied so the refactor can be checked against it. */
function oldKeeps(price: number, ref: number | undefined, sp: number | undefined): boolean {
  const effectiveRef = ref && sp ? Math.min(ref, sp) : (sp ?? ref);
  return !effectiveRef || price <= effectiveRef * 5;
}

function newKeeps(price: number, ref: number | undefined, sp: number | undefined): boolean {
  const built = maps(ref, sp);
  return !exceedsReferenceCap(price, inputReferenceCents(SKIN, FT, built));
}

describe("isInputPriceOutlier", () => {
  const old = 1000;

  it("with a ref, exactly 5x is not an outlier even when the stored price jumps", () => {
    const raw = 1000 * 5;
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: raw, oldPriceCents: old,
      feeSource: "dmarket", refCents: 1000,
    })).toBe(false);
  });

  it("with a ref, 5x+1 and a stored jump over 3x is an outlier", () => {
    const raw = 1000 * 5 + 1;
    const stored = storedInputCost(raw, "dmarket");
    expect(stored).toBeGreaterThan(3 * old);
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: raw, oldPriceCents: old,
      feeSource: "dmarket", refCents: 1000,
    })).toBe(true);
  });

  it("with a ref, 5x+1 is not an outlier when the stored price did not jump 3x", () => {
    const raw = 1000 * 5 + 1;
    const already = storedInputCost(raw, "csfloat");
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: raw, oldPriceCents: already,
      feeSource: "csfloat", refCents: 1000,
    })).toBe(false);
  });

  it("with a ref, a missing or zero old price is not an outlier", () => {
    const raw = 9_999_900;
    for (const oldPrice of [undefined, null, 0]) {
      expect(isInputPriceOutlier({
        skinName: SKIN, condition: FT, newPriceCents: raw, oldPriceCents: oldPrice,
        feeSource: "dmarket", refCents: 17,
      })).toBe(false);
    }
  });

  it("uses min(CSFloat, Skinport), and a single source when only one exists", () => {
    expect(inputReferenceCents(SKIN, FT, maps(100, 40))).toBe(40);
    expect(inputReferenceCents(SKIN, FT, maps(100, undefined))).toBe(100);
    expect(inputReferenceCents(SKIN, FT, maps(undefined, 40))).toBe(40);
    expect(inputReferenceCents(SKIN, FT, maps())).toBeUndefined();
  });

  it("with no ref, flags only a stored jump over 20x and more than $50", () => {
    const oldPrice = 1000;
    const justOver = Math.ceil((20 * oldPrice + 1) / 1.025);
    expect(storedInputCost(justOver, "dmarket")).toBeGreaterThan(20 * oldPrice);
    expect(storedInputCost(justOver, "dmarket") - oldPrice).toBeGreaterThan(5000);
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: justOver, oldPriceCents: oldPrice,
      feeSource: "dmarket",
    })).toBe(true);

    const exact = 20 * oldPrice;
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: exact, oldPriceCents: oldPrice,
      feeSource: "skinport",
    })).toBe(false);

    const smallBase = 100;
    const ratioMet = 20 * smallBase + 1;
    expect(ratioMet - smallBase).toBeLessThanOrEqual(5000);
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: ratioMet, oldPriceCents: smallBase,
      feeSource: "skinport",
    })).toBe(false);

    const jumpOnly = oldPrice + 5001;
    expect(jumpOnly).toBeLessThanOrEqual(20 * oldPrice);
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: jumpOnly, oldPriceCents: oldPrice,
      feeSource: "skinport",
    })).toBe(false);

    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: 9_999_900, oldPriceCents: undefined,
      feeSource: "dmarket",
    })).toBe(false);
  });

  it("the no-ref fallback compares the fee-inclusive new price", () => {
    const oldPrice = 1000;
    const raw = 20_000;
    const feeInclusive = storedInputCost(raw, "csfloat");
    expect(feeInclusive).toBeGreaterThan(20 * oldPrice);
    expect(raw).toBeLessThanOrEqual(20 * oldPrice);
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: raw, oldPriceCents: oldPrice,
      feeSource: "csfloat",
    })).toBe(true);
    expect(isInputPriceOutlier({
      skinName: SKIN, condition: FT, newPriceCents: raw, oldPriceCents: oldPrice,
      feeSource: "skinport",
    })).toBe(false);
  });
});

describe("discovery predicate equivalence", () => {
  const prices = [0, 1, 5, 50, 51, 200, 250, 251, 1000];
  const refs = [undefined, 0, 10, 50, 100];
  const sps = [undefined, 0, 8, 40, 200];

  it("matches the old inline filter, including empty maps", () => {
    for (const price of prices) {
      for (const ref of refs) {
        for (const sp of sps) {
          const refVal = ref && ref > 0 ? ref : undefined;
          const spVal = sp && sp > 0 ? sp : undefined;
          expect(newKeeps(price, refVal, spVal)).toBe(oldKeeps(price, refVal, spVal));
        }
      }
    }
    expect(newKeeps(999, undefined, undefined)).toBe(true);
    expect(oldKeeps(999, undefined, undefined)).toBe(true);
  });
});

describe("ratio buckets", () => {
  it("starts above 5x and splits at 10, 50, and 1000", () => {
    expect(scriptRatioBucket(50, 10)).toBeNull();
    expect(scriptRatioBucket(51, 10)).toBe("5-10x");
    expect(scriptRatioBucket(100, 10)).toBe("5-10x");
    expect(scriptRatioBucket(101, 10)).toBe("10-50x");
    expect(scriptRatioBucket(500, 10)).toBe("10-50x");
    expect(scriptRatioBucket(501, 10)).toBe("50-1000x");
    expect(scriptRatioBucket(9999, 10)).toBe("50-1000x");
    expect(scriptRatioBucket(10000, 10)).toBe("1000x+");
  });
});
