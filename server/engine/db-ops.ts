/**
 * Database persistence: save trade-ups, update collection scores, theory tracking.
 */

import Database from "better-sqlite3";
import { setSyncMeta } from "../db.js";
import { type TradeUp } from "../../shared/types.js";
import type { ListingWithCollection } from "./types.js";

import type { FinishData } from "./knife-data.js";
import { evaluateKnifeTradeUp } from "./knife-evaluation.js";
import { evaluateTradeUp } from "./evaluation.js";
import { getOutcomesForCollections } from "./data-load.js";

/**
 * Retry a function that may fail with SQLITE_BUSY or SQLITE_BUSY_SNAPSHOT.
 * Waits briefly between retries to let the other writer finish.
 */
function withRetry<T>(fn: () => T, maxRetries = 5, label = "DB operation"): T {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      const code = (err as { code?: string }).code ?? "";
      if ((code.includes("SQLITE_BUSY") || msg.includes("database is locked")) && attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s
        const waitMs = 2000 * Math.pow(2, attempt);
        console.log(`  ${label}: DB busy (${code}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        const start = Date.now();
        while (Date.now() - start < waitMs) { /* spin wait — better-sqlite3 is sync */ }
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Refresh listing_status for all real trade-ups based on whether their
 * input listings still exist in the DB. Fast — single SQL pass.
 */
export function refreshListingStatuses(db: Database.Database): { active: number; partial: number; stale: number; preserved: number } {
  // Count missing inputs per trade-up
  const result = db.prepare(`
    UPDATE trade_ups SET
      listing_status = CASE
        WHEN (SELECT COUNT(*) FROM trade_up_inputs tui
              LEFT JOIN listings l ON tui.listing_id = l.id
              WHERE tui.trade_up_id = trade_ups.id AND l.id IS NULL) = 0 THEN 'active'
        WHEN (SELECT COUNT(*) FROM trade_up_inputs tui
              LEFT JOIN listings l ON tui.listing_id = l.id
              WHERE tui.trade_up_id = trade_ups.id AND l.id IS NOT NULL) > 0 THEN 'partial'
        ELSE 'stale'
      END,
      preserved_at = CASE
        WHEN (SELECT COUNT(*) FROM trade_up_inputs tui
              LEFT JOIN listings l ON tui.listing_id = l.id
              WHERE tui.trade_up_id = trade_ups.id AND l.id IS NULL) = 0 THEN NULL
        ELSE COALESCE(preserved_at, datetime('now'))
      END
    WHERE is_theoretical = 0
  `).run();

  const counts = db.prepare(`
    SELECT listing_status, COUNT(*) as cnt
    FROM trade_ups WHERE is_theoretical = 0
    GROUP BY listing_status
  `).all() as { listing_status: string; cnt: number }[];

  const m: Record<string, number> = {};
  for (const r of counts) m[r.listing_status] = r.cnt;

  const preserved = (db.prepare(
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE preserved_at IS NOT NULL"
  ).get() as { cnt: number }).cnt;

  return { active: m.active ?? 0, partial: m.partial ?? 0, stale: m.stale ?? 0, preserved };
}

/**
 * Purge preserved trade-ups older than maxDays.
 */
export function purgeExpiredPreserved(db: Database.Database, maxDays = 2): number {
  // Delete outcomes and inputs first (foreign key cascade should handle it, but be explicit)
  const ids = db.prepare(
    "SELECT id FROM trade_ups WHERE preserved_at IS NOT NULL AND julianday('now') - julianday(preserved_at) > ?"
  ).all(maxDays) as { id: number }[];

  if (ids.length === 0) return 0;

  const idList = ids.map(r => r.id).join(",");
  db.exec(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (${idList})`);
  db.exec(`DELETE FROM trade_ups WHERE id IN (${idList})`);
  return ids.length;
}

/**
 * Record a combo as profitable in the history table. Called whenever discovery finds profit.
 */
export function recordProfitableCombo(db: Database.Database, tu: TradeUp, comboKey: string) {
  const collections = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join(" + ");
  const recipe = tu.inputs.map(i =>
    `${i.skin_name}|${i.condition}|${i.collection_name}`
  ).sort().join(";");

  db.prepare(`
    INSERT INTO profitable_combos (combo_key, collections, best_profit_cents, best_roi,
      times_profitable, last_profitable_at, last_cost_cents, input_recipe)
    VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?)
    ON CONFLICT(combo_key) DO UPDATE SET
      best_profit_cents = MAX(profitable_combos.best_profit_cents, excluded.best_profit_cents),
      best_roi = MAX(profitable_combos.best_roi, excluded.best_roi),
      times_profitable = profitable_combos.times_profitable + 1,
      last_profitable_at = datetime('now'),
      last_cost_cents = excluded.last_cost_cents,
      input_recipe = excluded.input_recipe
  `).run(comboKey, collections, tu.profit_cents, tu.roi_percentage, tu.total_cost_cents, recipe);
}

/**
 * Get profitable combo history for wanted list boosting.
 * Returns combos that have been profitable, sorted by recency and profit.
 */
export function getProfitableCombosForWantedList(db: Database.Database): {
  combo_key: string; collections: string; best_profit: number; input_recipe: string; last_profitable: string;
}[] {
  return db.prepare(`
    SELECT combo_key, collections, best_profit_cents as best_profit,
           input_recipe, last_profitable_at as last_profitable
    FROM profitable_combos
    WHERE julianday('now') - julianday(last_profitable_at) <= 7
    ORDER BY last_profitable_at DESC, best_profit_cents DESC
    LIMIT 50
  `).all() as { combo_key: string; collections: string; best_profit: number; input_recipe: string; last_profitable: string }[];
}

export function saveTradeUps(db: Database.Database, tradeUps: TradeUp[], clearFirst: boolean = true, type: string = "classified_covert", isTheoretical: boolean = false, source: string = "discovery") {
  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    if (clearFirst) {
      // Preserve materialized results when discovery clears — they're found by a different process
      const sourceFilter = source === "discovery" ? " AND (source = 'discovery' OR source IS NULL)" : "";
      db.prepare(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = ? AND is_theoretical = ?${sourceFilter})`).run(type, isTheoretical ? 1 : 0);
      db.prepare(`DELETE FROM trade_ups WHERE type = ? AND is_theoretical = ?${sourceFilter}`).run(type, isTheoretical ? 1 : 0);
    }

    for (const tu of tradeUps) {
      const chanceToProfit = tu.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
      );

      const bestCase = tu.outcomes.length > 0
        ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
      const worstCase = tu.outcomes.length > 0
        ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;

      const result = insertTradeUp.run(
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
      );
      const tradeUpId = result.lastInsertRowid;

      for (const input of tu.inputs) {
        insertInput.run(
          tradeUpId,
          input.listing_id,
          input.skin_id,
          input.skin_name,
          input.collection_name,
          input.price_cents,
          input.float_value,
          input.condition,
          input.source ?? "csfloat"
        );
      }
    }
  });

  withRetry(() => saveAll(), 3, "saveTradeUps");
  setSyncMeta(db, "last_calculation", new Date().toISOString());
}

export function mergeTradeUps(db: Database.Database, tradeUps: TradeUp[], type: string = "classified_covert") {
  // Upsert trade-ups by listing signature. New sigs inserted, existing updated, missing marked stale.

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'discovery', ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents=?, expected_value_cents=?, profit_cents=?, roi_percentage=?, chance_to_profit=?, best_case_cents=?, worst_case_cents=?,
      peak_profit_cents = MAX(peak_profit_cents, ?), listing_status = 'active', preserved_at = NULL, outcomes_json = ?,
      profit_streak = ?
    WHERE id=?
  `);
  const getOldProfit = db.prepare(`SELECT profit_cents, profit_streak FROM trade_ups WHERE id = ?`);

  const newSigs = new Map<string, number>();
  for (let i = 0; i < tradeUps.length; i++) {
    const sig = tradeUps[i].inputs.map(inp => inp.listing_id).sort().join(",");
    newSigs.set(sig, i);
  }

  const mergeAll = db.transaction(() => {
    const existing = db.prepare(`
      SELECT t.id, GROUP_CONCAT(tui.listing_id) as ids
      FROM trade_ups t
      JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
      WHERE t.type = ? AND t.is_theoretical = 0
      GROUP BY t.id
    `).all(type) as { id: number; ids: string }[];

    const existingSigs = new Map<string, number>();
    for (const row of existing) {
      const sig = row.ids.split(",").sort().join(",");
      existingSigs.set(sig, row.id);
    }

    const handled = new Set<string>();
    for (const [sig, existId] of existingSigs) {
      const newIdx = newSigs.get(sig);
      if (newIdx !== undefined) {
        const tu = tradeUps[newIdx];
        const chanceToProfit = tu.outcomes.reduce((sum, o) =>
          sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
        const bestCase = tu.outcomes.length > 0 ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
        const worstCase = tu.outcomes.length > 0 ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
        // Compute profit streak: consecutive cycles profitable
        const old = getOldProfit.get(existId) as { profit_cents: number; profit_streak: number } | undefined;
        let streak = 0;
        if (tu.profit_cents > 0) {
          streak = (old && old.profit_cents > 0) ? (old.profit_streak ?? 0) + 1 : 1;
        }
        updateTradeUp.run(tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage, chanceToProfit, bestCase, worstCase, Math.max(tu.profit_cents, 0), JSON.stringify(tu.outcomes), streak, existId);
        if (tu.profit_cents > 0) {
          const comboKey = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join("|");
          recordProfitableCombo(db, tu, comboKey);
        }
        handled.add(sig);
      } else {
        db.prepare("UPDATE trade_ups SET listing_status = 'stale', preserved_at = COALESCE(preserved_at, datetime('now')) WHERE id = ?").run(existId);
      }
    }

    for (const [sig, idx] of newSigs) {
      if (handled.has(sig)) continue;
      const tu = tradeUps[idx];
      const chanceToProfit = tu.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0);
      const bestCase = tu.outcomes.length > 0 ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
      const worstCase = tu.outcomes.length > 0 ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
      const result = insertTradeUp.run(tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage, chanceToProfit, type, bestCase, worstCase, JSON.stringify(tu.outcomes));
      const tradeUpId = result.lastInsertRowid;
      if (tu.profit_cents > 0) {
        db.prepare("UPDATE trade_ups SET peak_profit_cents = ? WHERE id = ?").run(tu.profit_cents, tradeUpId);
        const comboKey = [...new Set(tu.inputs.map(i => i.collection_name))].sort().join("|");
        recordProfitableCombo(db, tu, comboKey);
      }
      for (const inp of tu.inputs) {
        insertInput.run(tradeUpId, inp.listing_id, inp.skin_id, inp.skin_name, inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat");
      }
    }
  });

  withRetry(() => mergeAll(), 3, "mergeTradeUps");
  setSyncMeta(db, "last_calculation", new Date().toISOString());

  // Trim excess: keep top 50K by composite score (profit + chance-to-profit bonus).
  // Merge-save accumulates forever — classified hit 400K+, knife 220K+. Purge the rest.
  trimExcessTradeUps(db, type, 50000);
}

/**
 * Trim trade-ups for a type down to maxKeep, scored by profit + chance-to-profit.
 * Profitable and high-chance trade-ups are kept; low-value unprofitable ones are purged.
 */
function trimExcessTradeUps(db: Database.Database, type: string, maxKeep: number) {
  const count = (db.prepare(
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = ? AND is_theoretical = 0"
  ).get(type) as { cnt: number }).cnt;

  if (count <= maxKeep) return;

  const toDelete = count - maxKeep;
  // Delete lowest-scored: sort by (profit + chance_bonus) ascending, delete the bottom N
  // Profitable trade-ups and high-chance ones are preserved
  const deleted = db.prepare(`
    DELETE FROM trade_up_inputs WHERE trade_up_id IN (
      SELECT id FROM trade_ups
      WHERE type = ? AND is_theoretical = 0
      ORDER BY (profit_cents + CAST(chance_to_profit * 5000 AS INTEGER)) ASC
      LIMIT ?
    )
  `).run(type, toDelete);

  const deleted2 = db.prepare(`
    DELETE FROM trade_ups WHERE type = ? AND is_theoretical = 0
      AND id NOT IN (
        SELECT id FROM trade_ups
        WHERE type = ? AND is_theoretical = 0
        ORDER BY (profit_cents + CAST(chance_to_profit * 5000 AS INTEGER)) DESC
        LIMIT ?
      )
  `).run(type, type, maxKeep);

  if (deleted2.changes > 0) {
    console.log(`  Trimmed ${deleted2.changes} excess ${type} trade-ups (kept top ${maxKeep})`);
  }
}


// Replace missing inputs with alternative listings from same skin/collection.
export function reviveStaleTradeUps(
  db: Database.Database,
  knifeFinishCache: Map<string, FinishData[]>,
  limit = 100
): { checked: number; revived: number; improved: number } {
  // Get partial/stale knife trade-ups, prioritize by profit potential
  const stale = db.prepare(`
    SELECT t.id, t.profit_cents, t.peak_profit_cents, t.listing_status
    FROM trade_ups t
    WHERE t.type = 'covert_knife'
      AND t.is_theoretical = 0
      AND t.listing_status IN ('partial', 'stale')
    ORDER BY t.peak_profit_cents DESC, t.profit_cents DESC
    LIMIT ?
  `).all(limit) as { id: number; profit_cents: number; peak_profit_cents: number; listing_status: string }[];

  if (stale.length === 0) return { checked: 0, revived: 0, improved: 0 };

  const getInputs = db.prepare(`
    SELECT tui.listing_id, tui.skin_id, tui.skin_name, tui.collection_name,
           tui.price_cents, tui.float_value, tui.condition, tui.source
    FROM trade_up_inputs tui
    WHERE tui.trade_up_id = ?
  `);

  const checkListingExists = db.prepare(`SELECT id FROM listings WHERE id = ?`);

  // Find replacement: same skin_id, closest float, cheapest
  const findSameSkin = db.prepare(`
    SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
           l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
           s.rarity, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE l.skin_id = ? AND l.id NOT IN (${Array(5).fill('?').join(',')})
    ORDER BY ABS(l.float_value - ?) ASC, l.price_cents ASC
    LIMIT 1
  `);

  // Find replacement: same collection, same rarity (Covert), similar float
  const findSameCollection = db.prepare(`
    SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
           l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
           s.rarity, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE c.name = ? AND s.rarity = 'Covert' AND l.stattrak = 0
      AND l.id NOT IN (${Array(5).fill('?').join(',')})
    ORDER BY ABS(l.float_value - ?) ASC, l.price_cents ASC
    LIMIT 1
  `);

  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents=?, expected_value_cents=?, profit_cents=?,
      roi_percentage=?, chance_to_profit=?, best_case_cents=?, worst_case_cents=?,
      peak_profit_cents = MAX(peak_profit_cents, ?),
      listing_status = 'active', preserved_at = NULL,
      previous_inputs = ?, outcomes_json = ?
    WHERE id=?
  `);
  const deleteInputs = db.prepare(`DELETE FROM trade_up_inputs WHERE trade_up_id = ?`);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let checked = 0, revived = 0, improved = 0;

  const reviveAll = db.transaction(() => {
    for (const tu of stale) {
      checked++;
      const inputs = getInputs.all(tu.id) as {
        listing_id: string; skin_id: string; skin_name: string;
        collection_name: string; price_cents: number; float_value: number; condition: string;
      }[];

      if (inputs.length !== 5) continue;

      // Check which inputs are missing
      const newInputs: ListingWithCollection[] = [];
      let anyMissing = false;
      let anyReplaced = false;
      const usedIds = new Set<string>();

      for (const inp of inputs) {
        const exists = checkListingExists.get(inp.listing_id);
        if (exists) {
          // Listing still exists — fetch full data
          const full = db.prepare(`
            SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                   l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                   s.rarity, sc.collection_id, c.name as collection_name
            FROM listings l
            JOIN skins s ON l.skin_id = s.id
            JOIN skin_collections sc ON s.id = sc.skin_id
            JOIN collections c ON sc.collection_id = c.id
            WHERE l.id = ?
          `).get(inp.listing_id) as ListingWithCollection | undefined;
          if (full) {
            newInputs.push(full);
            usedIds.add(full.id);
            continue;
          }
        }

        anyMissing = true;

        // Try same skin first
        const excludeIds = [...usedIds, ...inputs.map(i => i.listing_id)];
        while (excludeIds.length < 5) excludeIds.push('');
        const sameSkin = findSameSkin.get(
          inp.skin_id, ...excludeIds.slice(0, 5), inp.float_value
        ) as ListingWithCollection | undefined;

        if (sameSkin) {
          newInputs.push(sameSkin);
          usedIds.add(sameSkin.id);
          anyReplaced = true;
          continue;
        }

        // Try same collection
        const sameCol = findSameCollection.get(
          inp.collection_name, ...excludeIds.slice(0, 5), inp.float_value
        ) as ListingWithCollection | undefined;

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

      // Re-evaluate with the new inputs
      const result = evaluateKnifeTradeUp(db, newInputs, knifeFinishCache);
      if (!result) continue;

      // Build previous_inputs: only store inputs that were replaced
      const oldListingIds = new Set(inputs.map(i => i.listing_id));
      const newListingIds = new Set(result.inputs.map(i => i.listing_id));
      const replacedOld = inputs.filter(i => !newListingIds.has(i.listing_id));
      const replacedNew = result.inputs.filter(i => !oldListingIds.has(i.listing_id));
      const previousInputsJson = replacedOld.length > 0 ? JSON.stringify({
        old_profit_cents: tu.profit_cents,
        old_cost_cents: inputs.reduce((s, i) => s + i.price_cents, 0),
        replaced: replacedOld.map((old, idx) => ({
          old: { skin_name: old.skin_name, price_cents: old.price_cents, float_value: old.float_value, condition: old.condition, listing_id: old.listing_id },
          new: replacedNew[idx] ? { skin_name: replacedNew[idx].skin_name, price_cents: replacedNew[idx].price_cents, float_value: replacedNew[idx].float_value, condition: replacedNew[idx].condition, listing_id: replacedNew[idx].listing_id } : null,
        })),
      }) : null;

      // Update the trade-up with new data
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0);
      const bestCase = result.outcomes.length > 0 ? Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;
      const worstCase = result.outcomes.length > 0 ? Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;

      updateTradeUp.run(
        result.total_cost_cents, result.expected_value_cents, result.profit_cents,
        result.roi_percentage, chanceToProfit, bestCase, worstCase,
        Math.max(result.profit_cents, 0), previousInputsJson, JSON.stringify(result.outcomes), tu.id
      );

      // Replace inputs
      deleteInputs.run(tu.id);
      for (const inp of result.inputs) {
        insertInput.run(tu.id, inp.listing_id, inp.skin_id, inp.skin_name,
          inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat");
      }

      revived++;
      if (result.profit_cents > tu.profit_cents) improved++;

      // Record if newly profitable
      if (result.profit_cents > 0) {
        const comboKey = [...new Set(result.inputs.map(i => i.collection_name))].sort().join("|");
        recordProfitableCombo(db, result, comboKey);
      }
    }
  });

  reviveAll();
  return { checked, revived, improved };
}

/**
 * Revive stale/partial classified→covert trade-ups by finding replacement listings.
 * Same pattern as reviveStaleTradeUps but for 10 Classified inputs → Covert outputs.
 */
export function reviveStaleGunTradeUps(
  db: Database.Database,
  limit = 100
): { checked: number; revived: number; improved: number } {
  const stale = db.prepare(`
    SELECT t.id, t.profit_cents, t.peak_profit_cents, t.listing_status
    FROM trade_ups t
    WHERE t.type = 'classified_covert'
      AND t.is_theoretical = 0
      AND t.listing_status IN ('partial', 'stale')
    ORDER BY t.peak_profit_cents DESC, t.profit_cents DESC
    LIMIT ?
  `).all(limit) as { id: number; profit_cents: number; peak_profit_cents: number; listing_status: string }[];

  if (stale.length === 0) return { checked: 0, revived: 0, improved: 0 };

  const getInputs = db.prepare(`
    SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
    FROM trade_up_inputs WHERE trade_up_id = ?
  `);
  const checkListingExists = db.prepare(`SELECT id FROM listings WHERE id = ?`);

  const findSameSkin = db.prepare(`
    SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
           l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
           s.rarity, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE l.skin_id = ?
    ORDER BY ABS(l.float_value - ?) ASC, l.price_cents ASC
    LIMIT 1
  `);

  const findSameCollection = db.prepare(`
    SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
           l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
           s.rarity, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE c.name = ? AND s.rarity = 'Classified' AND l.stattrak = 0
    ORDER BY ABS(l.float_value - ?) ASC, l.price_cents ASC
    LIMIT 1
  `);

  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents=?, expected_value_cents=?, profit_cents=?,
      roi_percentage=?, chance_to_profit=?, best_case_cents=?, worst_case_cents=?,
      peak_profit_cents = MAX(peak_profit_cents, ?),
      listing_status = 'active', preserved_at = NULL,
      previous_inputs = ?, outcomes_json = ?
    WHERE id=?
  `);
  const deleteInputs = db.prepare(`DELETE FROM trade_up_inputs WHERE trade_up_id = ?`);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let checked = 0, revived = 0, improved = 0;

  const reviveAll = db.transaction(() => {
    for (const tu of stale) {
      checked++;
      const inputs = getInputs.all(tu.id) as {
        listing_id: string; skin_id: string; skin_name: string;
        collection_name: string; price_cents: number; float_value: number; condition: string;
      }[];

      if (inputs.length !== 10) continue;

      const newInputs: ListingWithCollection[] = [];
      let anyMissing = false;
      let anyReplaced = false;
      const usedIds = new Set<string>();

      for (const inp of inputs) {
        const exists = checkListingExists.get(inp.listing_id);
        if (exists) {
          const full = db.prepare(`
            SELECT l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
                   l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
                   s.rarity, sc.collection_id, c.name as collection_name
            FROM listings l
            JOIN skins s ON l.skin_id = s.id
            JOIN skin_collections sc ON s.id = sc.skin_id
            JOIN collections c ON sc.collection_id = c.id
            WHERE l.id = ?
          `).get(inp.listing_id) as ListingWithCollection | undefined;
          if (full) {
            newInputs.push(full);
            usedIds.add(full.id);
            continue;
          }
        }

        anyMissing = true;

        // Try same skin first (exclude already-used IDs)
        const sameSkin = findSameSkin.get(inp.skin_id, inp.float_value) as ListingWithCollection | undefined;
        if (sameSkin && !usedIds.has(sameSkin.id)) {
          newInputs.push(sameSkin);
          usedIds.add(sameSkin.id);
          anyReplaced = true;
          continue;
        }

        // Try same collection
        const sameCol = findSameCollection.get(inp.collection_name, inp.float_value) as ListingWithCollection | undefined;
        if (sameCol && !usedIds.has(sameCol.id)) {
          newInputs.push(sameCol);
          usedIds.add(sameCol.id);
          anyReplaced = true;
          continue;
        }

        break;
      }

      if (newInputs.length !== 10 || !anyMissing) continue;

      // Get Covert outcomes for the collections in this trade-up
      const collectionIds = [...new Set(newInputs.map(i => i.collection_id))];
      const outcomes = getOutcomesForCollections(db, collectionIds, "Covert");
      if (outcomes.length === 0) continue;

      const result = evaluateTradeUp(db, newInputs, outcomes);
      if (!result) continue;

      const oldListingIds = new Set(inputs.map(i => i.listing_id));
      const newListingIds = new Set(result.inputs.map(i => i.listing_id));
      const replacedOld = inputs.filter(i => !newListingIds.has(i.listing_id));
      const replacedNew = result.inputs.filter(i => !oldListingIds.has(i.listing_id));
      const previousInputsJson = replacedOld.length > 0 ? JSON.stringify({
        old_profit_cents: tu.profit_cents,
        old_cost_cents: inputs.reduce((s, i) => s + i.price_cents, 0),
        replaced: replacedOld.map((old, idx) => ({
          old: { skin_name: old.skin_name, price_cents: old.price_cents, float_value: old.float_value, condition: old.condition, listing_id: old.listing_id },
          new: replacedNew[idx] ? { skin_name: replacedNew[idx].skin_name, price_cents: replacedNew[idx].price_cents, float_value: replacedNew[idx].float_value, condition: replacedNew[idx].condition, listing_id: replacedNew[idx].listing_id } : null,
        })),
      }) : null;

      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0);
      const bestCase = result.outcomes.length > 0 ? Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;
      const worstCase = result.outcomes.length > 0 ? Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents : 0;

      updateTradeUp.run(
        result.total_cost_cents, result.expected_value_cents, result.profit_cents,
        result.roi_percentage, chanceToProfit, bestCase, worstCase,
        Math.max(result.profit_cents, 0), previousInputsJson, JSON.stringify(result.outcomes), tu.id
      );

      deleteInputs.run(tu.id);
      for (const inp of result.inputs) {
        insertInput.run(tu.id, inp.listing_id, inp.skin_id, inp.skin_name,
          inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat");
      }

      revived++;
      if (result.profit_cents > tu.profit_cents) improved++;
    }
  });

  reviveAll();
  return { checked, revived, improved };
}

export function updateCollectionScores(db: Database.Database) {
  const scores = db.prepare(`
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
  `).all() as {
    collection_name: string;
    total_tradeups: number;
    profitable_count: number;
    avg_profit: number | null;
    max_profit: number;
    avg_roi: number | null;
  }[];

  const colIdLookup = new Map<string, string>();
  const colRows = db.prepare("SELECT id, name FROM collections").all() as { id: string; name: string }[];
  for (const r of colRows) colIdLookup.set(r.name, r.id);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO collection_scores
      (collection_id, collection_name, profitable_count, avg_profit_cents, max_profit_cents, avg_roi, total_tradeups, priority_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateAll = db.transaction(() => {
    db.exec("DELETE FROM collection_scores");

    for (const s of scores) {
      const colId = colIdLookup.get(s.collection_name);
      if (!colId) continue;

      const profitableWeight = Math.min(s.profitable_count, 50);
      const avgProfitWeight = Math.min((s.avg_profit ?? 0) / 100, 50);
      const roiWeight = Math.min((s.avg_roi ?? 0) / 5, 20);
      const priorityScore = profitableWeight * 2 + avgProfitWeight + roiWeight;

      upsert.run(
        colId,
        s.collection_name,
        s.profitable_count,
        Math.round(s.avg_profit ?? 0),
        s.max_profit,
        Math.round((s.avg_roi ?? 0) * 100) / 100,
        s.total_tradeups,
        Math.round(priorityScore * 100) / 100
      );
    }
  });

  updateAll();
  console.log(`  Updated ${scores.length} collection scores`);
}
