/**
 * Phase 5c: Staircase evaluation.
 *
 * 2026-07-21: phase5GenericCalc (the pre-worker generic tier calc) and the
 * cooldownLoop in daemon/loops.ts were removed as dead code — zero importers
 * since the time-bounded worker architecture took over Phase 5; their inline
 * randomExplore calls were the last (unreachable) users of the static-weight
 * explore path.
 */

import pg from "pg";
import {
  saveTradeUps,
  findStaircaseTradeUps,
} from "../../engine.js";
import { type Condition } from "../../../shared/types.js";

import { timestamp, setDaemonStatus } from "../utils.js";

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
