import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_FEES, effectiveBuyCostRaw } from "../../server/engine/fees.js";
import {
  CALCULATOR_EXAMPLE_FEE_LINE,
  CALCULATOR_FEE_LINE,
  MODELED_FEES,
  REPRICE_DROPS_BUYER_FEE,
  OUTCOME_SELL_MARKET,
  boardFeeLine,
  buyerFeeLabel,
  feeMarketsFor,
} from "../../src/preview/lib/fees.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

describe("fee copy mirrors the engine's modeled fees", () => {
  it("lists the same buyer and seller fees as MARKETPLACE_FEES", () => {
    expect(Object.keys(MODELED_FEES).sort()).toEqual(Object.keys(MARKETPLACE_FEES).sort());
    for (const [market, engine] of Object.entries(MARKETPLACE_FEES)) {
      const copy = MODELED_FEES[market as keyof typeof MODELED_FEES];
      expect(copy.buyerFeePct, market).toBe(engine.buyerFeePct);
      expect(copy.buyerFeeFlatCents, market).toBe(engine.buyerFeeFlat);
      expect(copy.sellerFeePct, market).toBe(engine.sellerFee);
      expect(Number.isInteger(copy.buyerFeeFlatCents), market).toBe(true);
    }
  });

  it("names the market every outcome price is netted against", () => {
    const pricing = read("../../server/engine/pricing.ts");
    const netted = [...pricing.matchAll(/effectiveSellProceeds\([^,]+,\s*"([a-z]+)"\)/g)].map((m) => m[1]);
    expect(netted.length).toBeGreaterThan(0);
    expect(new Set(netted)).toEqual(new Set([OUTCOME_SELL_MARKET]));
  });

  it("hedges the board cost until every reprice path applies the buyer fee", () => {
    const reprices = [
      "../../server/csfloat-checker.ts",
      "../../server/sync/listings.ts",
      "../../server/routes/trade-ups.ts",
    ];
    const repricesKeepFee = reprices.every((file) => read(file).includes("effectiveBuyCost"));
    expect(REPRICE_DROPS_BUYER_FEE).toBe(!repricesKeepFee);
  });

  it("matches the calculator, which adds no buyer fee to entered prices", () => {
    const route = read("../../server/routes/calculator.ts");
    expect(route).toContain('source: "calculator"');
    expect(effectiveBuyCostRaw(1234, "calculator")).toBe(1234);
    expect(CALCULATOR_FEE_LINE.cost).toMatch(/no buyer fee/i);
    expect(CALCULATOR_FEE_LINE.outcomes).toContain("CSFloat");
    expect(CALCULATOR_FEE_LINE.outcomes).toContain("2%");
  });
});

describe("fee labels", () => {
  it("prints percent plus the flat deposit in dollars", () => {
    expect(buyerFeeLabel("csfloat")).toBe("CSFloat 2.8% + $0.30");
    expect(buyerFeeLabel("dmarket")).toBe("DMarket 2.5%");
    expect(buyerFeeLabel("skinport")).toBe("Skinport 0%");
    expect(buyerFeeLabel("buff")).toBe("Buff 3.5% + $0.15");
  });

  it("keeps a card's markets in a fixed order, once each, and drops unknown sources", () => {
    expect(feeMarketsFor(["dmarket", "csfloat", "dmarket", "calculator", undefined])).toEqual(["csfloat", "dmarket"]);
    expect(feeMarketsFor([])).toEqual([]);
  });

  it("lists every market on the board and only the card's markets on a card", () => {
    const board = boardFeeLine();
    expect(board.cost).toBe(
      "Cost adds buyer fees when a trade-up is found (CSFloat 2.8% + $0.30, DMarket 2.5%, Skinport 0%, Buff 3.5% + $0.15). "
      + "Listings re-priced since then count at their listed price.",
    );
    expect(board.outcomes).toBe("Outcome prices are after CSFloat's 2% seller fee.");
    expect(boardFeeLine(["skinport", "csfloat"]).cost).toBe(
      "Cost adds buyer fees when a trade-up is found (CSFloat 2.8% + $0.30, Skinport 0%). "
      + "Listings re-priced since then count at their listed price.",
    );
    expect(boardFeeLine(["calculator"]).cost).toBe(board.cost);
  });

  it("keeps the unhedged wording one switch away", () => {
    expect(boardFeeLine(["csfloat"], false).cost).toBe("Cost includes buyer fees: CSFloat 2.8% + $0.30.");
  });

  it("says the example is priced at its listed prices", () => {
    expect(CALCULATOR_EXAMPLE_FEE_LINE.cost).toBe("Cost is the example's listed prices, with no buyer fee added.");
    expect(CALCULATOR_EXAMPLE_FEE_LINE.outcomes).toBe(CALCULATOR_FEE_LINE.outcomes);
  });
});

describe("fee line placement", () => {
  const board = read("../../src/preview/pages/PreviewBoard.tsx");
  const calc = read("../../src/preview/pages/PreviewCalculator.tsx");
  const component = read("../../src/preview/components/FeeLine.tsx");

  it("sits on the board, on the expanded KPI strip, and on the calculator", () => {
    expect(board.match(/<FeeLine\b/g)?.length).toBe(2);
    expect(board).toContain("boardFeeLine()");
    expect(board).toMatch(/boardFeeLine\(tu\.inputs\.map/);
    expect(calc).toContain("<FeeLine");
    expect(calc).toContain("isExample ? CALCULATOR_EXAMPLE_FEE_LINE : CALCULATOR_FEE_LINE");
  });

  it("uses kit chrome and says trade-up, never contract", () => {
    for (const source of [component, read("../../src/preview/lib/fees.ts")]) {
      expect(source).not.toMatch(/\b[Cc]ontracts?\b/);
      expect(source).not.toContain("text-muted-foreground");
      expect(source).not.toContain("rounded-md");
    }
    expect(read("../../src/preview/preview.css")).toContain(".preview-fees");
  });
});
