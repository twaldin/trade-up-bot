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
});
