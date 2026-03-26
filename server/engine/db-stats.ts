/**
 * Collection scoring and trade-up cost recalculation.
 */

import pg from "pg";
import { withRetry, computeChanceToProfit, computeBestWorstCase } from "./utils.js";
import { lookupOutputPrice, buildPriceCache } from "./pricing.js";
import type { TradeUpOutcome } from "../../shared/types.js";

export async function updateCollectionScores(pool: pg.Pool) {
  const { rows: scores } = await pool.query(`
    SELECT
      tui.collection_name,
      COUNT(DISTINCT tu.id) as total_tradeups,
      SUM(CASE WHEN tu.profit_cents > 500 THEN 1 ELSE 0 END) as profitable_count,
      AVG(CASE WHEN tu.profit_cents > 0 THEN tu.profit_cents ELSE NULL END) as avg_profit,
      MAX(tu.profit_cents) as max_profit,
      AVG(CASE WHEN tu.profit_cents > 0 THEN tu.roi_percentage ELSE NULL END) as avg_roi
    FROM trade_ups tu
    JOIN trade_up_inputs tui ON tu.id = tui.trade_up_id
    GROUP BY tui.collection_name
  `);

  const colIdLookup = new Map<string, string>();
  const { rows: colRows } = await pool.query("SELECT id, name FROM collections");
  for (const r of colRows) colIdLookup.set(r.name, r.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM collection_scores");

    for (const s of scores) {
      const colId = colIdLookup.get(s.collection_name);
      if (!colId) continue;

      const profitableWeight = Math.min(parseInt(s.profitable_count, 10), 50);
      const avgProfitWeight = Math.min((s.avg_profit ?? 0) / 100, 50);
      const roiWeight = Math.min((s.avg_roi ?? 0) / 5, 20);
      const priorityScore = profitableWeight * 2 + avgProfitWeight + roiWeight;

      await client.query(`
        INSERT INTO collection_scores
          (collection_id, collection_name, profitable_count, avg_profit_cents, max_profit_cents, avg_roi, total_tradeups, priority_score, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (collection_id) DO UPDATE SET
          collection_name = $2, profitable_count = $3, avg_profit_cents = $4, max_profit_cents = $5,
          avg_roi = $6, total_tradeups = $7, priority_score = $8, updated_at = NOW()
      `, [
        colId,
        s.collection_name,
        parseInt(s.profitable_count, 10),
        Math.round(s.avg_profit ?? 0),
        s.max_profit,
        Math.round((s.avg_roi ?? 0) * 100) / 100,
        parseInt(s.total_tradeups, 10),
        Math.round(priorityScore * 100) / 100
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(`  Updated ${scores.length} collection scores`);
}

/**
 * Batch recalc trade-up stats when input listing prices have changed.
 * Finds trade-ups where trade_up_inputs.price_cents differs from the current
 * listings.price_cents, updates the input prices, and recalculates
 * profit/roi/chance/best/worst from the stored outcomes_json.
 * Lightweight — no float calculations or outcome re-evaluation needed.
 *
 * Optimization: when `sinceTimestamp` is provided, only checks listings whose
 * price_updated_at is after that timestamp (avoids scanning all 10M+ input rows).
 * Falls back to full scan if no timestamp is provided.
 */
export async function recalcTradeUpCosts(pool: pg.Pool, sinceTimestamp?: string): Promise<{ updated: number }> {
  // Find trade-ups with at least one input whose price differs from the listing.
  // Only check listings with price_updated_at set (avoids full 12M row scan).
  // If no sinceTimestamp, skip entirely — full scan is too expensive on 12M rows.
  if (!sinceTimestamp) return { updated: 0 };

  // Cap to 500 listings per cycle to keep the JOIN through trade_up_inputs fast.
  // Remaining listings keep their price_updated_at and get picked up next cycle.
  const { rows: changedListings } = await pool.query(
    "SELECT id FROM listings WHERE price_updated_at > $1 LIMIT 500",
    [sinceTimestamp]
  );
  if (changedListings.length === 0) return { updated: 0 };
  const changedIds = changedListings.map((r: { id: string }) => r.id);
  const ph = changedIds.map((_: string, i: number) => `$${i + 1}`).join(",");
  const { rows: staleInputRows } = await pool.query(`
    SELECT DISTINCT tui.trade_up_id
    FROM trade_up_inputs tui
    JOIN listings l ON tui.listing_id = l.id
    WHERE tui.listing_id IN (${ph}) AND tui.price_cents != l.price_cents
  `, changedIds);
  if (staleInputRows.length === 0) {
    // No actual price mismatches in this batch — clear their flags
    const clearPh = changedIds.map((_: string, i: number) => `$${i + 1}`).join(",");
    await pool.query(`UPDATE listings SET price_updated_at = NULL WHERE id IN (${clearPh})`, changedIds);
    return { updated: 0 };
  }

  const tuIds = staleInputRows.map(r => r.trade_up_id);

  let updated = 0;
  const BATCH = 500;
  for (let i = 0; i < tuIds.length; i += BATCH) {
    const batch = tuIds.slice(i, i + BATCH);
    await withRetry(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const tuId of batch) {
          // Update input prices
          await client.query(`
            UPDATE trade_up_inputs SET price_cents = (
              SELECT l.price_cents FROM listings l WHERE l.id = trade_up_inputs.listing_id
            ) WHERE trade_up_id = $1 AND listing_id IN (
              SELECT l.id FROM listings l
              JOIN trade_up_inputs tui2 ON tui2.listing_id = l.id
              WHERE tui2.trade_up_id = $1 AND tui2.price_cents != l.price_cents
            )
          `, [tuId]);

          // Recalculate stats
          const { rows: costRows } = await client.query("SELECT SUM(price_cents) as total FROM trade_up_inputs WHERE trade_up_id = $1", [tuId]);
          const cost = parseInt(costRows[0].total, 10);
          const { rows: tuRows } = await client.query("SELECT expected_value_cents, outcomes_json FROM trade_ups WHERE id = $1", [tuId]);
          const tu = tuRows[0] as { expected_value_cents: number; outcomes_json: string | null } | undefined;
          if (!tu) continue;

          const ev = tu.expected_value_cents;
          const profit = ev - cost;
          const roi = cost > 0 ? Math.round((profit / cost) * 10000) / 100 : 0;

          const outcomes = JSON.parse(tu.outcomes_json || "[]") as { estimated_price_cents: number; probability: number }[];
          const chance = computeChanceToProfit(outcomes, cost);
          const { bestCase: best, worstCase: worst } = computeBestWorstCase(outcomes, cost);

          await client.query(`
            UPDATE trade_ups SET total_cost_cents = $1, profit_cents = $2, roi_percentage = $3,
              chance_to_profit = $4, best_case_cents = $5, worst_case_cents = $6
            WHERE id = $7
          `, [cost, profit, roi, chance, best, worst, tuId]);
          updated++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }, 3, "recalcTradeUpCosts");
  }

  // Clear price_updated_at only on the listings we actually processed (not all changed ones).
  // Remaining listings keep their flag and get picked up next cycle.
  if (changedIds.length > 0) {
    const clearPh = changedIds.map((_: string, i: number) => `$${i + 1}`).join(",");
    await pool.query(`UPDATE listings SET price_updated_at = NULL WHERE id IN (${clearPh})`, changedIds);
  }

  return { updated };
}

/**
 * Batch re-evaluate output pricing for trade-ups using current price cache + KNN.
 * Picks the oldest-repriced active trade-ups, re-lookups each outcome's price
 * at its predicted float, and updates EV/profit/ROI if changed.
 */
export async function repriceTradeUpOutputs(
  pool: pg.Pool,
  limit: number = 500
): Promise<{ updated: number; checked: number }> {
  await buildPriceCache(pool);

  const { rows } = await pool.query(`
    SELECT id, type, total_cost_cents, expected_value_cents, outcomes_json, output_repriced_at
    FROM trade_ups
    WHERE is_theoretical = false AND listing_status = 'active'
      AND outcomes_json IS NOT NULL
      AND (output_repriced_at IS NULL OR output_repriced_at < NOW() - INTERVAL '2 hours')
    ORDER BY output_repriced_at ASC NULLS FIRST, roi_percentage DESC
    LIMIT $1
  `, [limit]);

  if (rows.length === 0) return { updated: 0, checked: 0 };

  let updated = 0;
  const BATCH = 100;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const tu of batch) {
        const outcomes: TradeUpOutcome[] = JSON.parse(tu.outcomes_json);
        if (outcomes.length === 0) {
          await client.query("UPDATE trade_ups SET output_repriced_at = NOW() WHERE id = $1", [tu.id]);
          continue;
        }

        let newEv = 0;
        let priceable = true;
        const newOutcomes: TradeUpOutcome[] = [];

        for (const o of outcomes) {
          const output = await lookupOutputPrice(pool, o.skin_name, o.predicted_float);
          if (output.priceCents <= 0) { priceable = false; break; }
          newEv += o.probability * output.priceCents;
          newOutcomes.push({
            ...o,
            estimated_price_cents: output.priceCents,
            sell_marketplace: output.marketplace,
          });
        }

        if (!priceable) {
          await client.query("UPDATE trade_ups SET output_repriced_at = NOW() WHERE id = $1", [tu.id]);
          continue;
        }

        const newEvCents = Math.round(newEv);
        const cost = tu.total_cost_cents;
        const profit = newEvCents - cost;
        const roi = cost > 0 ? Math.round((profit / cost) * 10000) / 100 : 0;
        const chance = computeChanceToProfit(newOutcomes as { estimated_price_cents: number; probability: number }[], cost);
        const { bestCase: best, worstCase: worst } = computeBestWorstCase(newOutcomes as { estimated_price_cents: number; probability: number }[], cost);

        // Only write if EV changed by more than 1%
        if (Math.abs(newEvCents - tu.expected_value_cents) > tu.expected_value_cents * 0.01) {
          await client.query(`
            UPDATE trade_ups SET
              expected_value_cents = $1, profit_cents = $2, roi_percentage = $3,
              chance_to_profit = $4, best_case_cents = $5, worst_case_cents = $6,
              outcomes_json = $7, output_repriced_at = NOW()
            WHERE id = $8
          `, [newEvCents, profit, roi, chance, best, worst, JSON.stringify(newOutcomes), tu.id]);
          updated++;
        } else {
          await client.query("UPDATE trade_ups SET output_repriced_at = NOW() WHERE id = $1", [tu.id]);
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return { updated, checked: rows.length };
}
