/**
 * Shared seeding / assertion helpers for the input buyer-fee reprice tests.
 * DB helpers only — listing/outcome factories still come from fixtures.ts.
 */

import pg from "pg";
import { expect } from "vitest";
import { computeChanceToProfit, computeBestWorstCase } from "../../server/engine/utils.js";
import { evaluateTradeUp } from "../../server/engine/evaluation.js";
import { makeListing, makeOutcome } from "./fixtures.js";

export interface FeeInputSeed {
  listingId: string;
  source: string;
  /** Raw marketplace price stored on the listings row. */
  raw: number;
  /** trade_up_inputs.price_cents (fee-inclusive when healthy, raw when stripped). */
  stored: number;
  float: number;
  marketplaceId?: string;
}

/** Outcome prices straddle the fee-inclusive vs stripped cost of three ~$10 inputs,
 *  so chance_to_profit moves when the buyer fee is restored or stripped. */
export const FEE_OUTCOMES = [
  { skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent", collection_name: "Test Collection Alpha", probability: 0.5, predicted_float: 0.15, predicted_condition: "Field-Tested", estimated_price_cents: 3100 },
  { skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent", collection_name: "Test Collection Alpha", probability: 0.3, predicted_float: 0.15, predicted_condition: "Field-Tested", estimated_price_cents: 4000 },
  { skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent", collection_name: "Test Collection Alpha", probability: 0.2, predicted_float: 0.15, predicted_condition: "Field-Tested", estimated_price_cents: 2000 },
];

export const FEE_EV = Math.round(FEE_OUTCOMES.reduce((s, o) => s + o.probability * o.estimated_price_cents, 0));

export interface TradeUpCostRow {
  total_cost_cents: number;
  expected_value_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
  trade_up_score: number;
}

/** Seed listings + one active trade-up whose stored stats are consistent with its stored inputs. */
export async function seedFeeTradeUp(pool: pg.Pool, inputs: FeeInputSeed[]): Promise<number> {
  await pool.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES ('skin-classified-1', 'AK-47 | Test Skin', 'AK-47', 'Classified') ON CONFLICT DO NOTHING`
  );
  for (const i of inputs) {
    await pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source, marketplace_id)
       VALUES ($1, 'skin-classified-1', $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [i.listingId, i.raw, i.float, i.source, i.marketplaceId ?? null]
    );
  }
  const cost = inputs.reduce((s, i) => s + i.stored, 0);
  const profit = FEE_EV - cost;
  const roi = Math.round((profit / cost) * 10000) / 100;
  const chance = computeChanceToProfit(FEE_OUTCOMES, cost);
  const { bestCase, worstCase } = computeBestWorstCase(FEE_OUTCOMES, cost);
  const { rows } = await pool.query(
    `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit,
       best_case_cents, worst_case_cents, type, listing_status, outcomes_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'classified_covert', 'active', $8) RETURNING id`,
    [cost, FEE_EV, profit, roi, chance, bestCase, worstCase, JSON.stringify(FEE_OUTCOMES)]
  );
  const id = rows[0].id as number;
  for (const i of inputs) {
    await pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
       VALUES ($1, $2, 'skin-classified-1', 'AK-47 | Test Skin', 'Test Collection Alpha', $3, $4, 'Field-Tested', $5)`,
      [id, i.listingId, i.stored, i.float, i.source]
    );
  }
  return id;
}

export async function readTradeUp(pool: pg.Pool, id: number): Promise<TradeUpCostRow> {
  const { rows } = await pool.query(
    `SELECT total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit,
            best_case_cents, worst_case_cents, trade_up_score
     FROM trade_ups WHERE id = $1`,
    [id]
  );
  return rows[0] as TradeUpCostRow;
}

export async function readInputPrices(pool: pg.Pool, id: number): Promise<Record<string, number>> {
  const { rows } = await pool.query("SELECT listing_id, price_cents FROM trade_up_inputs WHERE trade_up_id = $1", [id]);
  return Object.fromEntries(rows.map((r: { listing_id: string; price_cents: number }) => [r.listing_id, r.price_cents]));
}

export async function readListing(pool: pg.Pool, id: string): Promise<{ price_cents: number; price_updated_at: Date | null } | undefined> {
  const { rows } = await pool.query("SELECT price_cents, price_updated_at FROM listings WHERE id = $1", [id]);
  return rows[0];
}

/** Test oracle for the frozen compute_trade_up_score() trigger formula. */
export function triggerScore(r: Pick<TradeUpCostRow, "profit_cents" | "total_cost_cents" | "chance_to_profit" | "worst_case_cents">): number {
  if (r.total_cost_cents <= 0) return 0;
  const roiFrac = r.profit_cents / r.total_cost_cents;
  const downside = Math.max(0, -r.worst_case_cents) / r.total_cost_cents;
  return Math.round((1000 * r.chance_to_profit * roiFrac) / (1 + downside));
}

/** Assert every derived column matches a trade-up whose cost is Σ its stored inputs. */
export async function expectConsistentCost(pool: pg.Pool, id: number, expectedCost: number): Promise<TradeUpCostRow> {
  const inputs = await readInputPrices(pool, id);
  const row = await readTradeUp(pool, id);
  expect(Object.values(inputs).reduce((s, p) => s + p, 0)).toBe(expectedCost);
  expect(row.total_cost_cents).toBe(expectedCost);
  expect(row.profit_cents).toBe(row.expected_value_cents - expectedCost);
  expect(row.roi_percentage).toBeCloseTo(Math.round(((row.expected_value_cents - expectedCost) / expectedCost) * 10000) / 100, 6);
  expect(row.chance_to_profit).toBeCloseTo(computeChanceToProfit(FEE_OUTCOMES, expectedCost), 9);
  const { bestCase, worstCase } = computeBestWorstCase(FEE_OUTCOMES, expectedCost);
  expect(row.best_case_cents).toBe(bestCase);
  expect(row.worst_case_cents).toBe(worstCase);
  expect(row.trade_up_score).toBe(triggerScore(row));
  return row;
}

/** Input cost discovery would store for this listing (requires lookupOutputPrice to be mocked). */
export async function discoveryInputCost(pool: pg.Pool, raw: number, source: string): Promise<number> {
  const tu = await evaluateTradeUp(pool, [makeListing({ price_cents: raw, source })], [makeOutcome()]);
  if (!tu) throw new Error("evaluateTradeUp returned null — is lookupOutputPrice mocked?");
  return tu.inputs[0].price_cents;
}
