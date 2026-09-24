/**
 * Plain-language fee assumptions behind the board and calculator numbers.
 * Copy only — the engine applies the fees. `tests/unit/preview-fees.test.ts`
 * pins these values to `MARKETPLACE_FEES` so the label cannot drift.
 */

import { formatDollars } from "../../utils/format.js";

export type FeeMarket = "csfloat" | "dmarket" | "skinport" | "buff";

export type ModeledFee = {
  name: string;
  buyerFeePct: number;
  buyerFeeFlatCents: number;
  sellerFeePct: number;
};

export const MODELED_FEES: Record<FeeMarket, ModeledFee> = {
  csfloat: { name: "CSFloat", buyerFeePct: 0.028, buyerFeeFlatCents: 30, sellerFeePct: 0.02 },
  dmarket: { name: "DMarket", buyerFeePct: 0.025, buyerFeeFlatCents: 0, sellerFeePct: 0.02 },
  skinport: { name: "Skinport", buyerFeePct: 0, buyerFeeFlatCents: 0, sellerFeePct: 0.08 },
  buff: { name: "Buff", buyerFeePct: 0.035, buyerFeeFlatCents: 15, sellerFeePct: 0.025 },
};

/** Output prices are netted as a CSFloat sale, whichever market the price came from. */
export const OUTCOME_SELL_MARKET: FeeMarket = "csfloat";

const MARKET_ORDER: FeeMarket[] = ["csfloat", "dmarket", "skinport", "buff"];

export type FeeLineCopy = { cost: string; outcomes: string };

function percent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

export function buyerFeeLabel(market: FeeMarket): string {
  const fee = MODELED_FEES[market];
  const flat = fee.buyerFeeFlatCents > 0 ? ` + ${formatDollars(fee.buyerFeeFlatCents)}` : "";
  return `${fee.name} ${percent(fee.buyerFeePct)}${flat}`;
}

function isFeeMarket(source: string | undefined): source is FeeMarket {
  return source !== undefined && source in MODELED_FEES;
}

export function feeMarketsFor(sources: (string | undefined)[]): FeeMarket[] {
  const present = new Set(sources.filter(isFeeMarket));
  return MARKET_ORDER.filter((market) => present.has(market));
}

function outcomeFeeCopy(): string {
  const seller = MODELED_FEES[OUTCOME_SELL_MARKET];
  return `Outcome prices are after ${seller.name}'s ${percent(seller.sellerFeePct)} seller fee.`;
}

/**
 * False: cost copy says buyer fees are included. The hedged sentence stays
 * available by passing true, for a reprice path that stores the raw listed price.
 */
export const REPRICE_DROPS_BUYER_FEE = false;

/** Every market on the board; only the card's own markets once its listings load. */
export function boardFeeLine(
  sources: (string | undefined)[] = [],
  hedged: boolean = REPRICE_DROPS_BUYER_FEE,
): FeeLineCopy {
  const markets = feeMarketsFor(sources);
  const listed = (markets.length > 0 ? markets : MARKET_ORDER).map(buyerFeeLabel).join(", ");
  return {
    cost: hedged
      ? `Cost adds buyer fees when a trade-up is found (${listed}). Listings re-priced since then count at their listed price.`
      : `Cost includes buyer fees: ${listed}.`,
    outcomes: outcomeFeeCopy(),
  };
}

export const CALCULATOR_FEE_LINE: FeeLineCopy = {
  cost: "Cost is the prices you enter, with no buyer fee added.",
  outcomes: outcomeFeeCopy(),
};

export const CALCULATOR_EXAMPLE_FEE_LINE: FeeLineCopy = {
  cost: "Cost is the example's listed prices, with no buyer fee added.",
  outcomes: outcomeFeeCopy(),
};
