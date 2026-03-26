/**
 * Trade-up revival: replace missing inputs with alternative listings.
 */

import pg from "pg";
import { type TradeUp } from "../../shared/types.js";
import type { ListingWithCollection } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { evaluateKnifeTradeUp } from "./knife-evaluation.js";
import { evaluateTradeUp } from "./evaluation.js";
import { getOutcomesForCollections } from "./data-load.js";
import { listingSig, computeChanceToProfit, computeBestWorstCase } from "./utils.js";
import { recordProfitableCombo } from "./db-save.js";

/** Configuration for the generic revive function. */
interface ReviveConfig {
  type: string;
  inputCount: number;
  inputRarity: string;
  evaluateFn: (pool: pg.Pool, inputs: ListingWithCollection[]) => Promise<TradeUp | null>;
  /** Whether to record profitable combos after revival (knife does, gun doesn't). */
  recordCombos: boolean;
}

/**
 * Common listing query fragment for fetching full listing data with joins.
 */
const FULL_LISTING_SELECT = `
  SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
         l.float_value, l.paint_seed, l.stattrak, l.source, s.min_float, s.max_float,
         s.rarity, sc.collection_id, c.name as collection_name
  FROM listings l
  JOIN skins s ON l.skin_id = s.id
  JOIN skin_collections sc ON s.id = sc.skin_id
  JOIN collections c ON sc.collection_id = c.id`;

/**
 * Generic trade-up revival: replace missing inputs with alternative listings.
 * Both knife and gun revive use this core logic, differing only in config params.
 */
async function reviveStaleGeneric(
  pool: pg.Pool,
  config: ReviveConfig,
  limit: number
): Promise<{ checked: number; revived: number; improved: number }> {
  const { type, inputCount, inputRarity, evaluateFn, recordCombos } = config;

  // Get partial/stale trade-ups, prioritize by profit potential
  const { rows: stale } = await pool.query(`
    SELECT t.id, t.profit_cents, t.peak_profit_cents, t.listing_status
    FROM trade_ups t
    WHERE t.type = $2
      AND t.is_theoretical = false
      AND t.listing_status IN ('partial', 'stale')
    ORDER BY t.peak_profit_cents DESC, t.profit_cents DESC
    LIMIT $1
  `, [limit, type]);

  if (stale.length === 0) return { checked: 0, revived: 0, improved: 0 };

  let checked = 0, revived = 0, improved = 0;

  // Build set of existing listing signatures to prevent revival from creating duplicates.
  const existingSigs = new Set<string>();
  const { rows: existingRows } = await pool.query(`
    SELECT t.id, STRING_AGG(tui.listing_id::text, ',') as ids
    FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
    WHERE t.type = $1 AND t.is_theoretical = false
    GROUP BY t.id
  `, [type]);
  for (const row of existingRows) {
    existingSigs.add(listingSig(row.ids.split(",")));
  }

  for (const tu of stale) {
    checked++;
    const client = await pool.connect();
    let txOpen = false;
    try {
      await client.query('BEGIN');
      txOpen = true;
      const { rows: inputs } = await client.query(`
        SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
        FROM trade_up_inputs WHERE trade_up_id = $1
      `, [tu.id]);

      if (inputs.length !== inputCount) continue;

      // Check which inputs are missing
      const newInputs: ListingWithCollection[] = [];
      let anyMissing = false;
      let anyReplaced = false;
      const usedIds = new Set<string>();

      for (const inp of inputs) {
        const { rows: existRows } = await client.query(`SELECT id FROM listings WHERE id = $1`, [inp.listing_id]);
        if (existRows.length > 0) {
          // Listing still exists -- fetch full data
          const { rows: fullRows } = await client.query(`${FULL_LISTING_SELECT} WHERE l.id = $1`, [inp.listing_id]);
          const full = fullRows[0] as ListingWithCollection | undefined;
          if (full) {
            newInputs.push(full);
            usedIds.add(full.id);
            continue;
          }
        }

        anyMissing = true;

        // Try same skin first (exclude already-used IDs and all original listing IDs)
        const excludeIds = [...usedIds, ...inputs.map((i: { listing_id: string }) => i.listing_id)];
        const excludePlaceholders = excludeIds.map((_, idx) => `$${idx + 2}`).join(",");
        const { rows: sameSkinRows } = await client.query(`
          ${FULL_LISTING_SELECT}
          WHERE l.skin_id = $1 AND l.id NOT IN (${excludePlaceholders})
          ORDER BY ABS(l.float_value - $${excludeIds.length + 2}) ASC, l.price_cents ASC
          LIMIT 1
        `, [inp.skin_id, ...excludeIds, inp.float_value]);
        const sameSkin = sameSkinRows[0] as ListingWithCollection | undefined;

        if (sameSkin) {
          newInputs.push(sameSkin);
          usedIds.add(sameSkin.id);
          anyReplaced = true;
          continue;
        }

        // Try same collection
        const { rows: sameColRows } = await client.query(`
          ${FULL_LISTING_SELECT}
          WHERE c.name = $1 AND s.rarity = $${excludeIds.length + 3} AND l.stattrak = false
            AND l.id NOT IN (${excludePlaceholders})
          ORDER BY ABS(l.float_value - $${excludeIds.length + 2}) ASC, l.price_cents ASC
          LIMIT 1
        `, [inp.collection_name, ...excludeIds, inp.float_value, inputRarity]);
        const sameCol = sameColRows[0] as ListingWithCollection | undefined;

        if (sameCol) {
          newInputs.push(sameCol);
          usedIds.add(sameCol.id);
          anyReplaced = true;
          continue;
        }

        // No replacement found -- can't revive this trade-up
        break;
      }

      if (newInputs.length !== inputCount) continue;
      if (!anyMissing) continue; // All inputs still exist, shouldn't happen but just in case

      // Dedup: check if the new listing combination already exists in another trade-up.
      // Revival can create duplicates when a replacement listing matches an active trade-up's set.
      const newSig = listingSig(newInputs.map(i => i.id));
      if (existingSigs.has(newSig)) continue; // Would create duplicate -- skip

      // Re-evaluate with the new inputs
      const result = await evaluateFn(pool, newInputs);
      if (!result) continue;

      // Build previous_inputs: only store inputs that were replaced
      const oldListingIds = new Set(inputs.map((i: { listing_id: string }) => i.listing_id));
      const newListingIds = new Set(result.inputs.map(i => i.listing_id));
      const replacedOld = inputs.filter((i: { listing_id: string }) => !newListingIds.has(i.listing_id));
      const replacedNew = result.inputs.filter(i => !oldListingIds.has(i.listing_id));
      const previousInputsJson = replacedOld.length > 0 ? JSON.stringify({
        old_profit_cents: tu.profit_cents,
        old_cost_cents: inputs.reduce((s: number, i: { price_cents: number }) => s + i.price_cents, 0),
        replaced: replacedOld.map((old: { skin_name: string; price_cents: number; float_value: number; condition: string; listing_id: string }, idx: number) => ({
          old: { skin_name: old.skin_name, price_cents: old.price_cents, float_value: old.float_value, condition: old.condition, listing_id: old.listing_id },
          new: replacedNew[idx] ? { skin_name: replacedNew[idx].skin_name, price_cents: replacedNew[idx].price_cents, float_value: replacedNew[idx].float_value, condition: replacedNew[idx].condition, listing_id: replacedNew[idx].listing_id } : null,
        })),
      }) : null;

      // Update the trade-up with new data
      const chanceToProfit = computeChanceToProfit(result.outcomes, result.total_cost_cents);
      const { bestCase, worstCase } = computeBestWorstCase(result.outcomes, result.total_cost_cents);

      await client.query(`
        UPDATE trade_ups SET total_cost_cents=$1, expected_value_cents=$2, profit_cents=$3,
          roi_percentage=$4, chance_to_profit=$5, best_case_cents=$6, worst_case_cents=$7,
          peak_profit_cents = GREATEST(peak_profit_cents, $8),
          listing_status = 'active', preserved_at = NULL,
          previous_inputs = $9, outcomes_json = $10
        WHERE id=$11
      `, [
        result.total_cost_cents, result.expected_value_cents, result.profit_cents,
        result.roi_percentage, chanceToProfit, bestCase, worstCase,
        Math.max(result.profit_cents, 0), previousInputsJson, JSON.stringify(result.outcomes), tu.id
      ]);

      // Replace inputs
      await client.query(`DELETE FROM trade_up_inputs WHERE trade_up_id = $1`, [tu.id]);
      for (const inp of result.inputs) {
        await client.query(`
          INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [tu.id, inp.listing_id, inp.skin_id, inp.skin_name,
          inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat"]);
      }

      // Recompute input_sources after replacing inputs
      await client.query(`
        UPDATE trade_ups SET input_sources = COALESCE((
          SELECT ARRAY_AGG(DISTINCT source ORDER BY source) FROM trade_up_inputs WHERE trade_up_id = $1
        ), '{}') WHERE id = $1
      `, [tu.id]);

      // Record if newly profitable (knife revive does this, gun revive doesn't)
      if (recordCombos && result.profit_cents > 0) {
        const comboKey = [...new Set(result.inputs.map(i => i.collection_name))].sort().join("|");
        await recordProfitableCombo(client, result, comboKey);
      }

      await client.query('COMMIT');
      txOpen = false;
      revived++;
      if (result.profit_cents > tu.profit_cents) improved++;
    } catch (err) {
      console.warn(`reviveStaleGeneric: error on trade-up ${tu.id}: ${(err as Error).message}`);
    } finally {
      if (txOpen) { try { await client.query('ROLLBACK'); } catch {} }
      client.release();
    }
  }

  return { checked, revived, improved };
}

// Replace missing inputs with alternative listings from same skin/collection.
export async function reviveStaleTradeUps(
  pool: pg.Pool,
  knifeFinishCache: Map<string, FinishData[]>,
  limit = 100
): Promise<{ checked: number; revived: number; improved: number }> {
  return reviveStaleGeneric(pool, {
    type: "covert_knife",
    inputCount: 5,
    inputRarity: "Covert",
    evaluateFn: (p, inputs) => evaluateKnifeTradeUp(p, inputs, knifeFinishCache),
    recordCombos: true,
  }, limit);
}

/**
 * Revive stale/partial gun trade-ups by finding replacement listings.
 * Same pattern as reviveStaleTradeUps but for 10 inputs at any gun rarity tier.
 */
export async function reviveStaleGunTradeUps(
  pool: pg.Pool,
  limit = 100,
  type: string = "classified_covert"
): Promise<{ checked: number; revived: number; improved: number }> {
  // Resolve input/output rarities from tier config (not hardcoded)
  const { getTierById } = await import("./rarity-tiers.js");
  const tier = getTierById(type);
  if (!tier) return { checked: 0, revived: 0, improved: 0 };
  const inputRarity = tier.inputRarity;
  const outputRarity = tier.outputRarity;

  return reviveStaleGeneric(pool, {
    type,
    inputCount: 10,
    inputRarity,
    evaluateFn: async (p, inputs) => {
      const collectionIds = [...new Set(inputs.map(i => i.collection_id))];
      const outcomes = await getOutcomesForCollections(p, collectionIds, outputRarity);
      if (outcomes.length === 0) return null;
      return evaluateTradeUp(p, inputs, outcomes);
    },
    recordCombos: false,
  }, limit);
}
