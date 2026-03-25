import { describe, it, expect, beforeEach } from "vitest";
import {
  classifySkinCurve,
  curveCache,
  comboCurveScore,
  shouldUseValueRatio,
  type CurveData,
  type CurveScore,
  type ComboOutcome,
} from "../../server/engine/curve-classification.js";

function makeCurveData(overrides: Partial<CurveData> = {}): CurveData {
  return {
    fnAvg: 0, fnStd: 0, fnCount: 0,
    mwAvg: 0, mwStd: 0, mwCount: 0,
    ftAvg: 0, ftStd: 0, ftCount: 0,
    wwAvg: 0, wwStd: 0, wwCount: 0,
    bsAvg: 0, bsStd: 0, bsCount: 0,
    ...overrides,
  };
}

describe("classifySkinCurve", () => {
  it("staircase: high condition ratio, low intra-condition CV", () => {
    // Big jumps between conditions (FN=10000, FT=2500) but tight within each
    const data = makeCurveData({
      fnAvg: 10000, fnStd: 500, fnCount: 20,
      mwAvg: 6000, mwStd: 300, mwCount: 15,
      ftAvg: 2500, ftStd: 200, ftCount: 30,
    });
    const score = classifySkinCurve(data);
    expect(score).not.toBeNull();
    expect(score!.conditionRatio).toBe(10000 / 2500); // 4.0
    expect(score!.intraConditionCV).toBeCloseTo(
      ((500 / 10000) * 100 + (300 / 6000) * 100 + (200 / 2500) * 100) / 3
    );
    expect(score!.conditionRatio).toBeGreaterThan(3);
    expect(score!.intraConditionCV).toBeLessThan(30);
  });

  it("flat: low condition ratio, low intra-condition CV", () => {
    // All conditions priced similarly (Blue Steel knife pattern)
    const data = makeCurveData({
      fnAvg: 5000, fnStd: 200, fnCount: 10,
      mwAvg: 4800, mwStd: 150, mwCount: 12,
      ftAvg: 4500, ftStd: 180, ftCount: 20,
      wwAvg: 4300, wwStd: 100, wwCount: 8,
      bsAvg: 4200, bsStd: 90, bsCount: 6,
    });
    const score = classifySkinCurve(data);
    expect(score).not.toBeNull();
    expect(score!.conditionRatio).toBeCloseTo(5000 / 4200);
    expect(score!.conditionRatio).toBeLessThan(1.5);
    expect(score!.intraConditionCV).toBeLessThan(30);
  });

  it("smooth: high intra-condition CV (float precision matters)", () => {
    // Glove-like: big variation within conditions (low float = premium)
    const data = makeCurveData({
      fnAvg: 20000, fnStd: 8000, fnCount: 10,
      mwAvg: 10000, mwStd: 4000, mwCount: 15,
      ftAvg: 5000, ftStd: 2000, ftCount: 25,
    });
    const score = classifySkinCurve(data);
    expect(score).not.toBeNull();
    // CV per condition: (8000/20000)*100=40, (4000/10000)*100=40, (2000/5000)*100=40
    expect(score!.intraConditionCV).toBeCloseTo(40);
    expect(score!.intraConditionCV).toBeGreaterThan(30);
  });

  it("insufficient data: returns null when fewer than 2 conditions qualify", () => {
    // Only FN has enough observations
    const data = makeCurveData({
      fnAvg: 10000, fnStd: 500, fnCount: 20,
      mwAvg: 6000, mwStd: 300, mwCount: 3, // <5, excluded
      ftAvg: 0, ftStd: 0, ftCount: 0,
    });
    expect(classifySkinCurve(data)).toBeNull();
  });

  it("filters out conditions with avg <= 0", () => {
    const data = makeCurveData({
      fnAvg: 10000, fnStd: 500, fnCount: 20,
      mwAvg: 0, mwStd: 0, mwCount: 10, // avg=0, excluded
      ftAvg: 5000, ftStd: 200, ftCount: 15,
    });
    const score = classifySkinCurve(data);
    expect(score).not.toBeNull();
    // Only FN and FT qualify
    expect(score!.conditionRatio).toBe(10000 / 5000);
  });
});

describe("comboCurveScore", () => {
  beforeEach(() => {
    curveCache.clear();
  });

  it("weighted average across multiple outcomes", () => {
    // Populate cache with known scores
    curveCache.set("AK-47 | Fire Serpent", { conditionRatio: 4.0, intraConditionCV: 10 });
    curveCache.set("M4A1-S | Hyper Beast", { conditionRatio: 2.0, intraConditionCV: 40 });

    const outcomes: ComboOutcome[] = [
      { skinName: "AK-47 | Fire Serpent", probability: 0.6, estimatedPrice: 10000 },
      { skinName: "M4A1-S | Hyper Beast", probability: 0.4, estimatedPrice: 5000 },
    ];

    const score = comboCurveScore(outcomes);
    expect(score).not.toBeNull();

    // EV-weighted: weight = probability * estimatedPrice
    // AK weight: 0.6 * 10000 = 6000
    // M4 weight: 0.4 * 5000 = 2000
    // Total weight: 8000
    // conditionRatio: (6000*4.0 + 2000*2.0) / 8000 = (24000 + 4000) / 8000 = 3.5
    // intraConditionCV: (6000*10 + 2000*40) / 8000 = (60000 + 80000) / 8000 = 17.5
    expect(score!.conditionRatio).toBeCloseTo(3.5);
    expect(score!.intraConditionCV).toBeCloseTo(17.5);
  });

  it("returns null when no outcomes have cached curve data", () => {
    // Cache is empty
    const outcomes: ComboOutcome[] = [
      { skinName: "Unknown Skin", probability: 0.5, estimatedPrice: 5000 },
      { skinName: "Another Unknown", probability: 0.5, estimatedPrice: 3000 },
    ];
    expect(comboCurveScore(outcomes)).toBeNull();
  });

  it("skips outcomes without cache entries", () => {
    curveCache.set("AK-47 | Fire Serpent", { conditionRatio: 4.0, intraConditionCV: 10 });

    const outcomes: ComboOutcome[] = [
      { skinName: "AK-47 | Fire Serpent", probability: 0.6, estimatedPrice: 10000 },
      { skinName: "Unknown Skin", probability: 0.4, estimatedPrice: 5000 }, // no cache
    ];

    const score = comboCurveScore(outcomes);
    expect(score).not.toBeNull();
    // Only AK contributes, so score equals its cache entry
    expect(score!.conditionRatio).toBeCloseTo(4.0);
    expect(score!.intraConditionCV).toBeCloseTo(10);
  });
});

describe("shouldUseValueRatio", () => {
  it("returns true when intraConditionCV > 30 (float precision pays off)", () => {
    expect(shouldUseValueRatio({ conditionRatio: 2.0, intraConditionCV: 35 })).toBe(true);
  });

  it("returns false when intraConditionCV <= 30 (cost-minimize)", () => {
    expect(shouldUseValueRatio({ conditionRatio: 4.0, intraConditionCV: 10 })).toBe(false);
  });

  it("returns null when score is null (use default balanced approach)", () => {
    expect(shouldUseValueRatio(null)).toBeNull();
  });
});
