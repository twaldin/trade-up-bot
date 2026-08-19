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
    expect(css).toContain("preview-skins--in");
    expect(css).toContain("preview-skins--out");
    expect(css).toContain("preview-strip");
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

  it("draws the payoff strip as a slim tick scale, not fat orbs", () => {
    expect(css).toMatch(/\.preview-strip\s*\{[^}]*background:/);
    expect(css).toMatch(/\.preview-strip__tick\s*\{[^}]*width:\s*2px/);
    expect(css).not.toContain("preview-payoff__dot");
    expect(board).not.toContain("PayoffBars");
  });

  it("expands into strip + waterfall + CDF + listings + Verify/Claim, not listings only", () => {
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

  it("makes lime the profit colour and pairs it with one loss red", () => {
    expect(css).toMatch(/--profit:\s*var\(--accent\)/);
    expect(css).toMatch(/--profit-ink:\s*var\(--accent-text\)/);
    expect(css).toMatch(/--loss:\s*#/);
    // Not the Covert rarity red: a loss must never read as a rarity.
    expect(css.toLowerCase()).not.toMatch(/--loss:\s*#eb4b4b/);
    for (const rule of ["is-plus", "is-minus"]) {
      expect(css).toContain(rule);
    }
  });

  it("keeps a foreign green off the board — no third status colour", () => {
    expect(css).not.toContain("var(--success)");
    expect(css).not.toContain("var(--danger)");
    expect(board).not.toContain("var(--success)");
    expect(board).not.toContain("var(--danger)");
    expect(board).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("shows a real board capture on the landing device, not charts or live HTML", () => {
    const device = read("../../src/preview/components/DeviceScreen.tsx");
    expect(device).not.toMatch(/\bW[1-8]\b/);
    expect(device).not.toContain("AreaChart");
    expect(device).not.toContain("BarChart");
    expect(device).not.toContain("TradeUpCard");
    expect(device).toContain("board-desktop-dark.webp");
    expect(device).toContain("board-mobile-light.webp");
  });

  it("runs inputs into outputs through one arrow, with no duplicate input grid", () => {
    expect(board).toContain("FlowRow");
    expect(board).toContain("preview-flow__arrow");
    expect(board).not.toContain("preview-expand__inputs");
    expect(board).not.toContain("preview-skins--compact");
    // stacked by default, one row once the card is full width
    expect(css).toMatch(/\.preview-flow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.preview-card--expanded \.preview-flow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 20px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.preview-flow__arrow\s*\{[^}]*transform: rotate\(90deg\)/);
  });

  it("puts the outcome render on its tick and lets crowded ticks fade", () => {
    expect(board).toContain("tickFaceLayout");
    expect(board).toContain("preview-strip__face");
    expect(css).toMatch(/\.preview-strip__face\.is-end\s*\{\s*transform: translateX\(-100%\)/);
    expect(css).toMatch(/\.preview-strip\.is-crowded \.preview-strip__face\s*\{[^}]*opacity/);
    expect(css).toMatch(/\.preview-strip__face\.is-hot\s*\{[^}]*opacity: 1/);
  });

  it("steps nested surfaces away from the page instead of punching a black hole", () => {
    expect(css).toMatch(/--nest-2:\s*#eeebe8/);
    expect(css).toMatch(/--nest-3:\s*#ebe7e3/);
    expect(css).toMatch(/--nest-2:\s*#262523/);
    expect(css).toMatch(/--nest-3:\s*#2b2a27/);
    // no raw hex plot fills, and no reach for the theme's downward well
    expect(css).not.toContain("var(--sunken)");
    expect(css).toMatch(/\.preview-wf__plot\s*\{[^}]*background: var\(--nest-3\)/);
    expect(css).toMatch(/\.preview-strip\s*\{[^}]*background: var\(--nest-2\)/);
  });

  it("names the waterfall total expected profit, not total EV", () => {
    expect(board).toContain("Expected profit");
    expect(board).not.toContain("Total EV");
    expect(board).toContain("EV contribution (p × P/L)");
    // outputs get a face on the chart and in the ranked lists
    expect(board).toContain("preview-wf__face");
    expect(board).toContain("preview-rank__face");
  });

  it("labels charts with the Outlay kicker, not a ChartFigure data table", () => {
    expect(board).not.toContain("ChartFigure");
    expect(board).not.toContain("data table");
    expect(board).toContain("o-kicker");
    // Chrome will not clip a table caption with overflow alone.
    expect(css).toMatch(/\[data-preview\] \.sr-only[\s\S]*clip-path: inset\(50%\)/);
  });

  it("keeps production chrome utilities out of every preview surface", () => {
    const leaks = [
      "rounded-md", "rounded-lg", "rounded-xl", "rounded-full",
      "text-muted-foreground", "border-border", "bg-background", "bg-card",
      "text-foreground", "bg-muted", "text-primary",
    ];
    const surfaces = [
      "PreviewApp.tsx",
      "PreviewShell.tsx",
      "components/PreviewCurrency.tsx",
      "components/PreviewMark.tsx",
      "components/DeviceScreen.tsx",
      "pages/PreviewBoard.tsx",
      "pages/PreviewCalculator.tsx",
      "pages/PreviewAccount.tsx",
      "pages/PreviewLanding.tsx",
      "pages/PreviewSkins.tsx",
    ];
    for (const file of surfaces) {
      const source = read(`../../src/preview/${file}`);
      for (const leak of leaks) {
        expect(source, `${file} leaks ${leak}`).not.toContain(leak);
      }
    }
  });

  it("drives currency from a preview control, never the shadcn picker", () => {
    const shell = read("../../src/preview/PreviewShell.tsx");
    const app = read("../../src/preview/PreviewApp.tsx");
    expect(shell).not.toContain("CurrencyPicker");
    expect(app).not.toContain("CurrencyPicker");
    expect(shell).toContain("PreviewCurrency");
    const picker = read("../../src/preview/components/PreviewCurrency.tsx");
    expect(picker).toContain("useCurrency");
    expect(picker).toContain("preview-menu");
  });

  it("uses a lime plateless mark, not the production favicon", () => {
    const mark = read("../../src/preview/components/PreviewMark.tsx");
    const shell = read("../../src/preview/PreviewShell.tsx");
    const app = read("../../src/preview/PreviewApp.tsx");
    expect(mark).not.toContain("<rect");
    expect(mark).not.toContain("#22c55e");
    expect(css).toContain(".preview-mark { color: var(--accent); }");
    expect(shell).not.toContain("favicon.svg");
    expect(app).not.toContain("favicon.svg");
  });

  it("mounts skins and collections inside the preview shell", () => {
    const app = read("../../src/preview/PreviewApp.tsx");
    const shell = read("../../src/preview/PreviewShell.tsx");
    for (const path of ["skins", "skins/:slug", "collections", "collections/:name"]) {
      expect(app).toContain(`path="/preview/${path}"`);
    }
    expect(app).toMatch(/skins\|collections/);
    expect(shell).toContain("/preview/skins");
    expect(shell).toContain("/preview/collections");
  });
});
