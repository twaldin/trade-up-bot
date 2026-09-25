/**
 * The landing hero's proof panel: one real trade-up from the board, reduced to
 * what a first-time visitor can check — the listings it buys, what it can
 * return and at what probability, and the four numbers that decide it. Everything is read
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

function hiddenForViewer(tu: TradeUp): boolean {
  return tu.inputs_redacted === true || tu.inputs.some((row) => row.listing_id === "hidden");
}

function priced(tu: TradeUp): boolean {
  return tu.inputs.every((row) => typeof row.price_cents === "number" && row.price_cents > 0);
}

function buyable(tu: TradeUp | null | undefined): tu is TradeUp {
  return Boolean(
    tu
    && !tu.is_theoretical
    && tu.listing_status !== "stale"
    && !hiddenForViewer(tu)
    && tu.inputs.length > 0
    && tu.outcomes.length > 0
    && priced(tu),
  );
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
  // Same precedence as the board card, so `/` and `/trade-ups` never disagree.
  const stored = typeof tu.chance_to_profit === "number" && Number.isFinite(tu.chance_to_profit)
    ? tu.chance_to_profit
    : null;
  const points = payoffPoints(tu);
  const chance = points.length > 0 ? chanceOfProfit(points) : stored;

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
