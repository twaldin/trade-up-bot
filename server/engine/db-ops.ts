/**
 * Database persistence: save trade-ups, update collection scores, theory tracking.
 */

import pg from "pg";
import { setSyncMeta } from "../db.js";
import { type TradeUp } from "../../shared/types.js";
import type { ListingWithCollection } from "./types.js";

import type { FinishData } from "./knife-data.js";
import { evaluateKnifeTradeUp } from "./knife-evaluation.js";
import { evaluateTradeUp } from "./evaluation.js";
import { getOutcomesForCollections } from "./data-load.js";

/**
 * Retry a function that may fail with connection errors.
 * PG handles concurrency natively; this only retries transient connection issues.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, label = "DB operation"): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      const code = (err as { code?: string }).code ?? "";
      const isTransient = code === "ECONNREFUSED" || code === "ECONNRESET" || code === "57P01" || msg.includes("Connection terminated");
      if (isTransient && attempt < maxRetries) {
        const waitMs = 1000 * Math.pow(2, attempt);
        console.log(`  ${label}: connection error (${code}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Cascade trade-up listing_status changes when specific listings are deleted or claimed.
 * Lightweight: only re-evaluates trade-ups referencing the given listing IDs.
 * Skips trade-ups with active claims (they stay 'active' for the claimer).
 */
export async function cascadeTradeUpStatuses(pool: pg.Pool, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0;
  const { cacheInvalidatePrefix } = await import("../redis.js");
  // Batch in chunks of 500 to avoid param limit issues
  let totalUpdated = 0;
  for (let i = 0; i < listingIds.length; i += 500) {
    const chunk = listingIds.slice(i, i + 500);
    const result = await pool.query(`
      WITH affected_tus AS (
        SELECT DISTINCT tui.trade_up_id
        FROM trade_up_inputs tui
        WHERE tui.listing_id = ANY($1)
      ),
      status_calc AS (
        SELECT a.trade_up_id,
          COUNT(*) FILTER (WHERE l.id IS NULL OR l.claimed_by IS NOT NULL) as missing,
          COUNT(*) as total
        FROM affected_tus a
        JOIN trade_up_inputs tui ON tui.trade_up_id = a.trade_up_id
        LEFT JOIN listings l ON tui.listing_id = l.id
        WHERE tui.listing_id NOT LIKE 'theor%'
        GROUP BY a.trade_up_id
      )
      UPDATE trade_ups t SET
        listing_status = CASE WHEN sc.missing = 0 THEN 'active' WHEN sc.missing < sc.total THEN 'partial' ELSE 'stale' END,
        preserved_at = CASE
          WHEN sc.missing > 0 AND t.listing_status = 'active' THEN NOW()
          WHEN sc.missing = 0 THEN NULL
          ELSE t.preserved_at
        END
      FROM status_calc sc
      WHERE t.id = sc.trade_up_id
        AND t.listing_status IS DISTINCT FROM (
          CASE WHEN sc.missing = 0 THEN 'active' WHEN sc.missing < sc.total THEN 'partial' ELSE 'stale' END
        )
        AND NOT EXISTS (
          SELECT 1 FROM trade_up_claims tc
          WHERE tc.trade_up_id = t.id AND tc.released_at IS NULL AND tc.expires_at > NOW()
        )
    `, [chunk]);
    totalUpdated += result.rowCount ?? 0;
  }
  if (totalUpdated > 0) {
    await cacheInvalidatePrefix("tu:");
  }
  return totalUpdated;
}

/**
 * Delete listings by ID and cascade status changes to affected trade-ups.
 * Use this instead of raw DELETE FROM listings everywhere.
 */
export async function deleteListings(pool: pg.Pool, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [ids]);
  await cascadeTradeUpStatuses(pool, ids);
  return rowCount ?? 0;
}

/**
 * Refresh listing_status for all real trade-ups based on whether their
 * input listings still exist in the DB. Fast — single SQL pass.
 */
export async function refreshListingStatuses(pool: pg.Pool): Promise<{ active: number; partial: number; stale: number; preserved: number }> {
  // JOIN-based approach: pre-compute missing/present counts per trade-up in one pass,
  // then UPDATE using the aggregated results. Avoids correlated subqueries on 1.25M rows.
  // Treats both deleted listings (l.id IS NULL) and claimed listings (l.claimed_by IS NOT NULL) as missing.
  // Skips trade-ups with active claims (they stay 'active' for the claimer).
  await pool.query(`
    UPDATE trade_ups t SET
      listing_status = s.new_status,
      preserved_at = CASE
        WHEN s.new_status = 'active' THEN NULL
        ELSE COALESCE(t.preserved_at, NOW())
      END
    FROM (
      SELECT tui.trade_up_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE l.id IS NULL OR l.claimed_by IS NOT NULL) = 0 THEN 'active'
          WHEN COUNT(*) FILTER (WHERE l.id IS NOT NULL AND l.claimed_by IS NULL) > 0 THEN 'partial'
          ELSE 'stale'
        END as new_status
      FROM trade_up_inputs tui
      LEFT JOIN listings l ON tui.listing_id = l.id
      WHERE tui.listing_id NOT LIKE 'theor%'
      GROUP BY tui.trade_up_id
    ) s
    WHERE t.id = s.trade_up_id
      AND t.is_theoretical = 0
      AND (t.listing_status IS DISTINCT FROM s.new_status)
      AND NOT EXISTS (
        SELECT 1 FROM trade_up_claims tc
        WHERE tc.trade_up_id = t.id AND tc.released_at IS NULL AND tc.expires_at > NOW()
      )
  `);
  const { cacheInvalidatePrefix } = await import("../redis.js");
  await cacheInvalidatePrefix("tu:");

  const { rows: counts } = await pool.query(`
    SELECT listing_status, COUNT(*) as cnt
    FROM trade_ups WHERE is_theoretical = 0
    GROUP BY listing_status
  `);

  const m: Record<string, number> = {};
  for (const r of counts) m[r.listing_status] = parseInt(r.cnt, 10);

  const { rows: preservedRows } = await pool.query(
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE preserved_at IS NOT NULL"
  );
  const preserved = parseInt(preservedRows[0].cnt, 10);

  return { active: m.active ?? 0, partial: m.partial ?? 0, stale: m.stale ?? 0, preserved };
}

/**
 * Purge preserved trade-ups older than maxDays.
 */
export async function purgeExpiredPreserved(pool: pg.Pool, maxDays = 2): Promise<number> {
  // Delete outcomes and inputs first (foreign key cascade should handle it, but be explicit)
  const { rows: ids } = await pool.query(
    "SELECT id FROM trade_ups WHERE preserved_at IS NOT NULL AND EXTRACT(EPOCH FROM NOW() - preserved_at::timestamptz) / 86400.0 > $1",
    [maxDays]
  );

  if (ids.length === 0) return 0;

  const idValues = ids.map((r: { id: number }) => r.id);
  const placeholders = idValues.map((_: number, i: number) => `$${i + 1}`).join(",");
  await pool.query(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (${placeholders})`, idValues);
  await pool.query(`DELETE FROM trade_ups WHERE id IN (${placeholders})`, idValues);
  return ids.length;
}

/**
 * Record a combo as profitable in the history table. Called whenever discovery finds profit.
 */
export async function recordProfitableCombo(pool: pg.Pool, tu: TradeUp, comboKey: string) {
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
        await client.query(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = $1 AND is_theoretical = $2${sourceFilter})`, [type, isTheoretical ? 1 : 0]);
        await client.query(`DELETE FROM trade_ups WHERE type = $1 AND is_theoretical = $2${sourceFilter}`, [type, isTheoretical ? 1 : 0]);
      }

      for (const tu of tradeUps) {
        const chanceToProfit = tu.outcomes.reduce((sum, o) =>
          sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
        );

        const bestCase = tu.outcomes.length > 0
          ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
        const worstCase = tu.outcomes.length > 0
          ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;

        const { rows } = await client.query(`
          INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
          isTheoretical ? 1 : 0,
          source,
          JSON.stringify(tu.outcomes)
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
    const sig = tradeUps[i].inputs.map(inp => inp.listing_id).sort().join(",");
    newSigs.set(sig, i);
  }

  // Read existing signatures (single query, no transaction needed)
  const { rows: existing } = await pool.query(`
    SELECT t.id, STRING_AGG(tui.listing_id::text, ',') as ids
    FROM trade_ups t
    JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
    WHERE t.type = $1 AND t.is_theoretical = 0
    GROUP BY t.id
  `, [type]);

  const existingSigs = new Map<string, number>();
  for (const row of existing) {
    const sig = row.ids.split(",").sort().join(",");
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
          const chanceToProfit = tu.outcomes.reduce((sum, o) =>
            sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
          const bestCase = tu.outcomes.length > 0 ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
          const worstCase = tu.outcomes.length > 0 ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
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
            await recordProfitableCombo(client as unknown as pg.Pool, tu, comboKey);
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
          const chanceToProfit = tu.outcomes.reduce((sum, o) =>
            sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
          const bestCase = tu.outcomes.length > 0 ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
          const worstCase = tu.outcomes.length > 0 ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
          const { rows } = await client.query(`
            INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'discovery', $9)
            RETURNING id
          `, [tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage, chanceToProfit, type, bestCase, worstCase, JSON.stringify(tu.outcomes)]);
          const tradeUpId = rows[0].id;
          if (tu.profit_cents > 0) {
            await client.query("UPDATE trade_ups SET peak_profit_cents = $1 WHERE id = $2", [tu.profit_cents, tradeUpId]);
            const comboKey = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join("|");
            await recordProfitableCombo(client as unknown as pg.Pool, tu, comboKey);
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
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = $1 AND is_theoretical = 0",
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
      WHERE type = $1 AND is_theoretical = 0
      ORDER BY (profit_cents + CAST(chance_to_profit * 5000 AS INTEGER)) ASC
      LIMIT $2
    )
  `, [type, toDelete]);

  const deleted2 = await pool.query(`
    DELETE FROM trade_ups WHERE type = $1 AND is_theoretical = 0
      AND id NOT IN (
        SELECT id FROM trade_ups
        WHERE type = $1 AND is_theoretical = 0
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
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE is_theoretical = 0"
  );
  const count = parseInt(countRows[0].cnt, 10);

  if (count <= maxTotal) return 0;

  const toDelete = count - maxTotal;
  // Delete worst by ROI across all types
  await pool.query(`
    DELETE FROM trade_up_inputs WHERE trade_up_id IN (
      SELECT id FROM trade_ups
      WHERE is_theoretical = 0
      ORDER BY roi_percentage ASC
      LIMIT $1
    )
  `, [toDelete]);

  const deleted = await pool.query(`
    DELETE FROM trade_ups WHERE is_theoretical = 0
      AND id NOT IN (
        SELECT id FROM trade_ups
        WHERE is_theoretical = 0
        ORDER BY roi_percentage DESC
        LIMIT $1
      )
  `, [maxTotal]);

  if ((deleted.rowCount ?? 0) > 0) {
    console.log(`  Global trim: removed ${deleted.rowCount} worst-ROI trade-ups (cap ${maxTotal.toLocaleString()})`);
  }
  return deleted.rowCount ?? 0;
}

// Replace missing inputs with alternative listings from same skin/collection.
export async function reviveStaleTradeUps(
  pool: pg.Pool,
  knifeFinishCache: Map<string, FinishData[]>,
  limit = 100
): Promise<{ checked: number; revived: number; improved: number }> {
  // Get partial/stale knife trade-ups, prioritize by profit potential
  const { rows: stale } = await pool.query(`
    SELECT t.id, t.profit_cents, t.peak_profit_cents, t.listing_status
    FROM trade_ups t
    WHERE t.type = 'covert_knife'
      AND t.is_theoretical = 0
      AND t.listing_status IN ('partial', 'stale')
    ORDER BY t.peak_profit_cents DESC, t.profit_cents DESC
    LIMIT $1
  `, [limit]);

  if (stale.length === 0) return { checked: 0, revived: 0, improved: 0 };

  let checked = 0, revived = 0, improved = 0;

  // Build set of existing listing signatures to prevent revival from creating duplicates.
  const knifeExistingSigs = new Set<string>();
  const { rows: knifeExisting } = await pool.query(`
    SELECT t.id, STRING_AGG(tui.listing_id::text, ',') as ids
    FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
    WHERE t.type = 'covert_knife' AND t.is_theoretical = 0
    GROUP BY t.id
  `);
  for (const row of knifeExisting) {
    knifeExistingSigs.add(row.ids.split(",").sort().join(","));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const tu of stale) {
      checked++;
      const { rows: inputs } = await client.query(`
        SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
        FROM trade_up_inputs WHERE trade_up_id = $1
      `, [tu.id]);

      if (inputs.length !== 5) continue;

      // Check which inputs are missing
      const newInputs: ListingWithCollection[] = [];
      let anyMissing = false;
      let anyReplaced = false;
      const usedIds = new Set<string>();

      for (const inp of inputs) {
        const { rows: existRows } = await client.query(`SELECT id FROM listings WHERE id = $1`, [inp.listing_id]);
        if (existRows.length > 0) {
          // Listing still exists — fetch full data
          const { rows: fullRows } = await client.query(`
            SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                   l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                   s.rarity, sc.collection_id, c.name as collection_name
            FROM listings l
            JOIN skins s ON l.skin_id = s.id
            JOIN skin_collections sc ON s.id = sc.skin_id
            JOIN collections c ON sc.collection_id = c.id
            WHERE l.id = $1
          `, [inp.listing_id]);
          const full = fullRows[0] as ListingWithCollection | undefined;
          if (full) {
            newInputs.push(full);
            usedIds.add(full.id);
            continue;
          }
        }

        anyMissing = true;

        // Try same skin first
        const excludeIds = [...usedIds, ...inputs.map((i: { listing_id: string }) => i.listing_id)];
        const excludePlaceholders = excludeIds.map((_, idx) => `$${idx + 2}`).join(",");
        const { rows: sameSkinRows } = await client.query(`
          SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                 l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                 s.rarity, sc.collection_id, c.name as collection_name
          FROM listings l
          JOIN skins s ON l.skin_id = s.id
          JOIN skin_collections sc ON s.id = sc.skin_id
          JOIN collections c ON sc.collection_id = c.id
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
          SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                 l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                 s.rarity, sc.collection_id, c.name as collection_name
          FROM listings l
          JOIN skins s ON l.skin_id = s.id
          JOIN skin_collections sc ON s.id = sc.skin_id
          JOIN collections c ON sc.collection_id = c.id
          WHERE c.name = $1 AND s.rarity = 'Covert' AND l.stattrak = 0
            AND l.id NOT IN (${excludePlaceholders})
          ORDER BY ABS(l.float_value - $${excludeIds.length + 2}) ASC, l.price_cents ASC
          LIMIT 1
        `, [inp.collection_name, ...excludeIds, inp.float_value]);
        const sameCol = sameColRows[0] as ListingWithCollection | undefined;

        if (sameCol) {
          newInputs.push(sameCol);
          usedIds.add(sameCol.id);
          anyReplaced = true;
          continue;
        }

        // No replacement found — can't revive this trade-up
        break;
      }

      if (newInputs.length !== 5) continue;
      if (!anyMissing) continue; // All inputs still exist, shouldn't happen but just in case

      // Dedup: check if the new listing combination already exists in another trade-up.
      // Revival can create duplicates when a replacement listing matches an active trade-up's set.
      const newSig = newInputs.map(i => i.id).sort().join(",");
      if (knifeExistingSigs.has(newSig)) continue; // Would create duplicate — skip

      // Re-evaluate with the new inputs
      const result = await evaluateKnifeTradeUp(pool, newInputs, knifeFinishCache);
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
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0);
      const bestCase = result.outcomes.length > 0 ? Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;
      const worstCase = result.outcomes.length > 0 ? Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;

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

      revived++;
      if (result.profit_cents > tu.profit_cents) improved++;

      // Record if newly profitable
      if (result.profit_cents > 0) {
        const comboKey = [...new Set(result.inputs.map(i => i.collection_name))].sort().join("|");
        await recordProfitableCombo(client as unknown as pg.Pool, result, comboKey);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { checked, revived, improved };
}

/**
 * Revive stale/partial classified→covert trade-ups by finding replacement listings.
 * Same pattern as reviveStaleTradeUps but for 10 Classified inputs → Covert outputs.
 */
export async function reviveStaleGunTradeUps(
  pool: pg.Pool,
  limit = 100
): Promise<{ checked: number; revived: number; improved: number }> {
  const { rows: stale } = await pool.query(`
    SELECT t.id, t.profit_cents, t.peak_profit_cents, t.listing_status
    FROM trade_ups t
    WHERE t.type = 'classified_covert'
      AND t.is_theoretical = 0
      AND t.listing_status IN ('partial', 'stale')
    ORDER BY t.peak_profit_cents DESC, t.profit_cents DESC
    LIMIT $1
  `, [limit]);

  if (stale.length === 0) return { checked: 0, revived: 0, improved: 0 };

  let checked = 0, revived = 0, improved = 0;

  // Build existing listing signatures to prevent revival duplicates (same as knife revival)
  const gunExistingSigs = new Set<string>();
  const gunTypes = ["classified_covert", "restricted_classified", "milspec_restricted", "industrial_milspec", "consumer_industrial"];
  for (const gType of gunTypes) {
    const { rows } = await pool.query(`
      SELECT t.id, STRING_AGG(tui.listing_id::text, ',') as ids
      FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
      WHERE t.type = $1 AND t.is_theoretical = 0
      GROUP BY t.id
    `, [gType]);
    for (const row of rows) {
      gunExistingSigs.add(row.ids.split(",").sort().join(","));
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const tu of stale) {
      checked++;
      const { rows: inputs } = await client.query(`
        SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
        FROM trade_up_inputs WHERE trade_up_id = $1
      `, [tu.id]);

      if (inputs.length !== 10) continue;

      const newInputs: ListingWithCollection[] = [];
      let anyMissing = false;
      let anyReplaced = false;
      const usedIds = new Set<string>();

      for (const inp of inputs) {
        const { rows: existRows } = await client.query(`SELECT id FROM listings WHERE id = $1`, [inp.listing_id]);
        if (existRows.length > 0) {
          const { rows: fullRows } = await client.query(`
            SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                   l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                   s.rarity, sc.collection_id, c.name as collection_name
            FROM listings l
            JOIN skins s ON l.skin_id = s.id
            JOIN skin_collections sc ON s.id = sc.skin_id
            JOIN collections c ON sc.collection_id = c.id
            WHERE l.id = $1
          `, [inp.listing_id]);
          const full = fullRows[0] as ListingWithCollection | undefined;
          if (full) {
            newInputs.push(full);
            usedIds.add(full.id);
            continue;
          }
        }

        anyMissing = true;

        // Try same skin first (exclude already-used IDs)
        const { rows: sameSkinRows } = await client.query(`
          SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                 l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                 s.rarity, sc.collection_id, c.name as collection_name
          FROM listings l
          JOIN skins s ON l.skin_id = s.id
          JOIN skin_collections sc ON s.id = sc.skin_id
          JOIN collections c ON sc.collection_id = c.id
          WHERE l.skin_id = $1
          ORDER BY ABS(l.float_value - $2) ASC, l.price_cents ASC
          LIMIT 1
        `, [inp.skin_id, inp.float_value]);
        const sameSkin = sameSkinRows[0] as ListingWithCollection | undefined;
        if (sameSkin && !usedIds.has(sameSkin.id)) {
          newInputs.push(sameSkin);
          usedIds.add(sameSkin.id);
          anyReplaced = true;
          continue;
        }

        // Try same collection
        const { rows: sameColRows } = await client.query(`
          SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                 l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                 s.rarity, sc.collection_id, c.name as collection_name
          FROM listings l
          JOIN skins s ON l.skin_id = s.id
          JOIN skin_collections sc ON s.id = sc.skin_id
          JOIN collections c ON sc.collection_id = c.id
          WHERE c.name = $1 AND s.rarity = 'Classified' AND l.stattrak = 0
          ORDER BY ABS(l.float_value - $2) ASC, l.price_cents ASC
          LIMIT 1
        `, [inp.collection_name, inp.float_value]);
        const sameCol = sameColRows[0] as ListingWithCollection | undefined;
        if (sameCol && !usedIds.has(sameCol.id)) {
          newInputs.push(sameCol);
          usedIds.add(sameCol.id);
          anyReplaced = true;
          continue;
        }

        break;
      }

      if (newInputs.length !== 10 || !anyMissing) continue;

      // Dedup: skip if new listing combo already exists in another trade-up
      const gunNewSig = newInputs.map(i => i.id).sort().join(",");
      if (gunExistingSigs.has(gunNewSig)) continue;

      // Get Covert outcomes for the collections in this trade-up
      const collectionIds = [...new Set(newInputs.map(i => i.collection_id))];
      const outcomes = await getOutcomesForCollections(pool, collectionIds, "Covert");
      if (outcomes.length === 0) continue;

      const result = await evaluateTradeUp(pool, newInputs, outcomes);
      if (!result) continue;

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

      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0);
      const bestCase = result.outcomes.length > 0 ? Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;
      const worstCase = result.outcomes.length > 0 ? Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;

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

      await client.query(`DELETE FROM trade_up_inputs WHERE trade_up_id = $1`, [tu.id]);
      for (const inp of result.inputs) {
        await client.query(`
          INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [tu.id, inp.listing_id, inp.skin_id, inp.skin_name,
          inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat"]);
      }

      revived++;
      if (result.profit_cents > tu.profit_cents) improved++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { checked, revived, improved };
}

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
  const changedIds = changedListings.map((r: any) => r.id);
  const ph = changedIds.map((_: any, i: number) => `$${i + 1}`).join(",");
  const { rows: staleInputRows } = await pool.query(`
    SELECT DISTINCT tui.trade_up_id
    FROM trade_up_inputs tui
    JOIN listings l ON tui.listing_id = l.id
    WHERE tui.listing_id IN (${ph}) AND tui.price_cents != l.price_cents
  `, changedIds);
  if (staleInputRows.length === 0) {
    // No actual price mismatches in this batch — clear their flags
    const clearPh = changedIds.map((_: any, i: number) => `$${i + 1}`).join(",");
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
          const chance = outcomes.reduce((sum, o) => sum + (o.estimated_price_cents > cost ? o.probability : 0), 0);
          const best = outcomes.length > 0 ? Math.max(...outcomes.map(o => o.estimated_price_cents)) - cost : 0;
          const worst = outcomes.length > 0 ? Math.min(...outcomes.map(o => o.estimated_price_cents)) - cost : 0;

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
    const clearPh = changedIds.map((_: any, i: number) => `$${i + 1}`).join(",");
    await pool.query(`UPDATE listings SET price_updated_at = NULL WHERE id IN (${clearPh})`, changedIds);
  }

  return { updated };
}
