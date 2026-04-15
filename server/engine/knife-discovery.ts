import pg from "pg";
import { floatToCondition, type TradeUp, type TradeUpInput } from "../../shared/types.js";
import type { ListingWithCollection, AdjustedListing } from "./types.js";
import { CONDITION_BOUNDS } from "./types.js";
import { CASE_KNIFE_MAP, KNIFE_WEAPONS } from "./knife-data.js";
import { buildPriceCache, priceCache as globalPriceCache } from "./pricing.js";
import { loadDiscoveryData, buildWeightedPool } from "./data-load.js";
import { selectForFloatTarget, selectLowestFloat } from "./selection.js";
import { evaluateKnifeTradeUp, buildKnifeFinishCache } from "./knife-evaluation.js";
import { pick, shuffle, listingSig, computeChanceToProfit, computeBestWorstCase, pickWeightedStrategy } from "./utils.js";
import { comboCurveScore, shouldUseValueRatio, type ComboOutcome } from "./curve-classification.js";

/**
 * Discover profitable knife trade-ups.
 *
 * For each collection with a case-knife mapping:
 * 1. Get cheapest Covert gun listings from that collection
 * 2. Try various 5-input combos (cheapest, float-targeted, etc.)
 * 3. For multi-collection combos: try mixing inputs from compatible cases
 *
 * Also tries cross-collection combos where different cases contribute
 * different input proportions.
 */
export async function findProfitableKnifeTradeUps(
  pool: pg.Pool,
  options: {
    onProgress?: (msg: string) => void;
    extraTransitionPoints?: number[];
    existingSignatures?: Set<string>;
    deadlineMs?: number;
  } = {}
): Promise<TradeUp[]> {
  options.onProgress?.("Building price cache for knife trade-ups...");
  await buildPriceCache(pool);

  // Get all Covert gun listings (knife trade-up inputs)
  const { allListings, byCollection, byColAdj, byColValue } = await loadDiscoveryData(
    pool, "Covert", "collection_name", { excludeWeapons: KNIFE_WEAPONS }
  );

  if (allListings.length === 0) {
    options.onProgress?.("No Covert gun listings found");
    return [];
  }

  // Build knife + glove finish price cache
  const knifeFinishCache = await buildKnifeFinishCache(pool);

  const knifeCount = [...knifeFinishCache.entries()].filter(([k]) => k.includes("Knife") || k === "Bayonet" || k === "Karambit").length;
  const gloveCount = knifeFinishCache.size - knifeCount;
  console.log(`  Item data: ${allListings.length} Covert gun listings, ${knifeCount} knife types + ${gloveCount} glove types with prices`);
  for (const [itemType, finishes] of knifeFinishCache) {
    const avgPrice = finishes.reduce((s, f) => s + f.avgPrice, 0) / finishes.length;
    console.log(`    ${itemType}: ${finishes.length} finishes, avg $${(avgPrice / 100).toFixed(2)}`);
  }

  const results: TradeUp[] = [];
  const seen = options.existingSignatures ?? new Set<string>();
  let skippedExisting = 0;

  const tryAdd = (tu: TradeUp | null) => {
    if (!tu || tu.expected_value_cents === 0) return;
    // Keep profitable OR high chance-to-profit trade-ups
    if (tu.profit_cents <= 0 && (tu.chance_to_profit ?? 0) < 0.25) return;
    const key = listingSig(tu.inputs.map(i => i.listing_id));
    if (seen.has(key)) {
      skippedExisting++;
      return;
    }
    seen.add(key);
    results.push(tu);
  };

  /** Compute listing-combo signature for pre-evaluation sig-skipping. */
  const sigOf = (inputs: { id: string }[]) => listingSig(inputs.map(i => i.id));

  /** Evaluate only if this listing combo is new (skip evaluation for known combos). */
  const tryEvalKnife = async (inputs: ListingWithCollection[]) => {
    const sig = sigOf(inputs);
    if (seen.has(sig)) { skippedExisting++; return; }
    tryAdd(await evaluateKnifeTradeUp(pool, inputs, knifeFinishCache));
  };

  // Collections that have knife or glove mappings
  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });
  console.log(`  ${knifeCollections.length} collections with knife/glove mappings`);

  // Dense float targets — condition boundaries are where profit lives.
  // FT at 0.16 is worth way more than FT at 0.37. 30 points catches the sweet spots.
  const baseTransitions: number[] = [];
  for (let t = 0.001; t <= 0.50; t = Math.round((t + 0.015) * 1000) / 1000) {
    baseTransitions.push(t);
  }
  // Extra density near condition boundaries (FN/MW=0.07, MW/FT=0.15, FT/WW=0.38, WW/BS=0.45)
  for (const boundary of [0.07, 0.15, 0.38, 0.45]) {
    for (const offset of [-0.01, -0.005, 0.005, 0.01]) {
      const pt = Math.round((boundary + offset) * 1000) / 1000;
      if (pt > 0 && pt < 1) baseTransitions.push(pt);
    }
  }
  const knifeTransitionPoints = [...new Set(baseTransitions)].sort((a, b) => a - b);

  // Knife selection helpers use the parameterized versions from selection.ts with count=5
  const selectForKnifeFloat = (quotas: Map<string, number>, maxAvgAdjusted: number) =>
    selectForFloatTarget(byColAdj, quotas, maxAvgAdjusted, 5);
  const selectLowestKnifeFloat = (quotas: Map<string, number>) =>
    selectLowestFloat(byColAdj, quotas, 5);

  const pastDeadline = () => options.deadlineMs !== undefined && Date.now() >= options.deadlineMs;

  // Step 1: Single-collection knife trade-ups
  options.onProgress?.("Knife: single-collection combos...");
  for (const colName of knifeCollections) {
    if (pastDeadline()) break;
    const listings = byCollection.get(colName)!;
    if (listings.length < 5) continue;

    // Sliding windows (cheapest) — cap at 15
    for (let offset = 0; offset + 5 <= listings.length && offset < 15; offset++) {
      await tryEvalKnife(listings.slice(offset, offset + 5));
    }

    // Value-sorted: sort by lowest adjusted float (best output condition), then cheapest.
    // More expensive low-float listings may produce higher-condition outputs worth much more.
    const valueSorted = [...listings].sort(
      (a, b) => {
        const adjA = (a.max_float - a.min_float) > 0 ? (a.float_value - a.min_float) / (a.max_float - a.min_float) : 0;
        const adjB = (b.max_float - b.min_float) > 0 ? (b.float_value - b.min_float) / (b.max_float - b.min_float) : 0;
        return adjA - adjB || a.price_cents - b.price_cents;
      }
    );
    for (let offset = 0; offset + 5 <= valueSorted.length && offset < 15; offset += 5) {
      await tryEvalKnife(valueSorted.slice(offset, offset + 5));
    }

    // Float-targeted: for each transition point
    const quotas = new Map([[colName, 5]]);
    for (const target of knifeTransitionPoints) {
      const selected = selectForKnifeFloat(quotas, target);
      if (selected) await tryEvalKnife(selected);
    }

    // Lowest-float selection
    const lowestFloat = selectLowestKnifeFloat(quotas);
    if (lowestFloat) await tryEvalKnife(lowestFloat);

    // Condition-pure groups — deeper windows to find combos systematic cheapest misses.
    // Random explore proved $100 trade-ups hide in non-cheapest condition groups.
    const byCondition = new Map<string, ListingWithCollection[]>();
    for (const l of listings) {
      const cond = floatToCondition(l.float_value);
      const list = byCondition.get(cond) ?? [];
      list.push(l);
      byCondition.set(cond, list);
    }
    // For conditions where float matters (FN, expensive MW/FT), only try lowest-float window.
    // For others (WW, BS, cheap skins), try all 3 windows.
    for (const [cond, condListings] of byCondition) {
      const floatMatters = cond === "Factory New" || cond === "Minimal Wear";
      const maxWindows = floatMatters ? 1 : 3;
      for (let window = 0; window < maxWindows; window++) {
        const off = window * 5;
        if (condListings.length >= off + 5) {
          await tryEvalKnife(condListings.slice(off, off + 5));
        }
      }
    }

    // Per-skin combos — different skins have different float ranges, producing different outputs.
    // "All Dragonfire FN" (range 0-0.6) produces different output float than "All Buzz Kill" (0-0.5).
    const bySkin = new Map<string, ListingWithCollection[]>();
    for (const l of listings) {
      const list = bySkin.get(l.skin_id) ?? [];
      list.push(l);
      bySkin.set(l.skin_id, list);
    }
    // Try each skin individually (if enough listings)
    for (const [, skinListings] of bySkin) {
      if (skinListings.length >= 5) {
        await tryEvalKnife(skinListings.slice(0, 5));
        // Also try per-condition within the skin
        const skinByCondition = new Map<string, ListingWithCollection[]>();
        for (const l of skinListings) {
          const cond = floatToCondition(l.float_value);
          const list = skinByCondition.get(cond) ?? [];
          list.push(l);
          skinByCondition.set(cond, list);
        }
        for (const [, condSkinListings] of skinByCondition) {
          if (condSkinListings.length >= 5) {
            await tryEvalKnife(condSkinListings.slice(0, 5));
          }
        }
      }
    }
    // Multi-skin pooling
    const skinGroups = [...bySkin.values()];
    if (skinGroups.length >= 2) {
      const pooled = skinGroups.flatMap(g => g.slice(0, 3)).sort((a, b) => a.price_cents - b.price_cents);
      if (pooled.length >= 5) {
        for (let off = 0; off + 5 <= pooled.length && off < 15; off += 3) {
          await tryEvalKnife(pooled.slice(off, off + 5));
        }
      }
    }
  }

  options.onProgress?.(`Knife: singles done (${results.length} trade-ups)`);

  // Step 2: Two-collection knife trade-ups
  options.onProgress?.("Knife: two-collection combos...");
  for (let i = 0; i < knifeCollections.length; i++) {
    if (pastDeadline()) break;
    for (let j = i + 1; j < knifeCollections.length; j++) {
      if (pastDeadline()) break;
      const colA = knifeCollections[i];
      const colB = knifeCollections[j];
      const listingsA = byCollection.get(colA)!;
      const listingsB = byCollection.get(colB)!;

      // All splits: 1/4, 2/3, 3/2, 4/1
      for (const countA of [1, 2, 3, 4]) {
        const countB = 5 - countA;
        if (listingsA.length < countA || listingsB.length < countB) continue;

        // Baseline: cheapest combo
        await tryEvalKnife([
          ...listingsA.slice(0, countA),
          ...listingsB.slice(0, countB),
        ]);

        // Offset combos
        if (listingsA.length >= countA + 5 && listingsB.length >= countB + 5) {
          await tryEvalKnife([
            ...listingsA.slice(5, 5 + countA),
            ...listingsB.slice(5, 5 + countB),
          ]);
        }

        // Mixed: cheap A + offset B
        if (listingsB.length >= countB + 5) {
          await tryEvalKnife([
            ...listingsA.slice(0, countA),
            ...listingsB.slice(5, 5 + countB),
          ]);
        }
        if (listingsA.length >= countA + 5) {
          await tryEvalKnife([
            ...listingsA.slice(5, 5 + countA),
            ...listingsB.slice(0, countB),
          ]);
        }

        // Float-targeted
        const quotas = new Map([[colA, countA], [colB, countB]]);
        for (const target of knifeTransitionPoints) {
          const selected = selectForKnifeFloat(quotas, target);
          if (selected) await tryEvalKnife(selected);
        }

        // Lowest-float
        const lowestFloat = selectLowestKnifeFloat(quotas);
        if (lowestFloat) await tryEvalKnife(lowestFloat);

        // Condition-targeted pairs: cheapest N at each condition
        for (const cond of CONDITION_BOUNDS.map(c => c.name)) {
          const condA = listingsA.filter(l => floatToCondition(l.float_value) === cond);
          const condB = listingsB.filter(l => floatToCondition(l.float_value) === cond);
          if (condA.length >= countA && condB.length >= countB) {
            await tryEvalKnife([
              ...condA.slice(0, countA),
              ...condB.slice(0, countB),
            ]);
          }
        }

        // Cross-condition mixing: FN from A + FT from B, etc.
        const condPairs: [string, string][] = [
          ["Factory New", "Field-Tested"],
          ["Factory New", "Minimal Wear"],
          ["Minimal Wear", "Field-Tested"],
        ];
        for (const [c1, c2] of condPairs) {
          const poolA = listingsA.filter(l => floatToCondition(l.float_value) === c1);
          const poolB = listingsB.filter(l => floatToCondition(l.float_value) === c2);
          if (poolA.length >= countA && poolB.length >= countB) {
            await tryEvalKnife([...poolA.slice(0, countA), ...poolB.slice(0, countB)]);
          }
          const poolAr = listingsA.filter(l => floatToCondition(l.float_value) === c2);
          const poolBr = listingsB.filter(l => floatToCondition(l.float_value) === c1);
          if (poolAr.length >= countA && poolBr.length >= countB) {
            await tryEvalKnife([...poolAr.slice(0, countA), ...poolBr.slice(0, countB)]);
          }
        }
      }
    }
  }

  options.onProgress?.(`Knife: pairs done (${results.length} trade-ups)`);

  if (skippedExisting > 0) {
    console.log(`  Knife discovery: skipped ${skippedExisting} combos already in DB`);
  }

  // Sort by profit
  results.sort((a, b) => b.profit_cents - a.profit_cents);
  return results;
}

/**
 * Randomized knife trade-up exploration for continuous optimization.
 * Each call explores different random collection combos, float targets,
 * and listing offsets to discover profitable knife trade-ups not found
 * by the deterministic search.
 */
export async function randomKnifeExplore(
  pool: pg.Pool,
  options: {
    iterations?: number;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<{ found: number; explored: number; improved: number }> {
  const iterations = options.iterations ?? 500;
  await buildPriceCache(pool);

  const { allListings, byCollection, byColAdj, byColValue } = await loadDiscoveryData(
    pool, "Covert", "collection_name", { excludeWeapons: KNIFE_WEAPONS }
  );
  if (allListings.length === 0) return { found: 0, explored: 0, improved: 0 };

  // Build knife finish cache
  const knifeFinishCache = await buildKnifeFinishCache(pool);

  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });
  if (knifeCollections.length === 0) return { found: 0, explored: 0, improved: 0 };

  // Profit-guided weighted pool
  const weightedPool = await buildWeightedPool(pool, knifeCollections, "covert_knife", byCollection);

  // Load existing trade-up signatures to avoid duplicates
  const existingSignatures = new Set<string>();
  const { rows: existingRows } = await pool.query(`
    SELECT trade_up_id, STRING_AGG(listing_id::text, ',') as ids
    FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = 'covert_knife')
    GROUP BY trade_up_id
  `);
  for (const row of existingRows) {
    existingSignatures.add(listingSig(row.ids.split(",")));
  }

  let found = 0;
  let explored = 0;
  let improved = 0;

  // Also load existing trade-ups for improvement attempts
  const { rows: existingTradeUps } = await pool.query<{ id: number; profit_cents: number; total_cost_cents: number }>(`
    SELECT id, profit_cents, total_cost_cents FROM trade_ups WHERE type = 'covert_knife' AND profit_cents > 0
    ORDER BY profit_cents DESC LIMIT 200
  `);

  // Float-biased strategies: float-targeted (2), ultra-low-float (8), output-aware (9) get 2x
  const RKNIFE_FLOAT_BIASED = [2, 8, 9];
  const RKNIFE_TOTAL_STRATEGIES = 10;

  for (let iter = 0; iter < iterations; iter++) {
    if (iter % 100 === 0) {
      options.onProgress?.(`Knife explore: ${iter}/${iterations} (${found} new, ${improved} improved)`);
    }

    try {
      const strategy = pickWeightedStrategy(RKNIFE_TOTAL_STRATEGIES, RKNIFE_FLOAT_BIASED);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
          if (listA.length < countA || listB.length < countB) break;
          const maxOffA = Math.min(listA.length - countA, 200);
          const maxOffB = Math.min(listB.length - countB, 200);
          const offA = Math.floor(Math.random() * (maxOffA + 1));
          const offB = Math.floor(Math.random() * (maxOffB + 1));
          inputs = [...listA.slice(offA, offA + countA), ...listB.slice(offB, offB + countB)];
          break;
        }

        case 1: {
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          const maxOff = Math.min(list.length - 5, 300);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 5);
          break;
        }

        case 2: {
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
          const target = Math.random() * 0.5;
          const quotas = new Map([[colA, countA], [colB, countB]]);
          const totalBudget = 5 * target;
          const candidates: AdjustedListing[] = [];
          for (const [col, quota] of quotas) {
            const colPool = byColAdj.get(col);
            if (!colPool || colPool.length < quota) { inputs = null; break; }
            for (const l of colPool) { if (l.adjustedFloat <= totalBudget) candidates.push(l); }
          }
          if (!candidates.length) break;
          candidates.sort((a, b) => a.price_cents - b.price_cents);
          const picked = new Map<string, number>();
          const result: AdjustedListing[] = [];
          let usedFloat = 0;
          const usedIds = new Set<string>();
          for (const l of candidates) {
            if (result.length >= 5) break;
            const colPicked = picked.get(l.collection_name) ?? 0;
            const colQuota = quotas.get(l.collection_name) ?? 0;
            if (colPicked >= colQuota) continue;
            if (usedIds.has(l.id)) continue;
            if (usedFloat + l.adjustedFloat <= totalBudget) {
              result.push(l);
              usedFloat += l.adjustedFloat;
              picked.set(l.collection_name, colPicked + 1);
              usedIds.add(l.id);
            }
          }
          if (result.length === 5) inputs = result;
          break;
        }

        case 3: {
          const cols = shuffle(knifeCollections).slice(0, 3);
          if (cols.length < 3) break;
          const pooled = cols
            .flatMap(c => {
              const list = byCollection.get(c) ?? [];
              const off = Math.floor(Math.random() * Math.min(list.length, 10));
              return list.slice(off, off + 8);
            })
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 5) break;
          inputs = pooled.slice(0, 5);
          break;
        }

        case 4: {
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          const conditions = CONDITION_BOUNDS.map(c => c.name);
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 5) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 5 + 1, 100));
          inputs = condListings.slice(off, off + 5);
          break;
        }

        case 5: {
          const knifeOnly = allListings.filter(l => CASE_KNIFE_MAP[l.collection_name]);
          const sorted = [...knifeOnly].sort((a, b) => a.price_cents - b.price_cents);
          const maxOff = Math.min(sorted.length - 5, 300);
          if (maxOff < 0) break;
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = sorted.slice(off, off + 5);
          break;
        }

        case 7: {
          const singleKnifeCollections = knifeCollections.filter(cn => {
            const ci = CASE_KNIFE_MAP[cn];
            return ci && ci.knifeTypes.length === 1 && ci.knifeFinishes.length > 0;
          });
          const gloveCollections = knifeCollections.filter(cn => {
            const ci = CASE_KNIFE_MAP[cn];
            return ci && ci.gloveGen !== null;
          });
          if (singleKnifeCollections.length === 0 || gloveCollections.length === 0) break;

          const knCol = pick(singleKnifeCollections);
          const glCol = pick(gloveCollections);
          const knList = byCollection.get(knCol) ?? [];
          const glList = byCollection.get(glCol) ?? [];

          for (const [kn, gl] of [[1, 4], [2, 3], [3, 2]]) {
            if (knList.length < kn || glList.length < gl) continue;
            const knOff = Math.floor(Math.random() * Math.min(knList.length - kn + 1, 10));
            const glOff = Math.floor(Math.random() * Math.min(glList.length - gl + 1, 10));
            const candidate = [...knList.slice(knOff, knOff + kn), ...glList.slice(glOff, glOff + gl)];
            if (candidate.length === 5) {
              inputs = candidate;
              break;
            }
          }
          break;
        }

        case 6: {
          // Swap optimization — take an existing profitable trade-up and try improving one slot
          if (existingTradeUps.length === 0) break;
          const existing = pick(existingTradeUps);
          const { rows: existInputs } = await pool.query("SELECT * FROM trade_up_inputs WHERE trade_up_id = $1", [existing.id]);
          if (existInputs.length !== 5) break;

          // Find the listings for this trade-up
          const listingById = new Map<string, ListingWithCollection>();
          for (const l of allListings) listingById.set(l.id, l);

          const currentInputs = existInputs.map((i: TradeUpInput) => listingById.get(i.listing_id)).filter(Boolean) as ListingWithCollection[];
          if (currentInputs.length !== 5) break;

          // Pick a random slot to swap
          const slot = Math.floor(Math.random() * 5);
          const original = currentInputs[slot];

          // Find a random alternative from same or different collection
          const candidateCol = Math.random() < 0.7
            ? original.collection_name
            : pick(weightedPool);
          const candidates = byCollection.get(candidateCol) ?? [];
          if (candidates.length === 0) break;

          const usedIds = new Set(currentInputs.map(l => l.id));
          const validCandidates = candidates.filter(c => !usedIds.has(c.id));
          if (validCandidates.length === 0) break;

          // Try a few random candidates
          const toTry = shuffle(validCandidates).slice(0, 10);
          let bestResult: TradeUp | null = null;
          for (const candidate of toTry) {
            const newInputs = [...currentInputs];
            newInputs[slot] = candidate;
            const result = await evaluateKnifeTradeUp(pool, newInputs, knifeFinishCache);
            if (result && result.profit_cents > existing.profit_cents) {
              if (!bestResult || result.profit_cents > bestResult.profit_cents) {
                bestResult = result;
              }
            }
          }

          if (bestResult) {
            const chanceToProfit = computeChanceToProfit(bestResult.outcomes, bestResult.total_cost_cents);
            const { bestCase: bestCaseSwap, worstCase: worstCaseSwap } = computeBestWorstCase(bestResult.outcomes, bestResult.total_cost_cents);
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await client.query(`
                UPDATE trade_ups SET total_cost_cents = $1, expected_value_cents = $2, profit_cents = $3, roi_percentage = $4, chance_to_profit = $5, best_case_cents = $6, worst_case_cents = $7, outcomes_json = $8
                WHERE id = $9
              `, [
                bestResult.total_cost_cents, bestResult.expected_value_cents,
                bestResult.profit_cents, bestResult.roi_percentage, chanceToProfit,
                bestCaseSwap, worstCaseSwap, JSON.stringify(bestResult.outcomes), existing.id
              ]);
              await client.query("DELETE FROM trade_up_inputs WHERE trade_up_id = $1", [existing.id]);
              for (const input of bestResult.inputs) {
                await client.query(`
                  INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [existing.id, input.listing_id, input.skin_id, input.skin_name,
                  input.collection_name, input.price_cents, input.float_value, input.condition, input.source ?? "csfloat"]);
              }
              // Recompute input_sources after replacing inputs
              await client.query(`
                UPDATE trade_ups SET input_sources = COALESCE((
                  SELECT ARRAY_AGG(DISTINCT source ORDER BY source) FROM trade_up_inputs WHERE trade_up_id = $1
                ), '{}') WHERE id = $1
              `, [existing.id]);
              await client.query('COMMIT');
            } catch (err) {
              await client.query('ROLLBACK');
              throw err;
            } finally {
              client.release();
            }
            improved++;
            // Update the cached profit for future improvement attempts
            existing.profit_cents = bestResult.profit_cents;
          }
          explored++;
          continue; // Don't fall through to the new trade-up insertion below
        }

        case 8: {
          // Ultra-low-float pool: pick lowest-float listings, fill rest with cheapest.
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          const floatSorted = [...list].sort((a, b) => a.float_value - b.float_value);
          const lowFloatCount = 1 + Math.floor(Math.random() * 2);
          const lowFloats = floatSorted.slice(0, lowFloatCount);
          const lowFloatIds = new Set(lowFloats.map(l => l.id));
          const remaining = list.filter(l => !lowFloatIds.has(l.id));
          if (remaining.length < 5 - lowFloatCount) break;
          inputs = [...lowFloats, ...remaining.slice(0, 5 - lowFloatCount)];
          break;
        }

        case 9: {
          // Output-value-aware: target very low adjusted floats for premium knife output.
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          const targetAdjFloat = Math.random() * 0.15;
          const quotas = new Map([[col, 5]]);
          const selected = selectForFloatTarget(byColAdj, quotas, targetAdjFloat, 5);
          if (selected && selected.length === 5) inputs = selected;
          break;
        }
      }

      if (!inputs || inputs.length !== 5) continue;
      explored++;

      const sig = listingSig(inputs.map(i => i.id));
      if (existingSignatures.has(sig)) continue;

      const result = await evaluateKnifeTradeUp(pool, inputs, knifeFinishCache);
      if (!result || result.profit_cents <= 0) continue;

      existingSignatures.add(sig);
      const chanceToProfit = computeChanceToProfit(result.outcomes, result.total_cost_cents);
      const { bestCase: bestCaseNew, worstCase: worstCaseNew } = computeBestWorstCase(result.outcomes, result.total_cost_cents);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inputSources = [...new Set(result.inputs.map(i => i.source ?? "csfloat"))].sort();
        const { rows: infoRows } = await client.query(`
          INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, source, outcomes_json, input_sources)
          VALUES ($1, $2, $3, $4, $5, 'covert_knife', $6, $7, 'explore', $8, $9)
          RETURNING id
        `, [
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          bestCaseNew, worstCaseNew, JSON.stringify(result.outcomes), inputSources
        ]);
        const tuId = infoRows[0].id;
        for (const input of result.inputs) {
          await client.query(`
            INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [tuId, input.listing_id, input.skin_id, input.skin_name,
            input.collection_name, input.price_cents, input.float_value, input.condition, input.source ?? "csfloat"]);
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
      console.error("  Knife explore error:", err instanceof Error ? err.message : err);
    }
  }

  return { found, explored, improved };
}

/**
 * Time-bounded random knife exploration for worker processes.
 * Read-only: returns TradeUp[] instead of writing to DB.
 * No swap optimization (requires writable DB).
 * Runs until deadlineMs timestamp.
 */
export async function exploreKnifeWithBudget(
  pool: pg.Pool,
  deadlineMs: number,
  existingSignatures: Set<string>,
  options: {
    cycleStartedAt?: number;
    onProgress?: (msg: string) => void;
    maxResults?: number;
  } = {}
): Promise<TradeUp[]> {
  await buildPriceCache(pool);

  const { allListings, byCollection, byColAdj, byColValue } = await loadDiscoveryData(
    pool, "Covert", "collection_name", { excludeWeapons: KNIFE_WEAPONS }
  );
  if (allListings.length === 0) return [];

  // Build knife finish cache
  const knifeFinishCache = await buildKnifeFinishCache(pool);

  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });
  if (knifeCollections.length === 0) return [];

  // Profit-guided weighted pool
  const weightedPool = await buildWeightedPool(pool, knifeCollections, "covert_knife", byCollection);
  const knifeOnlySortedByPrice = allListings
    .filter(l => CASE_KNIFE_MAP[l.collection_name])
    .sort((a, b) => a.price_cents - b.price_cents);

  // Build new-listing pool for new-listing priority strategy
  const newListingsByCol = new Map<string, ListingWithCollection[]>();
  if (options.cycleStartedAt) {
    const { rows: newRows } = await pool.query<{ id: string }>(
      `SELECT id FROM listings WHERE created_at > to_timestamp($1 / 1000.0)`,
      [options.cycleStartedAt]
    );
    const newIds = new Set(newRows.map(r => r.id));
    for (const [colName, listings] of byCollection) {
      const newOnes = listings.filter(l => newIds.has(l.id));
      if (newOnes.length > 0) newListingsByCol.set(colName, newOnes);
    }
  }

  // Float-biased strategies: float-targeted (5), ultra-low-float (7), output-aware (8), value-ratio (10, 11) get 2x
  const KNIFE_FLOAT_BIASED = [5, 7, 8, 10, 11];
  const KNIFE_TOTAL_STRATEGIES = 13;
  const maxResults = options.maxResults ?? Number.POSITIVE_INFINITY;

  const results: TradeUp[] = [];
  let explored = 0;

  while (Date.now() < deadlineMs - 1000 && results.length < maxResults) {
    explored++;
    if (explored % 500 === 0) {
      const remaining = Math.round((deadlineMs - Date.now()) / 1000);
      options.onProgress?.(`Knife explore: ${explored} iters, ${results.length} found (${remaining}s left)`);
    }

    try {
      const strategy = pickWeightedStrategy(KNIFE_TOTAL_STRATEGIES, KNIFE_FLOAT_BIASED);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
          if (listA.length < countA || listB.length < countB) break;
          const maxOffA = Math.min(listA.length - countA, 200);
          const maxOffB = Math.min(listB.length - countB, 200);
          const offA = Math.floor(Math.random() * (maxOffA + 1));
          const offB = Math.floor(Math.random() * (maxOffB + 1));
          inputs = [...listA.slice(offA, offA + countA), ...listB.slice(offB, offB + countB)];
          break;
        }

        case 1: {
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          const maxOff = Math.min(list.length - 5, 300);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 5);
          break;
        }

        case 2: {
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          const conditions = CONDITION_BOUNDS.map(c => c.name);
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 5) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 5 + 1, 100));
          inputs = condListings.slice(off, off + 5);
          break;
        }

        case 3: {
          const cols = shuffle(knifeCollections).slice(0, 3);
          if (cols.length < 3) break;
          const pooled = cols
            .flatMap(c => {
              const list = byCollection.get(c) ?? [];
              const off = Math.floor(Math.random() * Math.min(list.length, 10));
              return list.slice(off, off + 8);
            })
            .sort((a, b) => a.price_cents - b.price_cents);
          if (pooled.length < 5) break;
          inputs = pooled.slice(0, 5);
          break;
        }

        case 4: {
          const maxOff = Math.min(knifeOnlySortedByPrice.length - 5, 300);
          if (maxOff < 0) break;
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = knifeOnlySortedByPrice.slice(off, off + 5);
          break;
        }

        case 5: {
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
          const target = Math.random() * 0.5;
          const quotas = new Map([[colA, countA], [colB, countB]]);
          const selected = selectForFloatTarget(byColAdj, quotas, target, 5);
          if (selected && selected.length === 5) inputs = selected;
          break;
        }

        case 6: {
          const singleKnifeCollections = knifeCollections.filter(cn => {
            const ci = CASE_KNIFE_MAP[cn];
            return ci && ci.knifeTypes.length === 1 && ci.knifeFinishes.length > 0;
          });
          const gloveCollections = knifeCollections.filter(cn => {
            const ci = CASE_KNIFE_MAP[cn];
            return ci && ci.gloveGen !== null;
          });
          if (singleKnifeCollections.length === 0 || gloveCollections.length === 0) break;

          const knCol = pick(singleKnifeCollections);
          const glCol = pick(gloveCollections);
          const knList = byCollection.get(knCol) ?? [];
          const glList = byCollection.get(glCol) ?? [];

          for (const [kn, gl] of [[1, 4], [2, 3], [3, 2]] as [number, number][]) {
            if (knList.length < kn || glList.length < gl) continue;
            const knOff = Math.floor(Math.random() * Math.min(knList.length - kn + 1, 10));
            const glOff = Math.floor(Math.random() * Math.min(glList.length - gl + 1, 10));
            const candidate = [...knList.slice(knOff, knOff + kn), ...glList.slice(glOff, glOff + gl)];
            if (candidate.length === 5) {
              inputs = candidate;
              break;
            }
          }
          break;
        }

        case 7: {
          // Ultra-low-float pool: pick 2-3 lowest-float listings per collection,
          // fill remaining with cheapest. Tests if output float premium outweighs cost.
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          const floatSorted = [...list].sort((a, b) => a.float_value - b.float_value);
          const lowFloatCount = 1 + Math.floor(Math.random() * 2); // 1 or 2 for knife (5 inputs)
          const lowFloats = floatSorted.slice(0, lowFloatCount);
          const lowFloatIds = new Set(lowFloats.map(l => l.id));
          const remaining = list.filter(l => !lowFloatIds.has(l.id));
          if (remaining.length < 5 - lowFloatCount) break;
          inputs = [...lowFloats, ...remaining.slice(0, 5 - lowFloatCount)];
          break;
        }

        case 8: {
          // Output-value-aware: target input floats that produce the best output condition.
          // For knife trade-ups, lower input floats → lower output floats → higher-value knives.
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          // Target very low adjusted floats (FN/MW output territory)
          const targetAdjFloat = Math.random() * 0.15; // heavily biased toward low floats
          const quotas = new Map([[col, 5]]);
          const selected = selectForFloatTarget(byColAdj, quotas, targetAdjFloat, 5);
          if (selected && selected.length === 5) inputs = selected;
          break;
        }

        case 9: {
          // New-listing priority: build combos including at least 1 listing fetched this cycle.
          if (newListingsByCol.size === 0) break;
          const newCols = [...newListingsByCol.keys()].filter(cn => {
            const m = CASE_KNIFE_MAP[cn];
            return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
          });
          if (newCols.length === 0) break;

          const col = pick(newCols);
          const newListings = newListingsByCol.get(col) ?? [];
          const allColListings = byCollection.get(col) ?? [];
          if (newListings.length === 0 || allColListings.length < 5) break;

          const newCount = Math.min(1 + Math.floor(Math.random() * 2), newListings.length);
          const picked = shuffle(newListings).slice(0, newCount);
          const pickedIds = new Set(picked.map(l => l.id));
          const filler = allColListings.filter(l => !pickedIds.has(l.id));
          if (filler.length < 5 - newCount) break;
          inputs = [...picked, ...filler.slice(0, 5 - newCount)];
          break;
        }

        case 10: {
          // Value-ratio single: pick collection, use most underpriced listings
          const col = pick(weightedPool);
          const valueList = byColValue.get(col) ?? [];
          if (valueList.length < 5) break;
          const maxOff = Math.min(valueList.length - 5, 200);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = valueList.slice(off, off + 5);
          break;
        }

        case 11: {
          // Value-ratio pair: underpriced listings from two collections
          const colA = pick(weightedPool);
          const colB = pick(knifeCollections.filter(c => c !== colA));
          const valA = byColValue.get(colA) ?? [];
          const valB = byColValue.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
          if (valA.length < countA || valB.length < countB) break;
          const maxOffA = Math.min(valA.length - countA, 200);
          const maxOffB = Math.min(valB.length - countB, 200);
          const offA = Math.floor(Math.random() * (maxOffA + 1));
          const offB = Math.floor(Math.random() * (maxOffB + 1));
          inputs = [...valA.slice(offA, offA + countA), ...valB.slice(offB, offB + countB)];
          break;
        }

        case 12: {
          // Value-ratio + float: underpriced listings near condition boundary
          const col = pick(weightedPool);
          const valueList = byColValue.get(col) ?? [];
          if (valueList.length < 5) break;
          // Filter to listings with adjustedFloat < 0.3 (lower half, better output condition)
          const lowFloat = valueList.filter(l => {
            const range = l.max_float - l.min_float;
            const adj = range > 0 ? (l.float_value - l.min_float) / range : 0;
            return adj < 0.3;
          });
          if (lowFloat.length < 5) break;
          inputs = lowFloat.slice(0, 5);
          break;
        }
      }

      // Curve-aware override: swap listing source based on output curve shape
      if (inputs && inputs.length === 5) {
        const usedCols = [...new Set(inputs.map(l => l.collection_name))];
        const curveOutcomes: ComboOutcome[] = [];
        for (const colName of usedCols) {
          const m = CASE_KNIFE_MAP[colName];
          if (!m) continue;
          for (const kt of m.knifeTypes) {
            curveOutcomes.push({
              skinName: kt,
              probability: 1 / (m.knifeTypes.length || 1),
              estimatedPrice: globalPriceCache.get(`${kt}:Field-Tested`) ?? 0,
            });
          }
        }
        if (curveOutcomes.length > 0) {
          const score = comboCurveScore(curveOutcomes);
          const useValue = shouldUseValueRatio(score);

          // If curve says value-ratio but we used price-sort, re-pick from byColValue
          if (useValue === true && strategy < 10) {
            const repicked = usedCols.flatMap(c => (byColValue.get(c) ?? []).slice(0, 3));
            if (repicked.length >= 5) {
              repicked.sort((a, b) => (a.valueRatio ?? 1) - (b.valueRatio ?? 1));
              inputs = repicked.slice(0, 5);
            }
          }
          // If curve says price-sort but we used value-ratio, re-pick from byCollection
          if (useValue === false && strategy >= 10) {
            const repicked = usedCols.flatMap(c => (byCollection.get(c) ?? []).slice(0, 3));
            if (repicked.length >= 5) {
              repicked.sort((a, b) => a.price_cents - b.price_cents);
              inputs = repicked.slice(0, 5);
            }
          }
        }
      }

      if (!inputs || inputs.length !== 5) continue;
      explored++;

      const sig = listingSig(inputs.map(i => i.id));
      if (existingSignatures.has(sig)) continue;

      const result = await evaluateKnifeTradeUp(pool, inputs, knifeFinishCache);
      if (!result) continue;
      if (result.profit_cents <= 0 && (result.chance_to_profit ?? 0) < 0.25) continue;

      existingSignatures.add(sig);
      results.push(result);
    } catch {
      // Ignore individual iteration errors
    }
  }

  options.onProgress?.(`Knife explore done: ${explored} iters, ${results.length} found`);
  return results;
}
