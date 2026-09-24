/**
 * The landing hero's proof panel: one real trade-up from the board, reduced to
 * what a first-time visitor can check — the listings it buys, what it can
 * return at what odds, and the four numbers that decide it. Everything is read
 * from the API row; nothing here estimates or rounds a price.
 */
import type { TradeUp, TradeUpInput } from "../../../shared/types.js";
import {
  chanceOfProfit,
  inputRarityLabel,
  payoffPoints,
  rarityLabel,
  storyRailInputs,
  uniqueOutputs,
} from "./board.js";

export const HERO_PROOF_OUTCOMES = 4;

export interface HeroProofOutcome {
  name: string;
  condition: string;
  probability: number;
  priceCents: number;
  profitCents: number;
}

export interface HeroProof {
  id: number;
  route: string;
  listings: TradeUpInput[];
  outcomes: HeroProofOutcome[];
  hiddenOutcomes: number;
  costCents: number;
  evCents: number;
  profitCents: number;
  roiPct: number;
  chance: number | null;
}

function buyable(tu: TradeUp | null | undefined): tu is TradeUp {
  return Boolean(tu && !tu.is_theoretical && tu.inputs.length > 0);
}

export function pickHeroTradeUp(rows: readonly TradeUp[]): TradeUp | null {
  return rows.find(buyable) ?? null;
}

export function heroProof(tu: TradeUp | null | undefined): HeroProof | null {
  if (!buyable(tu)) return null;
  const cost = tu.total_cost_cents;
  const ranked = uniqueOutputs(tu)
    .map((outcome) => ({
      name: outcome.skin_name,
      condition: outcome.predicted_condition,
      probability: outcome.probability,
      priceCents: outcome.estimated_price_cents,
      profitCents: outcome.estimated_price_cents - cost,
    }))
    .sort((a, b) => b.probability - a.probability || b.priceCents - a.priceCents);
  const stored = tu.chance_to_profit;
  const points = payoffPoints(tu);
  const chance = typeof stored === "number" && Number.isFinite(stored)
    ? stored
    : points.length > 0 ? chanceOfProfit(points) : null;

  return {
    id: tu.id,
    route: `${inputRarityLabel(tu.type)} → ${rarityLabel(tu.type)}`,
    listings: storyRailInputs(tu),
    outcomes: ranked.slice(0, HERO_PROOF_OUTCOMES),
    hiddenOutcomes: Math.max(0, ranked.length - HERO_PROOF_OUTCOMES),
    costCents: cost,
    evCents: tu.expected_value_cents,
    profitCents: tu.profit_cents,
    roiPct: tu.roi_percentage,
    chance,
  };
}
