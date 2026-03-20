import pg from "pg";
import {
  floatToCondition,
  type TradeUp,
} from "../../shared/types.js";
import type { DbSkinOutcome, ListingWithCollection } from "./types.js";
import { EXCLUDED_COLLECTIONS, CONDITION_BOUNDS } from "./types.js";
import { buildPriceCache } from "./pricing.js";
import { getOutcomesForCollections, getNextRarity, loadDiscoveryData, buildWeightedPool } from "./data-load.js";
import { getConditionTransitions, selectForFloatTarget, selectLowestFloat } from "./selection.js";
import { TradeUpStore } from "./store.js";
import { evaluateTradeUp } from "./evaluation.js";
import { pick, shuffle, listingSig, computeChanceToProfit, computeBestWorstCase } from "./utils.js";

export type DiscoveryProgressCallback = (msg: string, current: number, total: number) => void;

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
export async function findProfitableTradeUps(
  pool: pg.Pool,
  options: {
    maxInputCost?: number;
    maxTotalCost?: number;
    minProfit?: number;
    minRoi?: number;
    rarities?: string[];
    limit?: number;
    maxPerSignature?: number;
    stattrak?: boolean;
    onProgress?: DiscoveryProgressCallback;
    onFlush?: (tradeUps: TradeUp[], isFirst: boolean) => void;
    existingSignatures?: Set<string>;
    deadlineMs?: number;
  } = {}
): Promise<TradeUp[]> {
  const targetRarities = options.rarities ?? ["Classified"];
  const stattrak = options.stattrak ?? false;
  const limit = options.limit ?? 200000;
  const store = new TradeUpStore(options.maxPerSignature ?? 50, options.existingSignatures);
  let isFirstFlush = true;

  options.onProgress?.("Building price cache...", 0, 100);
  await buildPriceCache(pool);

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

  /** Compute listing-combo signature. Used to skip evaluation for known combos. */
  const sigOf = (inputs: { id: string }[]) => listingSig(inputs.map(i => i.id));

  /** Evaluate only if this listing combo is new (not in existing signatures). */
  const tryEval = async (inputs: ListingWithCollection[], outcomes: DbSkinOutcome[]) => {
    if (store.hasSig(sigOf(inputs))) return;
    tryAdd(await evaluateTradeUp(pool, inputs, outcomes));
  };

  const pastDeadline = () => options.deadlineMs !== undefined && Date.now() >= options.deadlineMs;

  for (const inputRarity of targetRarities) {
    if (pastDeadline()) break;
    const outputRarity = getNextRarity(inputRarity);
    if (!outputRarity) continue;

    options.onProgress?.(`Loading ${inputRarity}...`, 0, 100);

    const { allListings, allAdjusted, byCollection, byColAdj } = await loadDiscoveryData(
      pool, inputRarity, "collection_id",
      { maxInputCost: options.maxInputCost, stattrak }
    );
    if (allListings.length === 0) continue;

    const allCollectionIds = [...byCollection.keys()].filter(id => !EXCLUDED_COLLECTIONS.has(id));
    const allOutcomes = await getOutcomesForCollections(pool, allCollectionIds, outputRarity, stattrak);
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
        await tryEval(colListings.slice(offset, offset + 10), outcomes);
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
        await tryEval(valueSorted.slice(offset, offset + 10), outcomes);
      }

      // Float-targeted: for each transition point, select optimal listings
      const quotas = new Map([[colId, 10]]);
      for (const target of transitions) {
        const selected = selectForFloatTarget(byColAdj, quotas, target);
        if (selected) {
          await tryEval(selected, outcomes);
        }
      }

      // Lowest-float selection (best possible output condition)
      const lowestFloat = selectLowestFloat(byColAdj, quotas);
      if (lowestFloat) {
        await tryEval(lowestFloat, outcomes);
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
            await tryEval(condListings.slice(off, off + 10), outcomes);
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
            await tryEval(pooled.slice(offset, offset + 10), outcomes);
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
      if (pastDeadline()) break;
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
          await tryEval([
            ...listingsA.slice(0, countA),
            ...listingsB.slice(0, countB),
          ], outcomes);

          // Baseline: offset combos
          if (listingsA.length >= countA + 5 && listingsB.length >= countB + 5) {
            await tryEval([
              ...listingsA.slice(5, 5 + countA),
              ...listingsB.slice(5, 5 + countB),
            ], outcomes);
          }
          if (listingsA.length >= countA + 10 && listingsB.length >= countB + 10) {
            await tryEval([
              ...listingsA.slice(10, 10 + countA),
              ...listingsB.slice(10, 10 + countB),
            ], outcomes);
          }

          // Mixed: cheap A + offset B, and vice versa
          if (listingsB.length >= countB + 10) {
            await tryEval([
              ...listingsA.slice(0, countA),
              ...listingsB.slice(10, 10 + countB),
            ], outcomes);
          }
          if (listingsA.length >= countA + 10) {
            await tryEval([
              ...listingsA.slice(10, 10 + countA),
              ...listingsB.slice(0, countB),
            ], outcomes);
          }

          // Float-targeted: for each transition, find cheapest listings within budget
          const quotas = new Map([[colA, countA], [colB, countB]]);
          for (const target of transitions) {
            const selected = selectForFloatTarget(byColAdj, quotas, target);
            if (selected) {
              await tryEval(selected, outcomes);
            }
          }

          // Lowest-float selection
          const lowestFloat = selectLowestFloat(byColAdj, quotas);
          if (lowestFloat) {
            await tryEval(lowestFloat, outcomes);
          }

          // Condition-targeted pairs: cheapest N at each condition
          for (const cond of CONDITION_BOUNDS.map(c => c.name)) {
            const condA = listingsA.filter(l => floatToCondition(l.float_value) === cond);
            const condB = listingsB.filter(l => floatToCondition(l.float_value) === cond);
            if (condA.length >= countA && condB.length >= countB) {
              await tryEval([
                ...condA.slice(0, countA),
                ...condB.slice(0, countB),
              ], outcomes);
            }
          }

          // Cross-condition mixing: FN from A + FT from B, MW from A + WW from B, etc.
          // Different condition combos produce different output floats — finds sweet spots
          // that pure-condition pairs miss. Only try adjacent pairs to limit combo explosion.
          const condPairs: [string, string][] = [
            ["Factory New", "Field-Tested"],
            ["Factory New", "Minimal Wear"],
            ["Minimal Wear", "Field-Tested"],
            ["Field-Tested", "Well-Worn"],
          ];
          for (const [condA, condB] of condPairs) {
            const poolA = listingsA.filter(l => floatToCondition(l.float_value) === condA);
            const poolB = listingsB.filter(l => floatToCondition(l.float_value) === condB);
            if (poolA.length >= countA && poolB.length >= countB) {
              await tryEval([...poolA.slice(0, countA), ...poolB.slice(0, countB)], outcomes);
            }
            // Also try reversed (B cond from A, A cond from B)
            const poolAr = listingsA.filter(l => floatToCondition(l.float_value) === condB);
            const poolBr = listingsB.filter(l => floatToCondition(l.float_value) === condA);
            if (poolAr.length >= countA && poolBr.length >= countB) {
              await tryEval([...poolAr.slice(0, countA), ...poolBr.slice(0, countB)], outcomes);
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
    if (pastDeadline()) {
      options.onProgress?.(`${inputRarity}: stopped at deadline (${store.total} trade-ups)`, 90, 100);
      if (options.onFlush) {
        options.onFlush(store.getAll(limit), isFirstFlush);
        isFirstFlush = false;
      }
      continue;
    }
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
          await tryEval(inputs, outcomesForCols(...usedCols));
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
export async function randomExplore(
  pool: pg.Pool,
  options: {
    iterations?: number;
    stattrak?: boolean;
    inputRarity?: string;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<{ found: number; explored: number; improved: number }> {
  const iterations = options.iterations ?? 300;
  const stattrak = options.stattrak ?? false;
  const inputRarity = options.inputRarity ?? "Classified";
  const outputRarity = getNextRarity(inputRarity);
  if (!outputRarity) return { found: 0, explored: 0, improved: 0 };
  await buildPriceCache(pool);

  const { allListings, byCollection, byColAdj } = await loadDiscoveryData(
    pool, inputRarity, "collection_id", { stattrak }
  );
  if (allListings.length === 0) return { found: 0, explored: 0, improved: 0 };

  // Collections that have outputs at the next rarity (excluding non-tradeable collections)
  const allCollectionIds = [...byCollection.keys()].filter(id => !EXCLUDED_COLLECTIONS.has(id));
  const allOutcomes = await getOutcomesForCollections(pool, allCollectionIds, outputRarity, stattrak);
  const collectionsWithOutcomes = new Set(allOutcomes.map(o => o.collection_id));
  const eligibleCollections = [...collectionsWithOutcomes].filter(id => (byCollection.get(id)?.length ?? 0) >= 1);

  if (eligibleCollections.length === 0) return { found: 0, explored: 0, improved: 0 };

  // Derive trade-up type from rarity pair
  const typeMap: Record<string, string> = {
    "Classified": "classified_covert",
    "Restricted": "restricted_classified",
    "Mil-Spec": "milspec_restricted",
    "Industrial Grade": "industrial_milspec",
    "Consumer Grade": "consumer_industrial",
  };
  const tradeUpType = stattrak ? `${typeMap[inputRarity] ?? "classified_covert"}_st` : (typeMap[inputRarity] ?? "classified_covert");

  // Profit-guided: weight toward collections in recent profitable trade-ups
  const weightedPool = await buildWeightedPool(pool, eligibleCollections, tradeUpType);

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

  // Load existing signatures
  const existingSignatures = new Set<string>();
  const { rows: existingRows } = await pool.query(`
    SELECT trade_up_id, STRING_AGG(listing_id::text, ',') as ids
    FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = $1)
    GROUP BY trade_up_id
  `, [tradeUpType]);
  for (const row of existingRows) {
    existingSignatures.add(listingSig(row.ids.split(",")));
  }

  let found = 0;
  let explored = 0;
  let improved = 0;

  // Load existing profitable trade-ups for swap optimization
  const { rows: existingTradeUps } = await pool.query<{ id: number; profit_cents: number; total_cost_cents: number }>(`
    SELECT id, profit_cents, total_cost_cents FROM trade_ups WHERE type = $1 AND profit_cents > 0
    ORDER BY profit_cents DESC LIMIT 200
  `, [tradeUpType]);

  // Build listing lookup for swap optimization
  const listingById = new Map<string, ListingWithCollection>();
  for (const l of allListings) listingById.set(l.id, l);

  for (let iter = 0; iter < iterations; iter++) {
    if (iter % 100 === 0) {
      options.onProgress?.(`${inputRarity} explore: ${iter}/${iterations} (${found} new, ${improved} improved)`);
    }

    try {
      const strategy = Math.floor(Math.random() * 8);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          // Random pair with random split + offset
          const colA = pick(weightedPool);
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
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 10) break;
          const maxOff = Math.min(list.length - 10, 30);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 10);
          break;
        }

        case 2: {
          // Condition-pure from random collection
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          const conditions = CONDITION_BOUNDS.map(c => c.name);
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 10) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 10 + 1, 10));
          inputs = condListings.slice(off, off + 10);
          break;
        }

        case 3: {
          // Triple collection pool
          const cols = [pick(weightedPool)];
          while (cols.length < 3) {
            const c = pick(weightedPool);
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
          const colA = pick(weightedPool);
          const colB = pick(eligibleCollections.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          const target = Math.random() * 0.5;
          const quotas = new Map([[colA, countA], [colB, countB]]);
          const selected = selectForFloatTarget(byColAdj, quotas, target);
          if (selected && selected.length === 10) inputs = selected;
          break;
        }

        case 6: {
          // Swap optimization — take an existing profitable trade-up and try improving one slot
          if (existingTradeUps.length === 0) break;
          const existing = pick(existingTradeUps);
          const { rows: existInputs } = await pool.query("SELECT * FROM trade_up_inputs WHERE trade_up_id = $1", [existing.id]);
          if (existInputs.length !== 10) break;

          const currentInputs = existInputs.map((i: { listing_id: string }) => listingById.get(i.listing_id)).filter(Boolean) as ListingWithCollection[];
          if (currentInputs.length !== 10) break;

          // Pick a random slot to swap
          const slot = Math.floor(Math.random() * 10);
          const original = currentInputs[slot];

          // Find alternatives from same collection (70%) or random profitable collection (30%)
          const candidateCol = Math.random() < 0.7
            ? original.collection_id
            : pick(weightedPool);
          const candidates = byCollection.get(candidateCol) ?? [];
          if (candidates.length === 0) break;

          const usedIds = new Set(currentInputs.map(l => l.id));
          const validCandidates = candidates.filter(c => !usedIds.has(c.id));
          if (validCandidates.length === 0) break;

          // Try up to 15 random candidates for this slot
          const toTry = shuffle(validCandidates).slice(0, 15);
          const usedCols = [...new Set(currentInputs.map(l => l.collection_id))];
          // If swapping to a different collection, include its outcomes too
          if (!usedCols.includes(candidateCol)) usedCols.push(candidateCol);
          const swapOutcomes = outcomesForCols(...usedCols);

          let bestSwapResult: TradeUp | null = null;
          for (const candidate of toTry) {
            const newInputs = [...currentInputs];
            newInputs[slot] = candidate;
            const result = await evaluateTradeUp(pool, newInputs, swapOutcomes);
            if (result && result.profit_cents > existing.profit_cents) {
              if (!bestSwapResult || result.profit_cents > bestSwapResult.profit_cents) {
                bestSwapResult = result;
              }
            }
          }

          if (bestSwapResult) {
            const swapChance = computeChanceToProfit(bestSwapResult.outcomes, bestSwapResult.total_cost_cents);
            const { bestCase: swapBest, worstCase: swapWorst } = computeBestWorstCase(bestSwapResult.outcomes, bestSwapResult.total_cost_cents);
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await client.query(`
                UPDATE trade_ups SET total_cost_cents = $1, expected_value_cents = $2, profit_cents = $3, roi_percentage = $4, chance_to_profit = $5, best_case_cents = $6, worst_case_cents = $7, outcomes_json = $8
                WHERE id = $9
              `, [
                bestSwapResult.total_cost_cents, bestSwapResult.expected_value_cents,
                bestSwapResult.profit_cents, bestSwapResult.roi_percentage, swapChance,
                swapBest, swapWorst, JSON.stringify(bestSwapResult.outcomes), existing.id
              ]);
              await client.query("DELETE FROM trade_up_inputs WHERE trade_up_id = $1", [existing.id]);
              for (const input of bestSwapResult.inputs) {
                await client.query(`
                  INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [existing.id, input.listing_id, input.skin_id, input.skin_name,
                  input.collection_name, input.price_cents, input.float_value, input.condition]);
              }
              await client.query('COMMIT');
            } catch (err) {
              await client.query('ROLLBACK');
              throw err;
            } finally {
              client.release();
            }
            improved++;
            existing.profit_cents = bestSwapResult.profit_cents;
          }
          explored++;
          continue; // Don't fall through to new trade-up insertion
        }

        case 7: {
          // Cross-condition random: mix FN/MW from one collection with FT/WW from another
          const colA = pick(weightedPool);
          const colB = pick(eligibleCollections.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const condPairs: [string, string][] = [
            ["Factory New", "Field-Tested"],
            ["Minimal Wear", "Field-Tested"],
            ["Factory New", "Minimal Wear"],
            ["Field-Tested", "Well-Worn"],
          ];
          const [condA, condB] = pick(condPairs);
          const poolA = listA.filter(l => floatToCondition(l.float_value) === condA);
          const poolB = listB.filter(l => floatToCondition(l.float_value) === condB);
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          if (poolA.length >= countA && poolB.length >= countB) {
            const offA = Math.floor(Math.random() * Math.min(poolA.length - countA + 1, 10));
            const offB = Math.floor(Math.random() * Math.min(poolB.length - countB + 1, 10));
            inputs = [...poolA.slice(offA, offA + countA), ...poolB.slice(offB, offB + countB)];
          }
          break;
        }
      }

      if (!inputs || inputs.length !== 10) continue;
      explored++;

      const sig = listingSig(inputs.map(i => i.id));
      if (existingSignatures.has(sig)) continue;

      const usedCols = [...new Set(inputs.map(l => l.collection_id))];
      const outcomes = outcomesForCols(...usedCols);
      const result = await evaluateTradeUp(pool, inputs, outcomes);
      if (!result) continue;
      // Keep profitable OR high chance-to-profit trade-ups
      if (result.profit_cents <= 0 && (result.chance_to_profit ?? 0) < 0.25) continue;

      existingSignatures.add(sig);
      const chanceToProfit = computeChanceToProfit(result.outcomes, result.total_cost_cents);
      const { bestCase, worstCase } = computeBestWorstCase(result.outcomes, result.total_cost_cents);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: infoRows } = await client.query(`
          INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, source, outcomes_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'explore', $9)
          RETURNING id
        `, [
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          tradeUpType, bestCase, worstCase, JSON.stringify(result.outcomes)
        ]);
        const tuId = infoRows[0].id;
        for (const input of result.inputs) {
          await client.query(`
            INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [tuId, input.listing_id, input.skin_id, input.skin_name,
            input.collection_name, input.price_cents, input.float_value, input.condition]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      found++;
    } catch (err) {
      // Ignore individual iteration errors
    }
  }

  return { found, explored, improved };
}

/**
 * Time-bounded random exploration for worker processes.
 * Read-only: returns TradeUp[] instead of writing to DB.
 * No swap optimization (requires writable DB).
 * Runs until deadlineMs timestamp.
 */
export async function exploreWithBudget(
  pool: pg.Pool,
  deadlineMs: number,
  existingSignatures: Set<string>,
  options: {
    inputRarity?: string;
    stattrak?: boolean;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<TradeUp[]> {
  const inputRarity = options.inputRarity ?? "Classified";
  const stattrak = options.stattrak ?? false;
  const outputRarity = getNextRarity(inputRarity);
  if (!outputRarity) return [];
  await buildPriceCache(pool);

  const { allListings, byCollection, byColAdj } = await loadDiscoveryData(
    pool, inputRarity, "collection_id", { stattrak }
  );
  if (allListings.length === 0) return [];

  const allCollectionIds = [...byCollection.keys()].filter(id => !EXCLUDED_COLLECTIONS.has(id));
  const allOutcomes = await getOutcomesForCollections(pool, allCollectionIds, outputRarity, stattrak);
  const collectionsWithOutcomes = new Set(allOutcomes.map(o => o.collection_id));
  const eligibleCollections = [...collectionsWithOutcomes].filter(id => (byCollection.get(id)?.length ?? 0) >= 1);
  if (eligibleCollections.length === 0) return [];

  const typeMap: Record<string, string> = {
    "Classified": "classified_covert",
    "Restricted": "restricted_classified",
    "Mil-Spec": "milspec_restricted",
    "Industrial Grade": "industrial_milspec",
    "Consumer Grade": "consumer_industrial",
  };
  const tradeUpType = stattrak ? `${typeMap[inputRarity] ?? "classified_covert"}_st` : (typeMap[inputRarity] ?? "classified_covert");

  const weightedPool = await buildWeightedPool(pool, eligibleCollections, tradeUpType);

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

  const results: TradeUp[] = [];
  let explored = 0;

  while (Date.now() < deadlineMs - 1000) {
    explored++;
    if (explored % 1000 === 0) {
      const remaining = Math.round((deadlineMs - Date.now()) / 1000);
      options.onProgress?.(`${inputRarity} explore: ${explored} iters, ${results.length} found (${remaining}s left)`);
    }

    try {
      const strategy = Math.floor(Math.random() * 7);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          const colA = pick(weightedPool);
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
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 10) break;
          const maxOff = Math.min(list.length - 10, 30);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 10);
          break;
        }

        case 2: {
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          const conditions = CONDITION_BOUNDS.map(c => c.name);
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 10) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 10 + 1, 10));
          inputs = condListings.slice(off, off + 10);
          break;
        }

        case 3: {
          const cols = [pick(weightedPool)];
          while (cols.length < 3) {
            const c = pick(weightedPool);
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
          const eligible = allListings.filter(l => collectionsWithOutcomes.has(l.collection_id));
          const sorted = [...eligible].sort((a, b) => a.price_cents - b.price_cents);
          const maxOff = Math.min(sorted.length - 10, 100);
          if (maxOff < 0) break;
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = sorted.slice(off, off + 10);
          break;
        }

        case 5: {
          const colA = pick(weightedPool);
          const colB = pick(eligibleCollections.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          const target = Math.random() * 0.5;
          const quotas = new Map([[colA, countA], [colB, countB]]);
          const selected = selectForFloatTarget(byColAdj, quotas, target);
          if (selected && selected.length === 10) inputs = selected;
          break;
        }

        case 6: {
          const colA = pick(weightedPool);
          const colB = pick(eligibleCollections.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const condPairs: [string, string][] = [
            ["Factory New", "Field-Tested"],
            ["Minimal Wear", "Field-Tested"],
            ["Factory New", "Minimal Wear"],
            ["Field-Tested", "Well-Worn"],
          ];
          const [condA, condB] = pick(condPairs);
          const poolA = listA.filter(l => floatToCondition(l.float_value) === condA);
          const poolB = listB.filter(l => floatToCondition(l.float_value) === condB);
          const countA = 1 + Math.floor(Math.random() * 9);
          const countB = 10 - countA;
          if (poolA.length >= countA && poolB.length >= countB) {
            const offA = Math.floor(Math.random() * Math.min(poolA.length - countA + 1, 10));
            const offB = Math.floor(Math.random() * Math.min(poolB.length - countB + 1, 10));
            inputs = [...poolA.slice(offA, offA + countA), ...poolB.slice(offB, offB + countB)];
          }
          break;
        }
      }

      if (!inputs || inputs.length !== 10) continue;

      const sig = listingSig(inputs.map(i => i.id));
      if (existingSignatures.has(sig)) continue;

      const usedCols = [...new Set(inputs.map(l => l.collection_id))];
      const outcomes = outcomesForCols(...usedCols);
      const result = await evaluateTradeUp(pool, inputs, outcomes);
      if (!result) continue;
      if (result.profit_cents <= 0 && (result.chance_to_profit ?? 0) < 0.25) continue;

      existingSignatures.add(sig);
      results.push(result);
    } catch {
      // Ignore individual iteration errors
    }
  }

  options.onProgress?.(`${inputRarity} explore done: ${explored} iters, ${results.length} found`);
  return results;
}
