import Database from "better-sqlite3";
import {
  floatToCondition,
  type TradeUp,
} from "../../shared/types.js";
import type { DbSkinOutcome, ListingWithCollection, AdjustedListing } from "./types.js";
import { EXCLUDED_COLLECTIONS } from "./types.js";
import { buildPriceCache } from "./pricing.js";
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
    stattrak?: boolean;
    onProgress?: ProgressCallback;
    onFlush?: (tradeUps: TradeUp[], isFirst: boolean) => void;
  } = {}
): TradeUp[] {
  const targetRarities = options.rarities ?? ["Classified"];
  const stattrak = options.stattrak ?? false;
  const limit = options.limit ?? 200000;
  const store = new TradeUpStore(options.maxPerSignature ?? 50);
  let isFirstFlush = true;

  options.onProgress?.("Building price cache...", 0, 100);
  buildPriceCache(db);

  const tryAdd = (tu: TradeUp | null) => {
    if (!tu) return;
    if (options.maxTotalCost && tu.total_cost_cents > options.maxTotalCost) return;
    // High chance-to-profit trade-ups bypass profit/ROI filters — they're gambles worth tracking
    const highChance = (tu.chance_to_profit ?? 0) >= 0.25;
    if (!highChance) {
      if (options.minProfit && tu.profit_cents < options.minProfit) return;
      if (options.minRoi && tu.roi_percentage < options.minRoi) return;
    }
    store.add(tu);
  };

  for (const inputRarity of targetRarities) {
    const outputRarity = getNextRarity(inputRarity);
    if (!outputRarity) continue;

    options.onProgress?.(`Loading ${inputRarity}...`, 0, 100);

    const allListings = getListingsForRarity(db, inputRarity, options.maxInputCost, stattrak);
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

    const allCollectionIds = [...byCollection.keys()].filter(id => !EXCLUDED_COLLECTIONS.has(id));
    const allOutcomes = getOutcomesForCollections(db, allCollectionIds, outputRarity, stattrak);
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

    // Step 1: Single-collection (baseline + float-targeted)
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

      // Value-sorted: lowest adjusted float first (best output condition, may cost more)
      const valueSorted = [...colListings].sort(
        (a, b) => {
          const adjA = (a.max_float - a.min_float) > 0 ? (a.float_value - a.min_float) / (a.max_float - a.min_float) : 0;
          const adjB = (b.max_float - b.min_float) > 0 ? (b.float_value - b.min_float) / (b.max_float - b.min_float) : 0;
          return adjA - adjB || a.price_cents - b.price_cents;
        }
      );
      for (let offset = 0; offset + 10 <= valueSorted.length && offset < 30; offset += 10) {
        tryAdd(evaluateTradeUp(db, valueSorted.slice(offset, offset + 10), outcomes));
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

      // Condition-pure groups — deeper windows catch non-cheapest profitable combos
      const byCondition = new Map<string, ListingWithCollection[]>();
      for (const l of colListings) {
        const cond = floatToCondition(l.float_value);
        const list = byCondition.get(cond) ?? [];
        list.push(l);
        byCondition.set(cond, list);
      }
      for (const [, condListings] of byCondition) {
        for (let window = 0; window < 3; window++) {
          const off = window * 10;
          if (condListings.length >= off + 10) {
            tryAdd(evaluateTradeUp(db, condListings.slice(off, off + 10), outcomes));
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

    // Step 2: Two-collection combos (baseline + float-targeted)
    let pairsProcessed = 0;
    const totalPairs = colIds.length * (colIds.length - 1) / 2;

    for (let i = 0; i < colIds.length; i++) {
      for (let j = i + 1; j < colIds.length; j++) {
        pairsProcessed++;
        const colA = colIds[i];
        const colB = colIds[j];
        const listingsA = byCollection.get(colA) ?? [];
        const listingsB = byCollection.get(colB) ?? [];

        // Pre-compute outcomes and transitions ONCE per pair (reused across all 9 splits)
        const outcomes = outcomesForCols(colA, colB);
        if (outcomes.length === 0) continue;
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

          // Condition-targeted pairs: cheapest N at each condition
          for (const cond of ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"] as const) {
            const condA = listingsA.filter(l => floatToCondition(l.float_value) === cond);
            const condB = listingsB.filter(l => floatToCondition(l.float_value) === cond);
            if (condA.length >= countA && condB.length >= countB) {
              tryAdd(evaluateTradeUp(db, [
                ...condA.slice(0, countA),
                ...condB.slice(0, countB),
              ], outcomes));
            }
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

    // Step 3: Triple-collection combos (reduced scope)
    // Data shows 0% historically profitable for 3+, but keep triples at reduced
    // limits in case market shifts. Quads+ removed entirely.
    const maxTriple = Math.min(colIds.length, 20); // was 27
    for (let i = 0; i < maxTriple; i++) {
      for (let j = i + 1; j < maxTriple; j++) {
        for (let k = j + 1; k < maxTriple; k++) {
          const cols = [colIds[i], colIds[j], colIds[k]];
          const pooled = cols
            .flatMap((c) => byCollection.get(c) ?? [])
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 10) continue;
          // Just cheapest-10 pooled — no float targeting for triples
          const inputs = pooled.slice(0, 10);
          const usedCols = [...new Set(inputs.map((l) => l.collection_id))];
          tryAdd(evaluateTradeUp(db, inputs, outcomesForCols(...usedCols)));
        }
      }
    }
    // Steps 4+: N>=4 collection combos removed — never profitable historically.

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

/**
 * Randomized classified→covert exploration for continuous optimization.
 * Mirrors randomKnifeExplore pattern but with 10 inputs, Classified rarity,
 * and Covert gun outcomes via evaluateTradeUp.
 */
export function randomExplore(
  db: Database.Database,
  options: {
    iterations?: number;
    stattrak?: boolean;
    onProgress?: (msg: string) => void;
  } = {}
): { found: number; explored: number; improved: number } {
  const iterations = options.iterations ?? 300;
  const stattrak = options.stattrak ?? false;
  buildPriceCache(db);

  const allListings = getListingsForRarity(db, "Classified", undefined, stattrak);
  if (allListings.length === 0) return { found: 0, explored: 0, improved: 0 };

  const allAdjusted = addAdjustedFloat(allListings);

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
  for (const [, list] of byCollection) list.sort((a, b) => a.price_cents - b.price_cents);
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Collections that have Covert outputs (excluding non-tradeable collections)
  const allCollectionIds = [...byCollection.keys()].filter(id => !EXCLUDED_COLLECTIONS.has(id));
  const allOutcomes = getOutcomesForCollections(db, allCollectionIds, "Covert", stattrak);
  const collectionsWithOutcomes = new Set(allOutcomes.map(o => o.collection_id));
  const eligibleCollections = [...collectionsWithOutcomes].filter(id => (byCollection.get(id)?.length ?? 0) >= 1);

  if (eligibleCollections.length === 0) return { found: 0, explored: 0, improved: 0 };

  // Index outcomes by collection
  const outcomesByCol = new Map<string, DbSkinOutcome[]>();
  for (const o of allOutcomes) {
    const list = outcomesByCol.get(o.collection_id) ?? [];
    list.push(o);
    outcomesByCol.set(o.collection_id, list);
  }
  const outcomesForCols = (...ids: string[]) => {
    const result: DbSkinOutcome[] = [];
    for (const id of ids) {
      const col = outcomesByCol.get(id);
      if (col) result.push(...col);
    }
    return result;
  };

  const tradeUpType = stattrak ? 'classified_covert_st' : 'classified_covert';

  // Load existing signatures
  const existingSignatures = new Set<string>();
  const existingRows = db.prepare(`
    SELECT trade_up_id, GROUP_CONCAT(listing_id) as ids
    FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = ?)
    GROUP BY trade_up_id
  `).all(tradeUpType) as { trade_up_id: number; ids: string }[];
  for (const row of existingRows) {
    existingSignatures.add(row.ids.split(",").sort().join(","));
  }

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, source, outcomes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'explore', ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  let found = 0;
  let explored = 0;
  let improved = 0;

  for (let iter = 0; iter < iterations; iter++) {
    if (iter % 100 === 0) {
      options.onProgress?.(`Classified explore: ${iter}/${iterations} (${found} new)`);
    }

    try {
      const strategy = Math.floor(Math.random() * 6);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          // Random pair with random split + offset
          const colA = pick(eligibleCollections);
          const colB = pick(eligibleCollections.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          if (listA.length < countA || listB.length < countB) break;
          const maxOffA = Math.min(listA.length - countA, 20);
          const maxOffB = Math.min(listB.length - countB, 20);
          const offA = Math.floor(Math.random() * (maxOffA + 1));
          const offB = Math.floor(Math.random() * (maxOffB + 1));
          inputs = [...listA.slice(offA, offA + countA), ...listB.slice(offB, offB + countB)];
          break;
        }

        case 1: {
          // Single collection with random offset
          const col = pick(eligibleCollections);
          const list = byCollection.get(col) ?? [];
          if (list.length < 10) break;
          const maxOff = Math.min(list.length - 10, 30);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 10);
          break;
        }

        case 2: {
          // Condition-pure from random collection
          const col = pick(eligibleCollections);
          const list = byCollection.get(col) ?? [];
          const conditions = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 10) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 10 + 1, 10));
          inputs = condListings.slice(off, off + 10);
          break;
        }

        case 3: {
          // Triple collection pool
          const cols = [pick(eligibleCollections)];
          while (cols.length < 3) {
            const c = pick(eligibleCollections);
            if (!cols.includes(c)) cols.push(c);
            if (cols.length >= eligibleCollections.length) break;
          }
          if (cols.length < 2) break;
          const pooled = cols
            .flatMap(c => {
              const list = byCollection.get(c) ?? [];
              const off = Math.floor(Math.random() * Math.min(list.length, 10));
              return list.slice(off, off + 8);
            })
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 10) break;
          inputs = pooled.slice(0, 10);
          break;
        }

        case 4: {
          // Global cheapest pool
          const eligible = allListings.filter(l => collectionsWithOutcomes.has(l.collection_id));
          const sorted = [...eligible].sort((a, b) => a.price_cents - b.price_cents);
          const maxOff = Math.min(sorted.length - 10, 100);
          if (maxOff < 0) break;
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = sorted.slice(off, off + 10);
          break;
        }

        case 5: {
          // Float-targeted random pair
          const colA = pick(eligibleCollections);
          const colB = pick(eligibleCollections.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          const target = Math.random() * 0.5;
          const quotas = new Map([[colA, countA], [colB, countB]]);
          const selected = selectForFloatTarget(byColAdj, quotas, target);
          if (selected && selected.length === 10) inputs = selected;
          break;
        }
      }

      if (!inputs || inputs.length !== 10) continue;
      explored++;

      const sig = inputs.map(i => i.id).sort().join(",");
      if (existingSignatures.has(sig)) continue;

      const usedCols = [...new Set(inputs.map(l => l.collection_id))];
      const outcomes = outcomesForCols(...usedCols);
      const result = evaluateTradeUp(db, inputs, outcomes);
      if (!result) continue;
      // Keep profitable OR high chance-to-profit trade-ups
      if (result.profit_cents <= 0 && (result.chance_to_profit ?? 0) < 0.25) continue;

      existingSignatures.add(sig);
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0);
      const bestCase = Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;
      const worstCase = Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;

      const saveTu = db.transaction(() => {
        const info = insertTradeUp.run(
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          tradeUpType, bestCase, worstCase, JSON.stringify(result.outcomes)
        );
        const tuId = info.lastInsertRowid;
        for (const input of result.inputs) {
          insertInput.run(tuId, input.listing_id, input.skin_id, input.skin_name,
            input.collection_name, input.price_cents, input.float_value, input.condition);
        }
      });
      saveTu();
      found++;
    } catch (err) {
      // Ignore individual iteration errors
    }
  }

  return { found, explored, improved };
}
