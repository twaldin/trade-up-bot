/**
 * Trade-up persistence: save, merge-upsert, trim, and profitable combo tracking.
 */

import pg from "pg";
import { setSyncMeta } from "../db.js";
import { type TradeUp } from "../../shared/types.js";
import { withRetry, computeChanceToProfit, computeBestWorstCase, listingSig, parseSig } from "./utils.js";

/**
 * Record a combo as profitable in the history table. Called whenever discovery finds profit.
 */
export async function recordProfitableCombo(pool: pg.Pool | pg.PoolClient, tu: TradeUp, comboKey: string) {
  const collections = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join(" + ");
  const recipe = tu.inputs.map(i =>
    `${i.skin_name}|${i.condition}|${i.collection_name}`
  ).sort().join(";");

  await pool.query(`
    INSERT INTO profitable_combos (combo_key, collections, best_profit_cents, best_roi,
      times_profitable, last_profitable_at, last_cost_cents, input_recipe)
    VALUES ($1, $2, $3, $4, 1, NOW(), $5, $6)
    ON CONFLICT(combo_key) DO UPDATE SET
      best_profit_cents = GREATEST(profitable_combos.best_profit_cents, EXCLUDED.best_profit_cents),
      best_roi = GREATEST(profitable_combos.best_roi, EXCLUDED.best_roi),
      times_profitable = profitable_combos.times_profitable + 1,
      last_profitable_at = NOW(),
      last_cost_cents = EXCLUDED.last_cost_cents,
      input_recipe = EXCLUDED.input_recipe
  `, [comboKey, collections, tu.profit_cents, tu.roi_percentage, tu.total_cost_cents, recipe]);
}

/**
 * Get profitable combo history for wanted list boosting.
 * Returns combos that have been profitable, sorted by recency and profit.
 */
export async function getProfitableCombosForWantedList(pool: pg.Pool): Promise<{
  combo_key: string; collections: string; best_profit: number; input_recipe: string; last_profitable: string;
}[]> {
  const { rows } = await pool.query(`
    SELECT combo_key, collections, best_profit_cents as best_profit,
           input_recipe, last_profitable_at as last_profitable
    FROM profitable_combos
    WHERE EXTRACT(EPOCH FROM NOW() - last_profitable_at::timestamptz) / 86400.0 <= 7
    ORDER BY last_profitable_at DESC, best_profit_cents DESC
    LIMIT 50
  `);
  return rows;
}

export async function saveTradeUps(pool: pg.Pool, tradeUps: TradeUp[], clearFirst: boolean = true, type: string = "classified_covert", isTheoretical: boolean = false, source: string = "discovery") {
  await withRetry(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (clearFirst) {
        // Preserve materialized results when discovery clears — they're found by a different process
        const sourceFilter = source === "discovery" ? " AND (source = 'discovery' OR source IS NULL)" : "";
        await client.query(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = $1 AND is_theoretical = $2${sourceFilter})`, [type, isTheoretical]);
        await client.query(`DELETE FROM trade_ups WHERE type = $1 AND is_theoretical = $2${sourceFilter}`, [type, isTheoretical]);
      }

      for (const tu of tradeUps) {
        const chanceToProfit = computeChanceToProfit(tu.outcomes, tu.total_cost_cents);
        const { bestCase, worstCase } = computeBestWorstCase(tu.outcomes, tu.total_cost_cents);
        const inputSources = [...new Set(tu.inputs.map(i => i.source ?? "csfloat"))].sort();

        const { rows } = await client.query(`
          INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json, input_sources)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          tu.total_cost_cents,
          tu.expected_value_cents,
          tu.profit_cents,
          tu.roi_percentage,
          chanceToProfit,
          type,
          bestCase,
          worstCase,
          isTheoretical,
          source,
          JSON.stringify(tu.outcomes),
          inputSources
        ]);
        const tradeUpId = rows[0].id;

        for (const input of tu.inputs) {
          await client.query(`
            INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            tradeUpId,
            input.listing_id,
            input.skin_id,
            input.skin_name,
            input.collection_name,
            input.price_cents,
            input.float_value,
            input.condition,
            input.source ?? "csfloat"
          ]);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }, 3, "saveTradeUps");

  await setSyncMeta(pool, "last_calculation", new Date().toISOString());
}

export async function mergeTradeUps(pool: pg.Pool, tradeUps: TradeUp[], type: string = "classified_covert") {
  // Upsert trade-ups by listing signature. New sigs inserted, existing updated, missing marked stale.

  const newSigs = new Map<string, number>();
  for (let i = 0; i < tradeUps.length; i++) {
    const sig = listingSig(tradeUps[i].inputs.map(inp => inp.listing_id));
    newSigs.set(sig, i);
  }

  // Read existing signatures (single query, no transaction needed)
  const { rows: existing } = await pool.query(`
    SELECT t.id, STRING_AGG(tui.listing_id::text, ',') as ids
    FROM trade_ups t
    JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
    WHERE t.type = $1 AND t.is_theoretical = false
    GROUP BY t.id
  `, [type]);

  const existingSigs = new Map<string, number>();
  for (const row of existing) {
    const sig = parseSig(row.ids);
    existingSigs.set(sig, row.id);
  }

  // Process updates in small batches (500 per transaction) to avoid long write locks
  // that block API readers. Each batch commits and releases the lock briefly.
  const BATCH_SIZE = 500;
  const handled = new Set<string>();

  // Batch 1: update existing trade-ups
  const toUpdate: { existId: number; tu: TradeUp }[] = [];
  for (const [sig, existId] of existingSigs) {
    const newIdx = newSigs.get(sig);
    if (newIdx !== undefined) {
      toUpdate.push({ existId, tu: tradeUps[newIdx] });
      handled.add(sig);
    }
    // NOTE: We no longer mark missing trade-ups as stale here.
    // With sig-skipping, workers intentionally don't rediscover known combos,
    // so "not in this batch" doesn't mean "listings are gone."
    // refreshListingStatuses() in housekeeping handles actual staleness.
  }

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    await withRetry(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const { existId, tu } of batch) {
          const chanceToProfit = computeChanceToProfit(tu.outcomes, tu.total_cost_cents);
          const { bestCase, worstCase } = computeBestWorstCase(tu.outcomes, tu.total_cost_cents);
          const { rows: oldRows } = await client.query(`SELECT profit_cents, profit_streak FROM trade_ups WHERE id = $1`, [existId]);
          const old = oldRows[0] as { profit_cents: number; profit_streak: number } | undefined;
          let streak = 0;
          if (tu.profit_cents > 0) {
            streak = (old && old.profit_cents > 0) ? (old.profit_streak ?? 0) + 1 : 1;
          }
          // listing_status = 'active' is safe here: workers filter claimed_by IS NULL when loading
          // listings, so if a listing is claimed this signature won't be re-discovered. If a race
          // condition causes a claimed listing to sneak in, API auto-correct fixes it on next read.
          await client.query(`
            UPDATE trade_ups SET total_cost_cents=$1, expected_value_cents=$2, profit_cents=$3, roi_percentage=$4, chance_to_profit=$5, best_case_cents=$6, worst_case_cents=$7,
              peak_profit_cents = GREATEST(peak_profit_cents, $8), listing_status = 'active', preserved_at = NULL, outcomes_json = $9,
              profit_streak = $10, previous_inputs = NULL
            WHERE id=$11
          `, [tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage, chanceToProfit, bestCase, worstCase, Math.max(tu.profit_cents, 0), JSON.stringify(tu.outcomes), streak, existId]);
          if (tu.profit_cents > 0) {
            const comboKey = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join("|");
            await recordProfitableCombo(client, tu, comboKey);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }, 3, "mergeTradeUps-update");
  }

  // Batch 2: insert new trade-ups in batches
  const toInsert: TradeUp[] = [];
  for (const [sig, idx] of newSigs) {
    if (handled.has(sig)) continue;
    toInsert.push(tradeUps[idx]);
  }

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await withRetry(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const tu of batch) {
          const chanceToProfit = computeChanceToProfit(tu.outcomes, tu.total_cost_cents);
          const { bestCase, worstCase } = computeBestWorstCase(tu.outcomes, tu.total_cost_cents);
          const { rows } = await client.query(`
            INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'discovery', $9)
            RETURNING id
          `, [tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage, chanceToProfit, type, bestCase, worstCase, JSON.stringify(tu.outcomes)]);
          const tradeUpId = rows[0].id;
          if (tu.profit_cents > 0) {
            await client.query("UPDATE trade_ups SET peak_profit_cents = $1 WHERE id = $2", [tu.profit_cents, tradeUpId]);
            const comboKey = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join("|");
            await recordProfitableCombo(client, tu, comboKey);
          }
          for (const inp of tu.inputs) {
            await client.query(`
              INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [tradeUpId, inp.listing_id, inp.skin_id, inp.skin_name, inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat"]);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }, 3, "mergeTradeUps-insert");
  }
  await setSyncMeta(pool, "last_calculation", new Date().toISOString());

  // No per-type caps — keep all trade-ups. Global 1M cap applied separately.
  // Natural staleness (listings sell → refreshListingStatuses → purgeExpiredPreserved)
  // handles cleanup. We want to show as many trade-ups as possible to users.
}

/**
 * Trim trade-ups for a type down to maxKeep, scored by profit + chance-to-profit.
 * Profitable and high-chance trade-ups are kept; low-value unprofitable ones are purged.
 */
async function trimExcessTradeUps(pool: pg.Pool, type: string, maxKeep: number) {
  const { rows: countRows } = await pool.query(
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = $1 AND is_theoretical = false",
    [type]
  );
  const count = parseInt(countRows[0].cnt, 10);

  if (count <= maxKeep) return;

  const toDelete = count - maxKeep;
  // Delete lowest-scored: sort by (profit + chance_bonus) ascending, delete the bottom N
  // Profitable trade-ups and high-chance ones are preserved
  await pool.query(`
    DELETE FROM trade_up_inputs WHERE trade_up_id IN (
      SELECT id FROM trade_ups
      WHERE type = $1 AND is_theoretical = false
      ORDER BY (profit_cents + CAST(chance_to_profit * 5000 AS INTEGER)) ASC
      LIMIT $2
    )
  `, [type, toDelete]);

  const deleted2 = await pool.query(`
    DELETE FROM trade_ups WHERE type = $1 AND is_theoretical = false
      AND id NOT IN (
        SELECT id FROM trade_ups
        WHERE type = $1 AND is_theoretical = false
        ORDER BY (profit_cents + CAST(chance_to_profit * 5000 AS INTEGER)) DESC
        LIMIT $2
      )
  `, [type, maxKeep]);

  if ((deleted2.rowCount ?? 0) > 0) {
    console.log(`  Trimmed ${deleted2.rowCount} excess ${type} trade-ups (kept top ${maxKeep})`);
  }
}


/**
 * Global trade-up cap: trim the worst trade-ups across ALL types when total exceeds maxTotal.
 * Deletes by worst ROI (most negative first). Keeps profitable + high-chance ones.
 */
export async function trimGlobalExcess(pool: pg.Pool, maxTotal: number = 1_000_000): Promise<number> {
  const { rows: countRows } = await pool.query(
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE is_theoretical = false"
  );
  const count = parseInt(countRows[0].cnt, 10);

  if (count <= maxTotal) return 0;

  const toDelete = count - maxTotal;
  // Delete worst by ROI across all types
  await pool.query(`
    DELETE FROM trade_up_inputs WHERE trade_up_id IN (
      SELECT id FROM trade_ups
      WHERE is_theoretical = false
      ORDER BY roi_percentage ASC
      LIMIT $1
    )
  `, [toDelete]);

  const deleted = await pool.query(`
    DELETE FROM trade_ups WHERE is_theoretical = false
      AND id NOT IN (
        SELECT id FROM trade_ups
        WHERE is_theoretical = false
        ORDER BY roi_percentage DESC
        LIMIT $1
      )
  `, [maxTotal]);

  if ((deleted.rowCount ?? 0) > 0) {
    console.log(`  Global trim: removed ${deleted.rowCount} worst-ROI trade-ups (cap ${maxTotal.toLocaleString()})`);
  }
  return deleted.rowCount ?? 0;
}
