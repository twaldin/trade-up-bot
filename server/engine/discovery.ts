import Database from "better-sqlite3";
import {
  floatToCondition,
  type TradeUp,
  type TradeUpInput,
} from "../../shared/types.js";
import type { DbSkinOutcome, ListingWithCollection, AdjustedListing } from "./types.js";
import { priceCache, buildPriceCache } from "./pricing.js";
import { getListingsForRarity, getOutcomesForCollections, getNextRarity } from "./data-load.js";
import { addAdjustedFloat, getConditionTransitions, selectForFloatTarget, selectLowestFloat } from "./selection.js";
import { TradeUpStore } from "./store.js";
import { evaluateTradeUp } from "./evaluation.js";

export type ProgressCallback = (msg: string, current: number, total: number) => void;

/**
 * Float-targeted trade-up discovery.
 *
 * For each collection combo (template), instead of only trying cheapest listings:
 * 1. Compute condition transition points for the outcomes
 * 2. At each transition, select cheapest listings that produce that output condition
 * 3. Also try lowest-float selection (best possible output)
 * 4. Keep the original cheapest/sliding-window approach as baseline
 *
 * This captures the huge value difference between conditions
 * (e.g., AK-47 Asiimov FN=$645 vs FT=$44).
 */
export function findProfitableTradeUps(
  db: Database.Database,
  options: {
    maxInputCost?: number;
    maxTotalCost?: number;
    minProfit?: number;
    minRoi?: number;
    rarities?: string[];
    limit?: number;
    maxPerSignature?: number;
    onProgress?: ProgressCallback;
    onFlush?: (tradeUps: TradeUp[], isFirst: boolean) => void;
  } = {}
): TradeUp[] {
  const targetRarities = options.rarities ?? ["Classified"];
  const limit = options.limit ?? 200000;
  const store = new TradeUpStore(options.maxPerSignature ?? 50);
  let isFirstFlush = true;

  options.onProgress?.("Building price cache...", 0, 100);
  buildPriceCache(db);

  const tryAdd = (tu: TradeUp | null) => {
    if (!tu) return;
    if (options.maxTotalCost && tu.total_cost_cents > options.maxTotalCost) return;
    if (options.minProfit && tu.profit_cents < options.minProfit) return;
    if (options.minRoi && tu.roi_percentage < options.minRoi) return;
    store.add(tu);
  };

  for (const inputRarity of targetRarities) {
    const outputRarity = getNextRarity(inputRarity);
    if (!outputRarity) continue;

    options.onProgress?.(`Loading ${inputRarity}...`, 0, 100);

    const allListings = getListingsForRarity(db, inputRarity, options.maxInputCost);
    if (allListings.length === 0) continue;

    // Pre-compute adjusted floats
    const allAdjusted = addAdjustedFloat(allListings);

    // Group by collection (original and float-adjusted)
    const byCollection = new Map<string, ListingWithCollection[]>();
    const byColAdj = new Map<string, AdjustedListing[]>();
    for (const l of allAdjusted) {
      const list = byCollection.get(l.collection_id) ?? [];
      list.push(l);
      byCollection.set(l.collection_id, list);

      const adjList = byColAdj.get(l.collection_id) ?? [];
      adjList.push(l);
      byColAdj.set(l.collection_id, adjList);
    }

    // Sort adjusted listings by price within each collection (for greedy selection)
    for (const [, list] of byColAdj) {
      list.sort((a, b) => a.price_cents - b.price_cents);
    }

    const allCollectionIds = [...byCollection.keys()];
    const allOutcomes = getOutcomesForCollections(db, allCollectionIds, outputRarity);
    if (allOutcomes.length === 0) continue;

    const collectionsWithOutcomes = new Set(allOutcomes.map((o) => o.collection_id));
    const colIds = [...collectionsWithOutcomes].filter((id) =>
      (byCollection.get(id)?.length ?? 0) >= 1
    );

    // Index outcomes by collection for O(1) lookup instead of O(E) linear filter
    const outcomesByCol = new Map<string, DbSkinOutcome[]>();
    for (const o of allOutcomes) {
      const list = outcomesByCol.get(o.collection_id) ?? [];
      list.push(o);
      outcomesByCol.set(o.collection_id, list);
    }

    const outcomesForCols = (...ids: string[]) => {
      if (ids.length === 1) return outcomesByCol.get(ids[0]) ?? [];
      const result: DbSkinOutcome[] = [];
      for (const id of ids) {
        const col = outcomesByCol.get(id);
        if (col) result.push(...col);
      }
      return result;
    };

    console.log(`  ${colIds.length} eligible collections, ${allAdjusted.length} listings`);

    // ── Step 1: Single-collection (baseline + float-targeted) ──
    options.onProgress?.(`${inputRarity}: single-collection scan...`, 0, 100);

    for (const colId of colIds) {
      const colListings = byCollection.get(colId) ?? [];
      if (colListings.length < 10) continue;

      const outcomes = outcomesForCols(colId);
      const transitions = getConditionTransitions(outcomes);

      // Baseline: sliding windows of cheapest
      for (let offset = 0; offset + 10 <= colListings.length && offset < 50; offset += 5) {
        tryAdd(evaluateTradeUp(db, colListings.slice(offset, offset + 10), outcomes));
      }

      // Float-targeted: for each transition point, select optimal listings
      const quotas = new Map([[colId, 10]]);
      for (const target of transitions) {
        const selected = selectForFloatTarget(byColAdj, quotas, target);
        if (selected) {
          tryAdd(evaluateTradeUp(db, selected, outcomes));
        }
      }

      // Lowest-float selection (best possible output condition)
      const lowestFloat = selectLowestFloat(byColAdj, quotas);
      if (lowestFloat) {
        tryAdd(evaluateTradeUp(db, lowestFloat, outcomes));
      }

      // Condition-pure groups
      const byCondition = new Map<string, ListingWithCollection[]>();
      for (const l of colListings) {
        const cond = floatToCondition(l.float_value);
        const list = byCondition.get(cond) ?? [];
        list.push(l);
        byCondition.set(cond, list);
      }
      for (const [, condListings] of byCondition) {
        if (condListings.length >= 10) {
          tryAdd(evaluateTradeUp(db, condListings.slice(0, 10), outcomes));
          if (condListings.length >= 20) {
            tryAdd(evaluateTradeUp(db, condListings.slice(10, 20), outcomes));
          }
        }
      }

      // Per-skin within collection: pool top listings from each skin
      const bySkin = new Map<string, ListingWithCollection[]>();
      for (const l of colListings) {
        const key = l.skin_id;
        const list = bySkin.get(key) ?? [];
        list.push(l);
        bySkin.set(key, list);
      }
      const skinGroups = [...bySkin.values()];
      if (skinGroups.length >= 2) {
        const pooled = skinGroups
          .flatMap((listings) => listings.slice(0, 5))
          .sort((a, b) => a.price_cents - b.price_cents);
        if (pooled.length >= 10) {
          for (let offset = 0; offset + 10 <= pooled.length && offset < 30; offset += 5) {
            tryAdd(evaluateTradeUp(db, pooled.slice(offset, offset + 10), outcomes));
          }
        }
      }
    }

    options.onProgress?.(
      `${inputRarity}: single done (${store.getSignatureCount()} signatures, ${store.total} trade-ups)`,
      15, 100
    );

    // ── Step 2: Two-collection combos (baseline + float-targeted) ──
    let pairsProcessed = 0;
    const totalPairs = colIds.length * (colIds.length - 1) / 2;

    for (let i = 0; i < colIds.length; i++) {
      for (let j = i + 1; j < colIds.length; j++) {
        pairsProcessed++;
        const colA = colIds[i];
        const colB = colIds[j];
        const listingsA = byCollection.get(colA) ?? [];
        const listingsB = byCollection.get(colB) ?? [];
        const outcomes = outcomesForCols(colA, colB);

        // Pre-compute float transition targets for this pair
        const transitions = getConditionTransitions(outcomes);

        for (let countA = 1; countA <= 9; countA++) {
          const countB = 10 - countA;
          if (listingsA.length < countA || listingsB.length < countB) continue;

          // Baseline: cheapest combo
          tryAdd(evaluateTradeUp(db, [
            ...listingsA.slice(0, countA),
            ...listingsB.slice(0, countB),
          ], outcomes));

          // Baseline: offset combos
          if (listingsA.length >= countA + 5 && listingsB.length >= countB + 5) {
            tryAdd(evaluateTradeUp(db, [
              ...listingsA.slice(5, 5 + countA),
              ...listingsB.slice(5, 5 + countB),
            ], outcomes));
          }
          if (listingsA.length >= countA + 10 && listingsB.length >= countB + 10) {
            tryAdd(evaluateTradeUp(db, [
              ...listingsA.slice(10, 10 + countA),
              ...listingsB.slice(10, 10 + countB),
            ], outcomes));
          }

          // Mixed: cheap A + offset B, and vice versa
          if (listingsB.length >= countB + 10) {
            tryAdd(evaluateTradeUp(db, [
              ...listingsA.slice(0, countA),
              ...listingsB.slice(10, 10 + countB),
            ], outcomes));
          }
          if (listingsA.length >= countA + 10) {
            tryAdd(evaluateTradeUp(db, [
              ...listingsA.slice(10, 10 + countA),
              ...listingsB.slice(0, countB),
            ], outcomes));
          }

          // Float-targeted: for each transition, find cheapest listings within budget
          const quotas = new Map([[colA, countA], [colB, countB]]);
          for (const target of transitions) {
            const selected = selectForFloatTarget(byColAdj, quotas, target);
            if (selected) {
              tryAdd(evaluateTradeUp(db, selected, outcomes));
            }
          }

          // Lowest-float selection
          const lowestFloat = selectLowestFloat(byColAdj, quotas);
          if (lowestFloat) {
            tryAdd(evaluateTradeUp(db, lowestFloat, outcomes));
          }
        }
      }

      if (i % 5 === 0) {
        options.onProgress?.(
          `${inputRarity}: pairs ${pairsProcessed}/${totalPairs} (${store.getSignatureCount()} sigs, ${store.total} trade-ups)`,
          15 + Math.round((pairsProcessed / totalPairs) * 55), 100
        );
      }
    }

    options.onProgress?.(
      `${inputRarity}: pairs done (${store.getSignatureCount()} signatures, ${store.total} trade-ups)`,
      70, 100
    );

    // ── Step 3: Triple-collection combos ──
    const maxTriple = Math.min(colIds.length, 20);
    for (let i = 0; i < maxTriple; i++) {
      for (let j = i + 1; j < maxTriple; j++) {
        for (let k = j + 1; k < maxTriple; k++) {
          const cols = [colIds[i], colIds[j], colIds[k]];
          const pooled = cols
            .flatMap((c) => byCollection.get(c) ?? [])
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 10) continue;

          const outcomes = outcomesForCols(...cols);

          // Baseline: cheapest 10
          const inputs = pooled.slice(0, 10);
          const usedCols = [...new Set(inputs.map((l) => l.collection_id))];
          tryAdd(evaluateTradeUp(db, inputs, allOutcomes.filter((o) => usedCols.includes(o.collection_id))));

          // Float-targeted: try key transitions
          const transitions = getConditionTransitions(outcomes);
          // Only try the top 5 most interesting transitions for triples
          for (const target of transitions.slice(0, 5)) {
            // Build quotas: cheapest from each, proportional to availability
            // For triples, just pool them and let greedy handle allocation
            const quotas = new Map<string, number>();
            // Try most common ratio patterns
            const ratioSets = [[8, 1, 1], [5, 3, 2], [4, 3, 3]];
            for (const ratios of ratioSets) {
              quotas.clear();
              const colsSorted = cols
                .map(c => ({ id: c, count: byColAdj.get(c)?.length ?? 0 }))
                .sort((a, b) => b.count - a.count);
              for (let r = 0; r < 3; r++) {
                quotas.set(colsSorted[r].id, ratios[r]);
              }
              const selected = selectForFloatTarget(byColAdj, quotas, target);
              if (selected) {
                const selCols = [...new Set(selected.map(s => s.collection_id))];
                tryAdd(evaluateTradeUp(db, selected, allOutcomes.filter(o => selCols.includes(o.collection_id))));
              }
            }
          }
        }
      }
    }

    // ── Step 4: Quad-collection combos ──
    const maxQuad = Math.min(colIds.length, 12);
    for (let i = 0; i < maxQuad; i++) {
      for (let j = i + 1; j < maxQuad; j++) {
        for (let k = j + 1; k < maxQuad; k++) {
          for (let l = k + 1; l < maxQuad; l++) {
            const cols = [colIds[i], colIds[j], colIds[k], colIds[l]];
            const pooled = cols
              .flatMap((c) => byCollection.get(c) ?? [])
              .sort((a, b) => a.price_cents - b.price_cents);
            if (pooled.length < 10) continue;

            const inputs = pooled.slice(0, 10);
            const usedCols = [...new Set(inputs.map((li) => li.collection_id))];
            tryAdd(evaluateTradeUp(db, inputs, allOutcomes.filter((o) => usedCols.includes(o.collection_id))));
          }
        }
      }
    }

    options.onProgress?.(
      `${inputRarity}: done (${store.total} trade-ups, ${store.getSignatureCount()} signatures)`,
      90, 100
    );

    // Flush results after each rarity tier
    if (options.onFlush) {
      options.onFlush(store.getAll(limit), isFirstFlush);
      isFirstFlush = false;
    }
  }

  options.onProgress?.("Done", 100, 100);
  return store.getAll(limit);
}

// ─── Progressive Optimization ────────────────────────────────────────────────

/**
 * Optimize existing profitable trade-ups by swapping individual listings.
 *
 * For each profitable trade-up, tries to:
 * 1. Find cheaper listings with similar float (reduce cost, same EV)
 * 2. Find lower-float listings for similar price (same cost, better EV)
 *
 * Returns improved trade-ups ready to be merged into the DB.
 */
export function optimizeTradeUps(
  db: Database.Database,
  options: {
    topN?: number;
    onProgress?: (msg: string) => void;
  } = {}
): { improved: number; total: number } {
  const topN = options.topN ?? 500;

  // Rebuild price cache
  buildPriceCache(db);

  // Load top profitable trade-ups
  const rows = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents, t.roi_percentage
    FROM trade_ups t
    WHERE t.profit_cents > 0
    ORDER BY t.profit_cents DESC
    LIMIT ?
  `).all(topN) as {
    id: number;
    total_cost_cents: number;
    expected_value_cents: number;
    profit_cents: number;
    roi_percentage: number;
  }[];

  if (rows.length === 0) return { improved: 0, total: 0 };

  const getInputs = db.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?");
  const getOutcomes = db.prepare("SELECT * FROM trade_up_outcomes WHERE trade_up_id = ?");

  // Load all current listings for swapping candidates
  const allListings = getListingsForRarity(db, "Classified");
  const allAdjusted = addAdjustedFloat(allListings);

  // Index listings by collection and skin for fast lookup
  const byColSkin = new Map<string, AdjustedListing[]>();
  const byCol = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const skinKey = `${l.collection_id}:${l.skin_id}`;
    (byColSkin.get(skinKey) ?? (byColSkin.set(skinKey, []), byColSkin.get(skinKey)!)).push(l);
    (byCol.get(l.collection_id) ?? (byCol.set(l.collection_id, []), byCol.get(l.collection_id)!)).push(l);
  }

  // Sort for efficient lookup
  for (const [, list] of byColSkin) list.sort((a, b) => a.price_cents - b.price_cents);
  for (const [, list] of byCol) list.sort((a, b) => a.price_cents - b.price_cents);

  let improved = 0;

  // Get all Covert outcomes
  const allCollectionIds = [...byCol.keys()];
  const allOutcomes = getOutcomesForCollections(db, allCollectionIds, "Covert");

  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents = ?, expected_value_cents = ?, profit_cents = ?, roi_percentage = ?, chance_to_profit = ?, best_case_cents = ?, worst_case_cents = ?
    WHERE id = ?
  `);
  const deleteInputs = db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id = ?");
  const deleteOutcomes = db.prepare("DELETE FROM trade_up_outcomes WHERE trade_up_id = ?");
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOutcome = db.prepare(`
    INSERT INTO trade_up_outcomes (trade_up_id, skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const inputs = getInputs.all(row.id) as TradeUpInput[];
    if (inputs.length !== 10) continue;

    if (rowIdx % 50 === 0) {
      options.onProgress?.(`Optimizing ${rowIdx}/${rows.length} (${improved} improved)`);
    }

    // Try swapping each input with a better alternative
    let bestImprovement = 0;
    let bestNewInputs: ListingWithCollection[] | null = null;
    let bestRelevantOutcomes: DbSkinOutcome[] | null = null;

    for (let slot = 0; slot < 10; slot++) {
      const original = inputs[slot];

      // Find candidate replacements from the same collection
      const colListings = byCol.get(
        // Need to find collection_id for this collection_name
        allOutcomes.find(o => o.collection_name === original.collection_name)?.collection_id ??
        [...byCol.keys()].find(id => {
          const l = byCol.get(id)?.[0];
          return l && l.collection_name === original.collection_name;
        }) ?? ""
      );
      if (!colListings) continue;

      // Strategy A: cheaper listing with similar float (within 0.02 adjusted)
      // Strategy B: lower-float listing for similar price (within 30%)
      const origAdj = (original.float_value - (allAdjusted.find(l => l.id === original.listing_id)?.min_float ?? 0)) /
        Math.max(0.001, (allAdjusted.find(l => l.id === original.listing_id)?.max_float ?? 1) - (allAdjusted.find(l => l.id === original.listing_id)?.min_float ?? 0));

      const usedIds = new Set(inputs.map(inp => inp.listing_id));

      for (const candidate of colListings) {
        if (usedIds.has(candidate.id)) continue;
        if (candidate.id === original.listing_id) continue;

        const isCheaper = candidate.price_cents < original.price_cents &&
          Math.abs(candidate.adjustedFloat - origAdj) < 0.03;
        const isBetterFloat = candidate.adjustedFloat < origAdj - 0.02 &&
          candidate.price_cents <= original.price_cents * 1.3;

        if (!isCheaper && !isBetterFloat) continue;

        // Build new input set with this swap
        const newInputs: ListingWithCollection[] = [];
        for (let s = 0; s < 10; s++) {
          if (s === slot) {
            newInputs.push(candidate);
          } else {
            // Find the original listing
            const orig = allAdjusted.find(l => l.id === inputs[s].listing_id);
            if (!orig) break;
            newInputs.push(orig);
          }
        }
        if (newInputs.length !== 10) continue;

        // Evaluate
        const usedCols = [...new Set(newInputs.map(l => l.collection_id))];
        const outcomes = allOutcomes.filter(o => usedCols.includes(o.collection_id));
        const result = evaluateTradeUp(db, newInputs, outcomes);
        if (!result) continue;

        const improvement = result.profit_cents - row.profit_cents;
        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          bestNewInputs = newInputs;
          bestRelevantOutcomes = outcomes;
        }
      }
    }

    // Apply best improvement if found
    if (bestNewInputs && bestRelevantOutcomes && bestImprovement > 0) {
      const result = evaluateTradeUp(db, bestNewInputs, bestRelevantOutcomes)!;
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0
      );
      const bestCaseUpd = Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;
      const worstCaseUpd = Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;

      const applyUpdate = db.transaction(() => {
        updateTradeUp.run(
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          bestCaseUpd, worstCaseUpd,
          row.id
        );
        deleteInputs.run(row.id);
        deleteOutcomes.run(row.id);
        for (const input of result.inputs) {
          insertInput.run(row.id, input.listing_id, input.skin_id, input.skin_name,
            input.collection_name, input.price_cents, input.float_value, input.condition);
        }
        for (const outcome of result.outcomes) {
          insertOutcome.run(row.id, outcome.skin_id, outcome.skin_name, outcome.collection_name,
            outcome.probability, outcome.predicted_float, outcome.predicted_condition,
            outcome.estimated_price_cents);
        }
      });

      applyUpdate();
      improved++;
    }
  }

  return { improved, total: rows.length };
}

// ─── Anchor + Spike Explorer ─────────────────────────────────────────────────

/**
 * Start from safe single-collection trade-ups (100% profit chance) and
 * systematically add skins from other collections to create "guaranteed
 * profit floor + chance for a high-value spike" trade-ups.
 *
 * Also works in reverse: start from expensive Covert outputs and find
 * collection combos that can cheaply target them.
 */
export function anchorSpikeExplore(
  db: Database.Database,
  options: {
    onProgress?: (msg: string) => void;
  } = {}
): { found: number } {
  buildPriceCache(db);

  // Load all Classified listings and pre-compute adjusted floats
  const allListings = getListingsForRarity(db, "Classified");
  const allAdjusted = addAdjustedFloat(allListings);

  const byCol = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    (byCol.get(l.collection_id) ?? (byCol.set(l.collection_id, []), byCol.get(l.collection_id)!)).push(l);
  }
  for (const [, list] of byCol) list.sort((a, b) => a.price_cents - b.price_cents);

  // Sort each collection also by adjusted float for low-float selection
  const byColFloat = new Map<string, AdjustedListing[]>();
  for (const [id, list] of byCol) {
    byColFloat.set(id, [...list].sort((a, b) => a.adjustedFloat - b.adjustedFloat));
  }

  const allCollectionIds = [...byCol.keys()];
  const allOutcomes = getOutcomesForCollections(db, allCollectionIds, "Covert");

  // Index outcomes by collection
  const outcomesByCol = new Map<string, DbSkinOutcome[]>();
  for (const o of allOutcomes) {
    (outcomesByCol.get(o.collection_id) ?? (outcomesByCol.set(o.collection_id, []), outcomesByCol.get(o.collection_id)!)).push(o);
  }

  // Find collection IDs by name
  const colNameToId = new Map<string, string>();
  for (const l of allAdjusted) colNameToId.set(l.collection_name, l.collection_id);

  // ── Part 1: Safe base trade-ups → inject spike collections ──

  // Find safe single-collection templates (ones where ALL outcomes are profitable at cheap input cost)
  const safeCollections: { colId: string; colName: string; cheapest10Cost: number }[] = [];
  for (const [colId, listings] of byCol) {
    if (listings.length < 10) continue;
    const outcomes = outcomesByCol.get(colId);
    if (!outcomes || outcomes.length === 0) continue;

    const cheapest10 = listings.slice(0, 10);
    const cost = cheapest10.reduce((s, l) => s + l.price_cents, 0);
    const result = evaluateTradeUp(db, cheapest10, outcomes);
    if (result && result.profit_cents > 0) {
      // Check if ALL outcomes are worth more than cost
      const allProfitable = result.outcomes.every(o => o.estimated_price_cents > cost);
      if (allProfitable) {
        safeCollections.push({ colId, colName: listings[0].collection_name, cheapest10Cost: cost });
      }
    }
  }

  options.onProgress?.(`Found ${safeCollections.length} safe base collections`);

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, best_case_cents, worst_case_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOutcome = db.prepare(`
    INSERT INTO trade_up_outcomes (trade_up_id, skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Load existing listing ID sets to avoid duplicates
  const existingKeys = new Set<string>();
  const existingRows = db.prepare(`
    SELECT trade_up_id, GROUP_CONCAT(listing_id) as ids
    FROM trade_up_inputs GROUP BY trade_up_id
  `).all() as { trade_up_id: number; ids: string }[];
  for (const row of existingRows) {
    existingKeys.add(row.ids.split(",").sort().join(","));
  }

  let found = 0;

  const tryInsert = (tu: TradeUp) => {
    if (tu.profit_cents <= 0) return;
    const key = tu.inputs.map(i => i.listing_id).sort().join(",");
    if (existingKeys.has(key)) return;
    existingKeys.add(key);

    const chanceToProfit = tu.outcomes.reduce((sum, o) =>
      sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
    );
    const bestCase = tu.outcomes.length > 0
      ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
    const worstCase = tu.outcomes.length > 0
      ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;

    const saveTx = db.transaction(() => {
      const result = insertTradeUp.run(
        tu.total_cost_cents, tu.expected_value_cents,
        tu.profit_cents, tu.roi_percentage, chanceToProfit,
        bestCase, worstCase
      );
      const id = result.lastInsertRowid;
      for (const input of tu.inputs) {
        insertInput.run(id, input.listing_id, input.skin_id, input.skin_name,
          input.collection_name, input.price_cents, input.float_value, input.condition);
      }
      for (const outcome of tu.outcomes) {
        insertOutcome.run(id, outcome.skin_id, outcome.skin_name, outcome.collection_name,
          outcome.probability, outcome.predicted_float, outcome.predicted_condition,
          outcome.estimated_price_cents);
      }
    });
    saveTx();
    found++;
  };

  for (const safe of safeCollections) {
    const baseListings = byCol.get(safe.colId) ?? [];
    if (baseListings.length < 10) continue;

    const baseFloatSorted = byColFloat.get(safe.colId) ?? [];

    // Try adding each other collection as a spike
    for (const [spikeColId, spikeListings] of byCol) {
      if (spikeColId === safe.colId) continue;
      if (spikeListings.length === 0) continue;

      const spikeOutcomes = outcomesByCol.get(spikeColId) ?? [];
      if (spikeOutcomes.length === 0) continue;

      const combinedOutcomes = [...(outcomesByCol.get(safe.colId) ?? []), ...spikeOutcomes];

      // Try swap counts: 1, 2, 3 inputs from spike collection
      for (const swapCount of [1, 2, 3]) {
        if (spikeListings.length < swapCount) continue;
        const keepCount = 10 - swapCount;
        if (baseListings.length < keepCount) continue;

        // Strategy A: cheapest base + cheapest spike
        const inputsA = [...baseListings.slice(0, keepCount), ...spikeListings.slice(0, swapCount)];
        const resultA = evaluateTradeUp(db, inputsA, combinedOutcomes);
        if (resultA) tryInsert(resultA);

        // Strategy B: cheapest base + lowest-float spike (for better output conditions)
        const spikeByFloat = byColFloat.get(spikeColId) ?? [];
        if (spikeByFloat.length >= swapCount) {
          const inputsB = [...baseListings.slice(0, keepCount), ...spikeByFloat.slice(0, swapCount)];
          const resultB = evaluateTradeUp(db, inputsB, combinedOutcomes);
          if (resultB) tryInsert(resultB);
        }

        // Strategy C: lowest-float base + cheapest spike (maximize base outcome condition)
        if (baseFloatSorted.length >= keepCount) {
          const inputsC = [...baseFloatSorted.slice(0, keepCount), ...spikeListings.slice(0, swapCount)];
          const resultC = evaluateTradeUp(db, inputsC, combinedOutcomes);
          if (resultC) tryInsert(resultC);
        }

        // Strategy D: float-targeted for key transitions
        const transitions = getConditionTransitions(combinedOutcomes);
        const quotas = new Map([[safe.colId, keepCount], [spikeColId, swapCount]]);
        for (const target of transitions.slice(0, 5)) {
          const selected = selectForFloatTarget(byCol, quotas, target);
          if (selected) {
            const resultD = evaluateTradeUp(db, selected, combinedOutcomes);
            if (resultD) tryInsert(resultD);
          }
        }

        // Strategy E: mid-price tier from spike (sometimes better float than cheapest)
        const midIdx = Math.min(5, spikeListings.length - swapCount);
        if (midIdx > 0) {
          const inputsE = [...baseListings.slice(0, keepCount), ...spikeListings.slice(midIdx, midIdx + swapCount)];
          const resultE = evaluateTradeUp(db, inputsE, combinedOutcomes);
          if (resultE) tryInsert(resultE);
        }
      }
    }

    options.onProgress?.(`Anchor ${safe.colName}: +${found} trade-ups so far`);
  }

  // ── Part 2: High-value target exploration ──
  // Start from expensive Covert outputs, find cheapest paths to them

  // Get outcomes sorted by max price (most valuable first)
  const valuableOutcomes = allOutcomes
    .map(o => ({
      ...o,
      bestPrice: Math.max(
        priceCache.get(`${o.name}:Factory New`) ?? 0,
        priceCache.get(`${o.name}:Minimal Wear`) ?? 0,
      ),
      ftPrice: priceCache.get(`${o.name}:Field-Tested`) ?? 0,
    }))
    .filter(o => o.bestPrice > 10000) // Only outcomes worth $100+ in FN/MW
    .sort((a, b) => b.bestPrice - a.bestPrice);

  options.onProgress?.(`Targeting ${valuableOutcomes.length} high-value outcomes`);

  for (const target of valuableOutcomes) {
    const targetColId = target.collection_id;
    const targetListings = byCol.get(targetColId) ?? [];
    if (targetListings.length === 0) continue;

    const targetOutcomes = outcomesByCol.get(targetColId) ?? [];

    // For this valuable output, pair with every other collection
    for (const [otherColId, otherListings] of byCol) {
      if (otherColId === targetColId) continue;
      if (otherListings.length < 2) continue;

      const otherOutcomes = outcomesByCol.get(otherColId) ?? [];
      if (otherOutcomes.length === 0) continue;

      const combinedOutcomes = [...targetOutcomes, ...otherOutcomes];

      // High ratios from target collection (maximize probability of the valuable outcome)
      for (const targetCount of [9, 8, 7, 6]) {
        const otherCount = 10 - targetCount;
        if (targetListings.length < targetCount || otherListings.length < otherCount) continue;

        // Cheapest combo
        const inputs1 = [...targetListings.slice(0, targetCount), ...otherListings.slice(0, otherCount)];
        const result1 = evaluateTradeUp(db, inputs1, combinedOutcomes);
        if (result1) tryInsert(result1);

        // Float targeted for FN/MW
        const quotas = new Map([[targetColId, targetCount], [otherColId, otherCount]]);
        const transitions = getConditionTransitions(combinedOutcomes);
        for (const t of transitions.slice(0, 3)) {
          const selected = selectForFloatTarget(byCol, quotas, t);
          if (selected) {
            const result2 = evaluateTradeUp(db, selected, combinedOutcomes);
            if (result2) tryInsert(result2);
          }
        }

        // Lowest float
        const lowestFloat = selectLowestFloat(byCol, quotas);
        if (lowestFloat) {
          const result3 = evaluateTradeUp(db, lowestFloat, combinedOutcomes);
          if (result3) tryInsert(result3);
        }
      }
    }

    options.onProgress?.(`Target ${target.name}: +${found} total`);
  }

  return { found };
}

// ─── Deep Cross-Collection Optimizer ─────────────────────────────────────────

/**
 * Enhanced optimizer that tries swapping inputs with listings from ANY collection,
 * not just the same one. This can find trade-ups where changing a collection
 * changes the probability distribution favorably.
 */
export function deepOptimize(
  db: Database.Database,
  options: {
    topN?: number;
    onProgress?: (msg: string) => void;
  } = {}
): { improved: number; total: number } {
  const topN = options.topN ?? 300;
  buildPriceCache(db);

  const rows = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.profit_cents, t.roi_percentage
    FROM trade_ups t WHERE t.profit_cents > 0
    ORDER BY t.profit_cents DESC LIMIT ?
  `).all(topN) as { id: number; total_cost_cents: number; profit_cents: number; roi_percentage: number }[];

  if (rows.length === 0) return { improved: 0, total: 0 };

  const getInputs = db.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?");
  const allListings = getListingsForRarity(db, "Classified");
  const allAdjusted = addAdjustedFloat(allListings);

  const byCol = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    (byCol.get(l.collection_id) ?? (byCol.set(l.collection_id, []), byCol.get(l.collection_id)!)).push(l);
  }
  for (const [, list] of byCol) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build listing lookup by ID
  const listingById = new Map<string, AdjustedListing>();
  for (const l of allAdjusted) listingById.set(l.id, l);

  const allCollectionIds = [...byCol.keys()];
  const allOutcomes = getOutcomesForCollections(db, allCollectionIds, "Covert");

  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents = ?, expected_value_cents = ?, profit_cents = ?, roi_percentage = ?, chance_to_profit = ?, best_case_cents = ?, worst_case_cents = ?
    WHERE id = ?
  `);
  const deleteInputs = db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id = ?");
  const deleteOutcomes = db.prepare("DELETE FROM trade_up_outcomes WHERE trade_up_id = ?");
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOutcome = db.prepare(`
    INSERT INTO trade_up_outcomes (trade_up_id, skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let improved = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const inputs = getInputs.all(row.id) as TradeUpInput[];
    if (inputs.length !== 10) continue;

    if (rowIdx % 50 === 0) {
      options.onProgress?.(`Deep optimize ${rowIdx}/${rows.length} (${improved} improved)`);
    }

    const usedIds = new Set(inputs.map(i => i.listing_id));
    const inputListings = inputs.map(i => listingById.get(i.listing_id)).filter(Boolean) as AdjustedListing[];
    if (inputListings.length !== 10) continue;

    let bestImprovement = 0;
    let bestNewInputs: AdjustedListing[] | null = null;

    // Try swapping each slot with listings from EVERY collection
    for (let slot = 0; slot < 10; slot++) {
      const original = inputListings[slot];

      // Try candidates from same collection first (more likely to be useful), then others
      const collectionsToTry = [
        original.collection_id,
        ...allCollectionIds.filter(id => id !== original.collection_id),
      ];

      for (const colId of collectionsToTry) {
        const candidates = byCol.get(colId) ?? [];
        // Only try top 10 cheapest and top 5 lowest-float per collection
        const toTry = [
          ...candidates.slice(0, 10),
          ...[...candidates].sort((a, b) => a.adjustedFloat - b.adjustedFloat).slice(0, 5),
        ];

        for (const candidate of toTry) {
          if (usedIds.has(candidate.id)) continue;

          // Quick filter: skip if clearly worse (more expensive AND worse float)
          if (candidate.price_cents > original.price_cents * 1.5 &&
              candidate.adjustedFloat > original.adjustedFloat) continue;

          const newInputs = [...inputListings];
          newInputs[slot] = candidate;

          const usedCols = [...new Set(newInputs.map(l => l.collection_id))];
          const outcomes = allOutcomes.filter(o => usedCols.includes(o.collection_id));
          const result = evaluateTradeUp(db, newInputs, outcomes);
          if (!result) continue;

          const improvement = result.profit_cents - row.profit_cents;
          if (improvement > bestImprovement) {
            bestImprovement = improvement;
            bestNewInputs = newInputs;
          }
        }
      }
    }

    if (bestNewInputs && bestImprovement > 0) {
      const usedCols = [...new Set(bestNewInputs.map(l => l.collection_id))];
      const outcomes = allOutcomes.filter(o => usedCols.includes(o.collection_id));
      const result = evaluateTradeUp(db, bestNewInputs, outcomes)!;
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0
      );
      const bestCaseDeep = Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;
      const worstCaseDeep = Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;

      const applyUpdate = db.transaction(() => {
        updateTradeUp.run(
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          bestCaseDeep, worstCaseDeep, row.id
        );
        deleteInputs.run(row.id);
        deleteOutcomes.run(row.id);
        for (const input of result.inputs) {
          insertInput.run(row.id, input.listing_id, input.skin_id, input.skin_name,
            input.collection_name, input.price_cents, input.float_value, input.condition);
        }
        for (const outcome of result.outcomes) {
          insertOutcome.run(row.id, outcome.skin_id, outcome.skin_name, outcome.collection_name,
            outcome.probability, outcome.predicted_float, outcome.predicted_condition,
            outcome.estimated_price_cents);
        }
      });
      applyUpdate();
      improved++;
    }
  }

  return { improved, total: rows.length };
}

// ─── Standalone runner ──────────────────────────────────────────────────────

// ─── Randomized Exploration ──────────────────────────────────────────────────

/**
 * Explores trade-ups using randomized collection combos and float targets.
 * Each call explores different combinations to avoid repeating work.
 *
 * Strategies:
 * 1. Random collection pairs with random split ratios
 * 2. Random collection triples/quads (pooled cheapest)
 * 3. Random float targets within each combo
 * 4. "Cheap pool" — find the cheapest N listings across ALL collections and build combos
 */
export function randomExplore(
  db: Database.Database,
  options: {
    iterations?: number;
    onProgress?: (msg: string) => void;
  } = {}
): { found: number; explored: number } {
  const iterations = options.iterations ?? 500;
  buildPriceCache(db);

  const allListings = getListingsForRarity(db, "Classified");
  if (allListings.length === 0) return { found: 0, explored: 0 };

  const allAdjusted = addAdjustedFloat(allListings);

  const byCol = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    (byCol.get(l.collection_id) ?? (byCol.set(l.collection_id, []), byCol.get(l.collection_id)!)).push(l);
  }
  for (const [, list] of byCol) list.sort((a, b) => a.price_cents - b.price_cents);

  const allColIds = [...byCol.keys()];
  const allOutcomes = getOutcomesForCollections(db, allColIds, "Covert");
  const colsWithOutcomes = allColIds.filter(id =>
    allOutcomes.some(o => o.collection_id === id)
  );

  if (colsWithOutcomes.length < 2) return { found: 0, explored: 0 };

  // Load existing classified_covert trade-up signatures to avoid duplicates
  const existingSignatures = new Set<string>();
  const existingRows = db.prepare(`
    SELECT tui.trade_up_id, GROUP_CONCAT(tui.listing_id) as ids
    FROM trade_up_inputs tui
    JOIN trade_ups tu ON tu.id = tui.trade_up_id
    WHERE tu.type = 'classified_covert'
    GROUP BY tui.trade_up_id
  `).all() as { trade_up_id: number; ids: string }[];
  for (const row of existingRows) {
    existingSignatures.add(row.ids.split(",").sort().join(","));
  }

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, best_case_cents, worst_case_cents, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'classified_covert', datetime('now'))
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOutcome = db.prepare(`
    INSERT INTO trade_up_outcomes (trade_up_id, skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let found = 0;
  let explored = 0;

  for (let iter = 0; iter < iterations; iter++) {
    if (iter % 100 === 0) {
      options.onProgress?.(`Random explore: ${iter}/${iterations} (${found} found)`);
    }

    try {
      // Pick a random strategy
      const strategy = Math.floor(Math.random() * 5);
      let inputs: AdjustedListing[] | null = null;

      switch (strategy) {
        case 0: {
          // Random pair with random split
          const colA = pick(colsWithOutcomes);
          const colB = pick(colsWithOutcomes.filter(c => c !== colA));
          const listA = byCol.get(colA) ?? [];
          const listB = byCol.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          if (listA.length < countA || listB.length < countB) break;

          // Random offset into each collection's listings
          const maxOffsetA = Math.min(listA.length - countA, 30);
          const maxOffsetB = Math.min(listB.length - countB, 30);
          const offA = Math.floor(Math.random() * (maxOffsetA + 1));
          const offB = Math.floor(Math.random() * (maxOffsetB + 1));
          inputs = [
            ...listA.slice(offA, offA + countA),
            ...listB.slice(offB, offB + countB),
          ];
          break;
        }

        case 1: {
          // Random pair with float targeting
          const colA = pick(colsWithOutcomes);
          const colB = pick(colsWithOutcomes.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          const outcomes = allOutcomes.filter(o => o.collection_id === colA || o.collection_id === colB);
          const transitions = getConditionTransitions(outcomes);
          if (transitions.length === 0) break;
          const target = pick(transitions) + (Math.random() - 0.5) * 0.02; // jitter
          const quotas = new Map([[colA, countA], [colB, countB]]);
          inputs = selectForFloatTarget(byCol, quotas, Math.max(0.001, Math.min(1.0, target)));
          break;
        }

        case 2: {
          // Random triple — pool cheapest with random offsets
          const cols = shuffle(colsWithOutcomes).slice(0, 3);
          if (cols.length < 3) break;
          const pooled = cols
            .flatMap(c => {
              const list = byCol.get(c) ?? [];
              const off = Math.floor(Math.random() * Math.min(list.length, 20));
              return list.slice(off, off + 15);
            })
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 10) break;
          inputs = pooled.slice(0, 10);
          break;
        }

        case 3: {
          // Global cheapest pool with random offset
          const globalOffset = Math.floor(Math.random() * Math.min(allAdjusted.length - 10, 200));
          const sorted = [...allAdjusted].sort((a, b) => a.price_cents - b.price_cents);
          inputs = sorted.slice(globalOffset, globalOffset + 10);
          break;
        }

        case 4: {
          // Random quad — pool cheapest
          const cols = shuffle(colsWithOutcomes).slice(0, 4);
          if (cols.length < 4) break;
          const pooled = cols
            .flatMap(c => (byCol.get(c) ?? []).slice(0, 10))
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 10) break;
          inputs = pooled.slice(0, 10);
          break;
        }
      }

      if (!inputs || inputs.length !== 10) continue;
      explored++;

      // Check if this exact combo already exists
      const sig = inputs.map(i => i.id).sort().join(",");
      if (existingSignatures.has(sig)) continue;

      const usedCols = [...new Set(inputs.map(l => l.collection_id))];
      const outcomes = allOutcomes.filter(o => usedCols.includes(o.collection_id));
      const result = evaluateTradeUp(db, inputs, outcomes);
      if (!result || result.profit_cents <= 0) continue;

      // Save to DB
      existingSignatures.add(sig);
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0
      );
      const bestCase = Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;
      const worstCase = Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;

      const saveTu = db.transaction(() => {
        const info = insertTradeUp.run(
          result.total_cost_cents,
          result.expected_value_cents,
          result.profit_cents,
          result.roi_percentage,
          chanceToProfit,
          bestCase,
          worstCase
        );
        const tuId = info.lastInsertRowid;
        for (const input of result.inputs) {
          insertInput.run(tuId, input.listing_id, input.skin_id, input.skin_name,
            input.collection_name, input.price_cents, input.float_value, input.condition);
        }
        for (const outcome of result.outcomes) {
          insertOutcome.run(tuId, outcome.skin_id, outcome.skin_name, outcome.collection_name,
            outcome.probability, outcome.predicted_float, outcome.predicted_condition,
            outcome.estimated_price_cents);
        }
      });
      saveTu();
      found++;
    } catch {
      // Skip any errors in random exploration
    }
  }

  return { found, explored };
}

// ─── Condition-Targeted Classified→Covert Discovery ─────────────────────────

// Condition boundaries: FN <0.07, MW 0.07-0.15, FT 0.15-0.38, WW 0.38-0.45, BS 0.45+
const CONDITION_BOUNDARIES = [
  { name: "Factory New", threshold: 0.07 },
  { name: "Minimal Wear", threshold: 0.15 },
  { name: "Field-Tested", threshold: 0.38 },
  { name: "Well-Worn", threshold: 0.45 },
] as const;

interface ConditionBreakpoint {
  outcome: DbSkinOutcome;
  betterCondition: string;
  worseCondition: string;
  maxAdjusted: number;         // max avg_adjusted to land in betterCondition
  betterPrice: number;         // price in cents at better condition
  worsePrice: number;          // price at worse condition
  priceJump: number;           // absolute jump in cents
  jumpRatio: number;           // betterPrice / worsePrice
  collectionId: string;
  numCovertsInCollection: number;
}

/**
 * Condition-targeted trade-up discovery.
 *
 * Finds classified→covert trade-ups that push output floats across condition
 * boundaries where there's a significant price premium. Targets ALL profitable
 * condition jumps, not just FN:
 *
 * - FT→MW: Dragon Lore MW $9,284 vs FT $683 (13.6x)
 * - MW→FN: AK-47 Asiimov FN $645 vs FT $44 (14.6x)
 * - BS→WW, WW→FT: sometimes valuable for specific skins
 *
 * Three modes:
 * 1. Single-collection: 100% chance of target Covert, 10 float-controlled inputs
 * 2. Coinflip: 2-collection mix for ~50% chance at high-value condition upgrade
 * 3. Multi-covert: 2+ outcomes in same collection, target best breakpoint
 *
 * Float formula: output_float = avg_adjusted * (out_max - out_min) + out_min
 * For condition X: avg_adjusted < (threshold_X - out_min) / (out_max - out_min)
 */
export function findFNTradeUps(
  db: Database.Database,
  options: {
    onProgress?: (msg: string) => void;
    minProfit?: number;
    maxTotalCost?: number;
  } = {}
): TradeUp[] {
  buildPriceCache(db);

  const allListings = getListingsForRarity(db, "Classified");
  if (allListings.length === 0) {
    options.onProgress?.("No Classified listings found");
    return [];
  }

  const allAdjusted = addAdjustedFloat(allListings);

  // Group by collection
  const byCol = new Map<string, AdjustedListing[]>();
  const byColFloat = new Map<string, AdjustedListing[]>(); // sorted by adjustedFloat
  for (const l of allAdjusted) {
    (byCol.get(l.collection_id) ?? (byCol.set(l.collection_id, []), byCol.get(l.collection_id)!)).push(l);
  }
  for (const [id, list] of byCol) {
    list.sort((a, b) => a.price_cents - b.price_cents);
    byColFloat.set(id, [...list].sort((a, b) => a.adjustedFloat - b.adjustedFloat));
  }

  const allCollectionIds = [...byCol.keys()];
  const allOutcomes = getOutcomesForCollections(db, allCollectionIds, "Covert");

  // Index outcomes by collection
  const outcomesByCol = new Map<string, DbSkinOutcome[]>();
  for (const o of allOutcomes) {
    (outcomesByCol.get(o.collection_id) ?? (outcomesByCol.set(o.collection_id, []), outcomesByCol.get(o.collection_id)!)).push(o);
  }

  // ── Build condition breakpoints for every Covert outcome ──
  // For each outcome, find every condition boundary that produces a significant price jump
  const conditionNames = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

  const allBreakpoints: ConditionBreakpoint[] = [];
  for (const o of allOutcomes) {
    const range = o.max_float - o.min_float;
    if (range <= 0) continue;

    const colOutcomes = outcomesByCol.get(o.collection_id) ?? [];

    // Get prices at each condition
    const prices: { condition: string; price: number }[] = [];
    for (const cond of conditionNames) {
      const p = priceCache.get(`${o.name}:${cond}`) ?? 0;
      if (p > 0) prices.push({ condition: cond, price: p });
    }
    if (prices.length < 2) continue;

    // Check each condition boundary for a price jump
    for (const boundary of CONDITION_BOUNDARIES) {
      const maxAdj = (boundary.threshold - o.min_float) / range;
      if (maxAdj <= 0 || maxAdj > 1.0) continue; // Boundary outside skin's float range

      // Find prices on each side of this boundary
      const betterCond = boundary.name;
      const betterIdx = conditionNames.indexOf(betterCond);
      const worseCond = conditionNames[betterIdx + 1];
      if (!worseCond) continue;

      const betterPrice = prices.find(p => p.condition === betterCond)?.price ?? 0;
      const worsePrice = prices.find(p => p.condition === worseCond)?.price ?? 0;
      if (betterPrice <= 0 || worsePrice <= 0) continue;

      const priceJump = betterPrice - worsePrice;
      const jumpRatio = betterPrice / worsePrice;

      // Only include if the jump is meaningful (>20% premium AND >$5 absolute)
      if (jumpRatio < 1.2 || priceJump < 500) continue;

      allBreakpoints.push({
        outcome: o,
        betterCondition: betterCond,
        worseCondition: worseCond,
        maxAdjusted: maxAdj,
        betterPrice,
        worsePrice,
        priceJump,
        jumpRatio,
        collectionId: o.collection_id,
        numCovertsInCollection: colOutcomes.length,
      });
    }
  }

  // Sort by absolute price jump (highest value opportunities first)
  allBreakpoints.sort((a, b) => b.priceJump - a.priceJump || b.jumpRatio - a.jumpRatio);

  options.onProgress?.(`Found ${allBreakpoints.length} condition breakpoints across ${new Set(allBreakpoints.map(b => b.outcome.name)).size} skins`);
  for (const bp of allBreakpoints.slice(0, 10)) {
    options.onProgress?.(`  ${bp.outcome.name}: ${bp.worseCondition} $${(bp.worsePrice / 100).toFixed(0)} → ${bp.betterCondition} $${(bp.betterPrice / 100).toFixed(0)} (${bp.jumpRatio.toFixed(1)}x, +$${(bp.priceJump / 100).toFixed(0)}) maxAdj=${bp.maxAdjusted.toFixed(4)}`);
  }

  const results: TradeUp[] = [];
  const seen = new Set<string>();

  const tryAdd = (tu: TradeUp | null) => {
    if (!tu || tu.expected_value_cents === 0) return;
    if (options.maxTotalCost && tu.total_cost_cents > options.maxTotalCost) return;
    const key = tu.inputs.map(i => i.listing_id).sort().join(",");
    if (seen.has(key)) return;
    seen.add(key);
    results.push(tu);
  };

  // ── Part 1: Single-Collection Condition Targeting ──
  // For each breakpoint, try to build 10-input trade-ups that cross the boundary
  options.onProgress?.("Condition targeting: single-collection scan...");

  // Group breakpoints by collection for efficiency
  const bpByCol = new Map<string, ConditionBreakpoint[]>();
  for (const bp of allBreakpoints) {
    (bpByCol.get(bp.collectionId) ?? (bpByCol.set(bp.collectionId, []), bpByCol.get(bp.collectionId)!)).push(bp);
  }

  for (const [colId, breakpoints] of bpByCol) {
    const colFloatSorted = byColFloat.get(colId);
    if (!colFloatSorted || colFloatSorted.length < 10) continue;

    const outcomes = outcomesByCol.get(colId) ?? [];
    const quotas = new Map([[colId, 10]]);

    for (const bp of breakpoints) {
      // Try lowest-float selection
      const lowestFloat10 = colFloatSorted.slice(0, 10);
      const avgAdj = lowestFloat10.reduce((s, l) => s + l.adjustedFloat, 0) / 10;

      if (avgAdj < bp.maxAdjusted) {
        tryAdd(evaluateTradeUp(db, lowestFloat10, outcomes));
      }

      // Try cheapest within float budget
      const selected = selectForFloatTarget(byCol, quotas, bp.maxAdjusted - 0.002);
      if (selected) {
        tryAdd(evaluateTradeUp(db, selected, outcomes));
      }

      // Also try just barely crossing the boundary (cheapest possible upgrade)
      // Use a slightly tighter target (80% of maxAdj) for a safer margin
      const saferTarget = bp.maxAdjusted * 0.8;
      if (saferTarget > 0.001) {
        const saferSelected = selectForFloatTarget(byCol, quotas, saferTarget);
        if (saferSelected) {
          tryAdd(evaluateTradeUp(db, saferSelected, outcomes));
        }
      }
    }
  }

  options.onProgress?.(`Condition targeting: single-collection done (${results.length} trade-ups)`);

  // ── Part 2: Coinflip Trade-Ups (2-collection combos) ──
  // Mix collections for ~50% chance at a condition-upgraded output
  options.onProgress?.("Condition targeting: coinflip combos...");

  // Focus on breakpoints with price jump >= $50 for coinflip discovery
  const coinflipTargets = allBreakpoints.filter(bp => bp.priceJump >= 5000);

  for (const target of coinflipTargets) {
    const targetColId = target.collectionId;
    const targetOutcomes = outcomesByCol.get(targetColId) ?? [];

    for (const [otherColId, otherListings] of byCol) {
      if (otherColId === targetColId) continue;
      if (otherListings.length < 1) continue;

      const otherOutcomes = outcomesByCol.get(otherColId) ?? [];
      if (otherOutcomes.length === 0) continue;

      const combinedOutcomes = [...targetOutcomes, ...otherOutcomes];

      // For each split ratio
      for (const targetCount of [5, 6, 7, 8, 9, 4, 3, 2, 1]) {
        const otherCount = 10 - targetCount;

        const targetFloats = byColFloat.get(targetColId);
        const otherFloats = byColFloat.get(otherColId);
        if (!targetFloats || targetFloats.length < targetCount) continue;
        if (!otherFloats || otherFloats.length < otherCount) continue;

        const quotas = new Map([[targetColId, targetCount], [otherColId, otherCount]]);

        // Strategy A: target's breakpoint (upgrade target outcome; other outcome at whatever condition)
        const selected = selectForFloatTarget(byCol, quotas, target.maxAdjusted - 0.002);
        if (selected) {
          tryAdd(evaluateTradeUp(db, selected, combinedOutcomes));
        }

        // Strategy B: lowest-float from both
        const lowestInputs = [
          ...targetFloats.slice(0, targetCount),
          ...otherFloats.slice(0, otherCount),
        ];
        const avgAdj = lowestInputs.reduce((s, l) => s + l.adjustedFloat, 0) / 10;
        if (avgAdj < target.maxAdjusted) {
          tryAdd(evaluateTradeUp(db, lowestInputs, combinedOutcomes));
        }

        // Strategy C: tightest constraint across ALL outcomes (all outcomes upgraded)
        let tightestMaxAdj = Infinity;
        for (const o of combinedOutcomes) {
          const range = o.max_float - o.min_float;
          if (range <= 0) continue;
          // Use the target's condition boundary for all outcomes
          const maxAdj = (CONDITION_BOUNDARIES.find(b => b.name === target.betterCondition)!.threshold - o.min_float) / range;
          if (maxAdj > 0 && maxAdj < tightestMaxAdj) {
            tightestMaxAdj = maxAdj;
          }
        }
        if (isFinite(tightestMaxAdj) && tightestMaxAdj > 0 && tightestMaxAdj !== target.maxAdjusted) {
          const tightSelected = selectForFloatTarget(byCol, quotas, tightestMaxAdj - 0.002);
          if (tightSelected) {
            tryAdd(evaluateTradeUp(db, tightSelected, combinedOutcomes));
          }
        }

        // Strategy D: try the NEXT easier boundary if the target boundary is too tight
        // e.g., if FN is impossible, try MW; if MW is impossible, try FT
        const targetBoundaryIdx = CONDITION_BOUNDARIES.findIndex(b => b.name === target.betterCondition);
        if (targetBoundaryIdx < CONDITION_BOUNDARIES.length - 1) {
          const easierBoundary = CONDITION_BOUNDARIES[targetBoundaryIdx + 1];
          const easierMaxAdj = (easierBoundary.threshold - target.outcome.min_float) / (target.outcome.max_float - target.outcome.min_float);
          if (easierMaxAdj > target.maxAdjusted && easierMaxAdj > 0) {
            const easierSelected = selectForFloatTarget(byCol, quotas, easierMaxAdj - 0.002);
            if (easierSelected) {
              tryAdd(evaluateTradeUp(db, easierSelected, combinedOutcomes));
            }
          }
        }
      }
    }
  }

  options.onProgress?.(`Condition targeting: coinflip done (${results.length} trade-ups)`);

  // ── Part 3: Multi-Covert Collection Targeting ──
  // Collections with 2+ Coverts — target the most profitable breakpoint
  options.onProgress?.("Condition targeting: multi-covert collections...");

  const multiCovertCols = new Set<string>();
  for (const bp of allBreakpoints) {
    if (bp.numCovertsInCollection >= 2 && bp.priceJump >= 5000) {
      multiCovertCols.add(bp.collectionId);
    }
  }

  for (const colId of multiCovertCols) {
    const colFloatSorted = byColFloat.get(colId);
    if (!colFloatSorted || colFloatSorted.length < 10) continue;

    const outcomes = outcomesByCol.get(colId) ?? [];
    const colBreakpoints = bpByCol.get(colId) ?? [];
    const quotas = new Map([[colId, 10]]);

    // Try each breakpoint target
    for (const bp of colBreakpoints) {
      const selected = selectForFloatTarget(byCol, quotas, bp.maxAdjusted - 0.002);
      if (selected) {
        tryAdd(evaluateTradeUp(db, selected, outcomes));
      }
    }

    // Also try lowest-float (may cross multiple breakpoints)
    const lowestFloat10 = colFloatSorted.slice(0, 10);
    tryAdd(evaluateTradeUp(db, lowestFloat10, outcomes));
  }

  options.onProgress?.(`Condition targeting: multi-covert done (${results.length} trade-ups)`);

  // Sort by profit descending
  results.sort((a, b) => b.profit_cents - a.profit_cents);

  // Log summary
  const profitable = results.filter(r => r.profit_cents > 0);
  const fnOutputs = results.filter(r => r.outcomes.some(o => o.predicted_condition === "Factory New"));
  const mwOutputs = results.filter(r => r.outcomes.some(o => o.predicted_condition === "Minimal Wear"));
  options.onProgress?.(`Condition-targeted discovery complete: ${results.length} total, ${profitable.length} profitable, ${fnOutputs.length} FN / ${mwOutputs.length} MW outputs`);

  // Log top results
  for (const tu of results.slice(0, 5)) {
    const bestOut = tu.outcomes.reduce((best, o) => o.estimated_price_cents > best.estimated_price_cents ? o : best);
    console.log(
      `  Cost $${(tu.total_cost_cents / 100).toFixed(0)} → EV $${(tu.expected_value_cents / 100).toFixed(0)} ` +
      `(${tu.roi_percentage > 0 ? "+" : ""}${tu.roi_percentage.toFixed(1)}%) ` +
      `Best: ${bestOut.skin_name} ${bestOut.predicted_condition} $${(bestOut.estimated_price_cents / 100).toFixed(0)} ` +
      `(${(bestOut.probability * 100).toFixed(0)}%)`
    );
  }

  return results;
}
