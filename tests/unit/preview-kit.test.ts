import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

describe("preview uses dashboard-saas kit primitives", () => {
  it("ships Outlay tokens, Ledger laptop geometry, and Orbit phone frames", () => {
    const theme = read("../../src/preview/kit/outlay/theme.css");
    const laptop = read("../../src/preview/kit/ledger/laptop.tsx");
    const laptopCss = read("../../src/preview/kit/ledger/laptop.css");
    const phone = read("../../src/preview/kit/orbit/phone.tsx");
    const motion = read("../../src/preview/kit/lib/motion.ts");
    const chart = read("../../src/preview/kit/primitives/chart-figure.tsx");

    expect(theme).toContain('[data-system="outlay"]');
    expect(theme).toContain("#d7fe52");
    expect(laptop).toContain("lg-scene");
    expect(laptop).toContain("usePointerTilt");
    expect(laptopCss).toContain(".lg-scene");
    expect(laptopCss).toContain("perspective: 1300px");
    expect(phone).toContain("o-phone");
    expect(phone).toContain("usePointerTilt");
    expect(motion).toContain("useScrollProgress");
    expect(chart).toContain("ChartFigure");
  });

  it("does not restyle TradeUpTable as the preview board", () => {
    const board = read("../../src/preview/pages/PreviewBoard.tsx");
    expect(board).not.toContain("TradeUpTable");
    expect(board).toContain("bento");
    expect(board).toContain("DELAY_BANNER");
  });

  it("keeps board tiles compact and drops fake / flat odds charts", () => {
    const board = read("../../src/preview/pages/PreviewBoard.tsx");
    const css = read("../../src/preview/preview.css");
    const lib = read("../../src/preview/lib/board.ts");
    expect(board).not.toContain("ProfitSpark");
    expect(board).not.toContain("profitLossSeries");
    expect(board).not.toContain("oddsBarSegments");
    expect(board).not.toContain("OddsBar");
    expect(board).toContain("payoffPoints");
    expect(board).toContain("waterfallBars");
    expect(board).toContain("cdfCurve");
    expect(lib).not.toContain("profitLossSeries");
    expect(lib).not.toContain("oddsBarSegments");
    expect(lib).not.toContain("Math.sin");
    expect(css).not.toContain("min-height: 280px");
    expect(css).not.toContain("min-height: 140px");
    expect(css).not.toMatch(/220px/);
    expect(css).toContain("preview-skin--input");
    expect(css).toContain("preview-skin--output");
    expect(css).toContain("preview-payoff");
    expect(css).toContain("var(--r-panel)");
  });
});

describe("preview craft bar", () => {
  const css = read("../../src/preview/preview.css");
  const board = read("../../src/preview/pages/PreviewBoard.tsx");
  const theme = read("../../src/preview/kit/outlay/theme.css");

  it("draws every corner from an Outlay radius token", () => {
    expect(theme).toContain("--r-panel: 6px");
    expect(theme).toContain("--r-control: 4px");
    expect(theme).toContain("--step: 4px");
    const allowed = new Set(["var(--r-panel)", "var(--r-control)", "var(--r-chip)", "50%", "0"]);
    const invented = [...css.matchAll(/border-radius:\s*([^;]+);/g)]
      .flatMap((match) => (match[1] ?? "").trim().split(/\s+/))
      .filter((corner) => !allowed.has(corner));
    expect(invented).toEqual([]);
  });

  it("tints skin tiles with the rarity and inks the name with it", () => {
    expect(css).toMatch(/--skin-tint/);
    expect(css).toMatch(/--skin-ink/);
    expect(css).toMatch(/color-mix\([^)]*var\(--skin-tint\)/);
    expect(board).toContain("splitSkinName");
    expect(board).toContain("conditionShort");
  });

  it("gives the payoff strip and the bar tracks a real ground, not a hairline", () => {
    expect(css).toMatch(/\.preview-payoff\s*\{[^}]*background:/);
    expect(css).toMatch(/\.preview-paybar__track\s*\{[^}]*background:/);
  });

  it("expands into strip + waterfall + CDF + listings + Verify/Claim, not listings only", () => {
    expect(board).toContain("preview-expand__inputs");
    expect(board).toContain("preview-expand__viz");
    expect(board).toContain("preview-expand__listings");
    expect(board).toContain("waterfallBars");
    expect(board).toContain("cdfCurve");
    expect(board).toContain("verifyClaimHref");
    expect(board).toContain("evDrivers");
    expect(css).toContain(".preview-expand");
  });

  it("keeps the Qty chip and the flat stacked odds bar off the card", () => {
    expect(board).not.toMatch(/Qty/);
    expect(board).not.toContain("inputQty");
    expect(board).not.toContain("preview-kpis");
    expect(css).not.toContain(".preview-kpis");
  });

  it("keeps lime a CTA fill and a focus ring — never a rarity, status, or series", () => {
    const limeSelectors = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((rule) => /var\(--accent\)/.test(rule[2] ?? ""))
      .map((rule) => (rule[1] ?? "").trim());
    expect(limeSelectors.length).toBeGreaterThan(0);
    for (const selector of limeSelectors) {
      expect(selector, selector).toContain("preview-btn--lime");
    }
    const accentBorderProps = [...css.matchAll(/([a-z-]+)\s*:[^;{}]*var\(--accent-border\)/g)]
      .map((match) => match[1]);
    expect([...new Set(accentBorderProps)]).toEqual(["outline"]);
    expect(css).not.toContain("var(--accent-text)");
    expect(board).not.toContain("--accent");
  });

  it("shows no invented time series on the landing device", () => {
    const device = read("../../src/preview/components/DeviceScreen.tsx");
    expect(device).not.toMatch(/\bW[1-8]\b/);
    expect(device).not.toMatch(/8 weeks/);
    expect(device).not.toContain("AreaChart");
    expect(device).not.toContain("BarChart");
  });
});
