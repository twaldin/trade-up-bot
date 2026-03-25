/**
 * Phase 5e/5f: Generic rarity tier calc (Restricted→Classified, Mil-Spec→Restricted).
 * Phase 5c: Staircase evaluation.
 */

import pg from "pg";
import { emitEvent } from "../../db.js";
import {
  findProfitableTradeUps,
  randomExplore,
  saveTradeUps,
  mergeTradeUps,
  getTierById,
  findStaircaseTradeUps,
} from "../../engine.js";
import { type Condition } from "../../../shared/types.js";
import type { TradeUp } from "../../../shared/types.js";

import { timestamp, setDaemonStatus } from "../utils.js";

/**
 * Generic Phase 5 calc for any rarity tier (restricted→classified, milspec→restricted).
 * Uses merge-save to preserve profitable trade-ups across cycles (clear-first was erasing
 * razor-thin-margin restricted profits that only appear intermittently).
 * Capped at 30K to prevent OOM from unbounded accumulation.
 */
export async function phase5GenericCalc(
  pool: pg.Pool,
  tierType: string,
  discoveryResults?: TradeUp[],
) {
  const tierConfig = getTierById(tierType);
  if (!tierConfig) {
    console.error(`  Unknown tier: ${tierType}`);
    return;
  }
  const label = `${tierConfig.inputRarity}→${tierConfig.outputRarity}`;
  console.log(`\n[${timestamp()}] Phase 5: ${label} Calc${discoveryResults ? ' (worker)' : ''}`);
  await setDaemonStatus(pool, "calculating", `Phase 5: ${label} discovery`);

  try {
    const tradeUps = discoveryResults ?? await findProfitableTradeUps(pool, {
      rarities: [tierConfig.inputRarity],
    });

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    const highChance = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) >= 0.25);
    console.log(`  Found ${tradeUps.length} ${label} trade-ups (${profitable.length} profitable, ${highChance.length} high-chance)`);

    // Random exploration for this tier — finds combos the deterministic scan misses
    await setDaemonStatus(pool, "calculating", `Phase 5: ${label} exploration`);
    const exploreResult = await randomExplore(pool, {
      iterations: 200,
      inputRarity: tierConfig.inputRarity,
      onProgress: async (msg) => setDaemonStatus(pool, "calculating", msg),
    });
    if (exploreResult.found > 0 || exploreResult.improved > 0) {
      console.log(`  ${label} explore: ${exploreResult.explored} iterations, +${exploreResult.found} new, ${exploreResult.improved} improved`);
    }

    if (tradeUps.length > 0) {
      // Merge-save: preserves profitable trade-ups from prior cycles.
      // Cap at 30K to prevent OOM — keep profitable + high-chance first, then top by profit.
      const MAX_SAVE = 30000;
      let toSave: TradeUp[];
      if (tradeUps.length <= MAX_SAVE) {
        toSave = tradeUps;
      } else {
        // Prioritize: profitable first, then high-chance, then best-profit remaining
        const profitableSet = tradeUps.filter(t => t.profit_cents > 0);
        const highChanceSet = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) >= 0.25);
        const rest = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) < 0.25);
        rest.sort((a, b) => b.profit_cents - a.profit_cents);
        toSave = [...profitableSet, ...highChanceSet, ...rest].slice(0, MAX_SAVE);
      }

      await mergeTradeUps(pool, toSave, tierConfig.tradeUpType);
      console.log(`  Saved ${toSave.length} ${label} trade-ups (merge-save, cap ${MAX_SAVE})`);

      if (profitable.length > 0) {
        console.log(`  Top ${label} trade-ups:`);
        for (const tu of profitable.slice(0, 3)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
        }
        await emitEvent(pool, `${tierType}_calc`, `${profitable.length} profitable, best +$${(profitable[0].profit_cents / 100).toFixed(2)}`);
      }
    }
  } catch (err) {
    console.error(`  ${label} calc error: ${(err as Error).message}`);
  }
}

export async function phase5cStaircase(pool: pg.Pool) {
  console.log(`\n[${timestamp()}] Phase 5c: Staircase`);
  await setDaemonStatus(pool, "calculating", "Phase 5c: Staircase evaluation");

  try {
    const result = await findStaircaseTradeUps(pool);
    if (result.total > 0) {
      console.log(`  Staircase: ${result.total} evaluated, ${result.profitable} profitable`);
      for (const tu of result.tradeUps.slice(0, 3)) {
        console.log(`    $${(tu.tradeUp.profit_cents / 100).toFixed(2)} profit (${tu.tradeUp.roi_percentage.toFixed(0)}% ROI), ${tu.stage1Ids.length} stage-1 trade-ups`);
      }

      // Save staircase trade-ups with real classified inputs (not synthetic Coverts)
      // Load the actual 50 classified listing inputs from stage1 trade-up IDs
      for (const st of result.tradeUps) {
        // Replace synthetic Covert inputs with real classified inputs from stage1
        const realInputs: typeof st.tradeUp.inputs = [];
        for (const s1Id of st.stage1Ids) {
          const { rows } = await pool.query(
            `SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
             FROM trade_up_inputs WHERE trade_up_id = $1`,
            [s1Id]
          );
          for (const r of rows as { listing_id: string; skin_id: string; skin_name: string; collection_name: string; price_cents: number; float_value: number; condition: Condition; source: string | null }[]) {
            realInputs.push({
              listing_id: r.listing_id,
              skin_id: r.skin_id,
              skin_name: r.skin_name,
              collection_name: r.collection_name,
              price_cents: r.price_cents,
              float_value: r.float_value,
              condition: r.condition,
              source: r.source ?? "csfloat",
            });
          }
        }
        st.tradeUp.inputs = realInputs;
      }
      const tradeUps = result.tradeUps.map(s => s.tradeUp);
      await saveTradeUps(pool, tradeUps, true, "staircase", false, "staircase");
      console.log(`  Saved ${tradeUps.length} staircase trade-ups (${tradeUps[0]?.inputs.length ?? 0} inputs each)`);
    } else {
      console.log(`  Staircase: no viable combinations found`);
    }
  } catch (err) {
    console.error(`  Staircase error: ${(err as Error).message}`);
  }
}
