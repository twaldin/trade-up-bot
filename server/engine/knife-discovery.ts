import Database from "better-sqlite3";
import { floatToCondition, type TradeUp, type TradeUpInput } from "../../shared/types.js";
import type { ListingWithCollection, AdjustedListing } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS, KNIFE_WEAPONS } from "./knife-data.js";
import { buildPriceCache } from "./pricing.js";
import { getListingsForRarity } from "./data-load.js";
import { addAdjustedFloat, selectForFloatTarget, selectLowestFloat } from "./selection.js";
import { evaluateKnifeTradeUp, getKnifeFinishesWithPrices } from "./knife-evaluation.js";

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
export function findProfitableKnifeTradeUps(
  db: Database.Database,
  options: {
    onProgress?: (msg: string) => void;
    extraTransitionPoints?: number[];
    existingSignatures?: Set<string>;
    deadlineMs?: number;
  } = {}
): TradeUp[] {
  options.onProgress?.("Building price cache for knife trade-ups...");
  buildPriceCache(db);

  // Get all Covert gun listings (knife trade-up inputs)
  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon)); // Only gun skins, not knives

  if (allListings.length === 0) {
    options.onProgress?.("No Covert gun listings found");
    return [];
  }

  // Group by collection
  const byCollection = new Map<string, ListingWithCollection[]>();
  for (const l of allListings) {
    const list = byCollection.get(l.collection_name) ?? [];
    list.push(l);
    byCollection.set(l.collection_name, list);
  }
  // Sort by price within each collection
  for (const [, list] of byCollection) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife + glove finish price cache (same structure, keyed by weapon type)
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) {
      knifeFinishCache.set(itemType, finishes);
    }
  }

  const knifeCount = [...knifeFinishCache.entries()].filter(([k]) => k.includes("Knife") || k === "Bayonet" || k === "Karambit").length;
  const gloveCount = knifeFinishCache.size - knifeCount;
  console.log(`  Item data: ${allListings.length} Covert gun listings, ${knifeCount} knife types + ${gloveCount} glove types with prices`);
  for (const [itemType, finishes] of knifeFinishCache) {
    const avgPrice = finishes.reduce((s, f) => s + f.avgPrice, 0) / finishes.length;
    console.log(`    ${itemType}: ${finishes.length} finishes, avg $${(avgPrice / 100).toFixed(2)}`);
  }

  const results: TradeUp[] = [];
  const seen = new Set<string>(options.existingSignatures);
  let skippedExisting = 0;

  const tryAdd = (tu: TradeUp | null) => {
    if (!tu || tu.expected_value_cents === 0) return;
    // Keep profitable OR high chance-to-profit trade-ups
    if (tu.profit_cents <= 0 && (tu.chance_to_profit ?? 0) < 0.25) return;
    const key = tu.inputs.map(i => i.listing_id).sort().join(",");
    if (seen.has(key)) {
      if (options.existingSignatures?.has(key)) skippedExisting++;
      return;
    }
    seen.add(key);
    results.push(tu);
  };

  /** Compute listing-combo signature for pre-evaluation sig-skipping. */
  const sigOf = (inputs: { id: string }[]) => inputs.map(i => i.id).sort().join(",");

  /** Evaluate only if this listing combo is new (skip evaluation for known combos). */
  const tryEvalKnife = (inputs: ListingWithCollection[]) => {
    const sig = sigOf(inputs);
    if (seen.has(sig)) { skippedExisting++; return; }
    tryAdd(evaluateKnifeTradeUp(db, inputs, knifeFinishCache));
  };

  // Collections that have knife or glove mappings
  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });
  console.log(`  ${knifeCollections.length} collections with knife/glove mappings`);

  // Pre-compute adjusted floats for float-targeted selection
  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

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
      tryEvalKnife(listings.slice(offset, offset + 5));
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
      tryEvalKnife(valueSorted.slice(offset, offset + 5));
    }

    // Float-targeted: for each transition point
    const quotas = new Map([[colName, 5]]);
    for (const target of knifeTransitionPoints) {
      const selected = selectForKnifeFloat(quotas, target);
      if (selected) tryEvalKnife(selected);
    }

    // Lowest-float selection
    const lowestFloat = selectLowestKnifeFloat(quotas);
    if (lowestFloat) tryEvalKnife(lowestFloat);

    // Condition-pure groups — deeper windows to find combos systematic cheapest misses.
    // Random explore proved $100 trade-ups hide in non-cheapest condition groups.
    const byCondition = new Map<string, ListingWithCollection[]>();
    for (const l of listings) {
      const cond = floatToCondition(l.float_value);
      const list = byCondition.get(cond) ?? [];
      list.push(l);
      byCondition.set(cond, list);
    }
    for (const [, condListings] of byCondition) {
      // Try multiple windows within each condition (cheapest, 2nd cheapest, 3rd cheapest)
      for (let window = 0; window < 3; window++) {
        const off = window * 5;
        if (condListings.length >= off + 5) {
          tryEvalKnife(condListings.slice(off, off + 5));
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
        tryEvalKnife(skinListings.slice(0, 5));
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
            tryEvalKnife(condSkinListings.slice(0, 5));
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
          tryEvalKnife(pooled.slice(off, off + 5));
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
      const colA = knifeCollections[i];
      const colB = knifeCollections[j];
      const listingsA = byCollection.get(colA)!;
      const listingsB = byCollection.get(colB)!;

      // All splits: 1/4, 2/3, 3/2, 4/1
      for (const countA of [1, 2, 3, 4]) {
        const countB = 5 - countA;
        if (listingsA.length < countA || listingsB.length < countB) continue;

        // Baseline: cheapest combo
        tryEvalKnife([
          ...listingsA.slice(0, countA),
          ...listingsB.slice(0, countB),
        ]);

        // Offset combos
        if (listingsA.length >= countA + 5 && listingsB.length >= countB + 5) {
          tryEvalKnife([
            ...listingsA.slice(5, 5 + countA),
            ...listingsB.slice(5, 5 + countB),
          ]);
        }

        // Mixed: cheap A + offset B
        if (listingsB.length >= countB + 5) {
          tryEvalKnife([
            ...listingsA.slice(0, countA),
            ...listingsB.slice(5, 5 + countB),
          ]);
        }
        if (listingsA.length >= countA + 5) {
          tryEvalKnife([
            ...listingsA.slice(5, 5 + countA),
            ...listingsB.slice(0, countB),
          ]);
        }

        // Float-targeted
        const quotas = new Map([[colA, countA], [colB, countB]]);
        for (const target of knifeTransitionPoints) {
          const selected = selectForKnifeFloat(quotas, target);
          if (selected) tryEvalKnife(selected);
        }

        // Lowest-float
        const lowestFloat = selectLowestKnifeFloat(quotas);
        if (lowestFloat) tryEvalKnife(lowestFloat);

        // Condition-targeted pairs: cheapest N at each condition
        for (const cond of ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"] as const) {
          const condA = listingsA.filter(l => floatToCondition(l.float_value) === cond);
          const condB = listingsB.filter(l => floatToCondition(l.float_value) === cond);
          if (condA.length >= countA && condB.length >= countB) {
            tryEvalKnife([
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
            tryEvalKnife([...poolA.slice(0, countA), ...poolB.slice(0, countB)]);
          }
          const poolAr = listingsA.filter(l => floatToCondition(l.float_value) === c2);
          const poolBr = listingsB.filter(l => floatToCondition(l.float_value) === c1);
          if (poolAr.length >= countA && poolBr.length >= countB) {
            tryEvalKnife([...poolAr.slice(0, countA), ...poolBr.slice(0, countB)]);
          }
        }
      }
    }
  }

  options.onProgress?.(`Knife: pairs done (${results.length} trade-ups)`);

  // Step 3: Three-collection knife trade-ups (reduced scope)
  // Data shows 0% historically profitable for 3+ collections, but keep triples
  // with reduced limits in case the market shifts.
  if (pastDeadline()) {
    options.onProgress?.(`Knife: stopped at deadline (${results.length} trade-ups)`);
    if (skippedExisting > 0) console.log(`  Knife discovery: skipped ${skippedExisting} combos already in DB`);
    results.sort((a, b) => b.profit_cents - a.profit_cents);
    return results;
  }
  options.onProgress?.("Knife: three-collection combos...");
  const maxTripleKnife = Math.min(knifeCollections.length, 20); // was 35
  for (let i = 0; i < maxTripleKnife; i++) {
    for (let j = i + 1; j < maxTripleKnife; j++) {
      for (let k = j + 1; k < maxTripleKnife; k++) {
        const cols = [knifeCollections[i], knifeCollections[j], knifeCollections[k]];
        const pooled = cols
          .flatMap(c => byCollection.get(c) ?? [])
          .sort((a, b) => a.price_cents - b.price_cents);
        if (pooled.length < 5) continue;
        // Just cheapest-5 pooled — no float targeting for triples (saves ~80% of triple eval time)
        tryEvalKnife(pooled.slice(0, 5));
      }
    }
  }
  options.onProgress?.(`Knife: triples done (${results.length} trade-ups)`);
  // Steps 4-5: Quads/quints removed — never profitable historically.

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
export function randomKnifeExplore(
  db: Database.Database,
  options: {
    iterations?: number;
    onProgress?: (msg: string) => void;
  } = {}
): { found: number; explored: number; improved: number } {
  const iterations = options.iterations ?? 500;
  buildPriceCache(db);

  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon));
  if (allListings.length === 0) return { found: 0, explored: 0, improved: 0 };

  const allAdjusted = addAdjustedFloat(allListings);

  const byCollection = new Map<string, ListingWithCollection[]>();
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byCollection.get(l.collection_name) ?? [];
    list.push(l);
    byCollection.set(l.collection_name, list);
    const adjList = byColAdj.get(l.collection_name) ?? [];
    adjList.push(l);
    byColAdj.set(l.collection_name, adjList);
  }
  for (const [, list] of byCollection) list.sort((a, b) => a.price_cents - b.price_cents);
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });
  if (knifeCollections.length === 0) return { found: 0, explored: 0, improved: 0 };

  // Profit-guided: weight random picks toward collections in recent profitable trade-ups
  const profitWeights = new Map<string, number>();
  const profitRows = db.prepare(`
    SELECT tui.collection_name, COUNT(*) as cnt
    FROM trade_up_inputs tui JOIN trade_ups t ON t.id = tui.trade_up_id
    WHERE t.type = 'covert_knife' AND t.profit_cents > 0
    GROUP BY tui.collection_name
  `).all() as { collection_name: string; cnt: number }[];
  for (const r of profitRows) profitWeights.set(r.collection_name, r.cnt);

  // Build weighted pool: profitable collections appear more often
  const weightedPool: string[] = [];
  for (const col of knifeCollections) {
    const weight = Math.max(1, profitWeights.get(col) ?? 0);
    const repeats = Math.min(10, Math.ceil(Math.sqrt(weight)));
    for (let i = 0; i < repeats; i++) weightedPool.push(col);
  }

  // Load existing trade-up signatures to avoid duplicates
  const existingSignatures = new Set<string>();
  const existingRows = db.prepare(`
    SELECT trade_up_id, GROUP_CONCAT(listing_id) as ids
    FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = 'covert_knife')
    GROUP BY trade_up_id
  `).all() as { trade_up_id: number; ids: string }[];
  for (const row of existingRows) {
    existingSignatures.add(row.ids.split(",").sort().join(","));
  }

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, source, outcomes_json)
    VALUES (?, ?, ?, ?, ?, 'covert_knife', ?, ?, 'explore', ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
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
  let improved = 0;

  // Also load existing trade-ups for improvement attempts
  const existingTradeUps = db.prepare(`
    SELECT id, profit_cents, total_cost_cents FROM trade_ups WHERE type = 'covert_knife' AND profit_cents > 0
    ORDER BY profit_cents DESC LIMIT 200
  `).all() as { id: number; profit_cents: number; total_cost_cents: number }[];
  const getInputs = db.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?");

  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents = ?, expected_value_cents = ?, profit_cents = ?, roi_percentage = ?, chance_to_profit = ?, best_case_cents = ?, worst_case_cents = ?, outcomes_json = ?
    WHERE id = ?
  `);
  const deleteInputs = db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id = ?");

  for (let iter = 0; iter < iterations; iter++) {
    if (iter % 100 === 0) {
      options.onProgress?.(`Knife explore: ${iter}/${iterations} (${found} new, ${improved} improved)`);
    }

    try {
      const strategy = Math.floor(Math.random() * 8);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          // Random pair with random split + random offset
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 4); // 1-4
          const countB = 5 - countA;
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
          if (list.length < 5) break;
          const maxOff = Math.min(list.length - 5, 30);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 5);
          break;
        }

        case 2: {
          // Float-targeted random pair
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
          const target = Math.random() * 0.5; // random float target 0-0.5
          const quotas = new Map([[colA, countA], [colB, countB]]);
          // Use byColAdj for float-targeted selection
          const totalBudget = 5 * target;
          const candidates: AdjustedListing[] = [];
          for (const [col, quota] of quotas) {
            const pool = byColAdj.get(col);
            if (!pool || pool.length < quota) { inputs = null; break; }
            for (const l of pool) { if (l.adjustedFloat <= totalBudget) candidates.push(l); }
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
          // Triple collection — pool cheapest with random offsets
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
          // Condition-pure from random collection
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          const conditions = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 5) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 5 + 1, 10));
          inputs = condListings.slice(off, off + 5);
          break;
        }

        case 5: {
          // Global cheapest pool (cross-collection)
          const knifeOnly = allListings.filter(l => CASE_KNIFE_MAP[l.collection_name]);
          const sorted = [...knifeOnly].sort((a, b) => a.price_cents - b.price_cents);
          const maxOff = Math.min(sorted.length - 5, 100);
          if (maxOff < 0) break;
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = sorted.slice(off, off + 5);
          break;
        }

        case 7: {
          // High-chance-profit targeting: single-knife collection × glove collection
          // Single-knife = fewer outcomes per finish = higher per-outcome probability
          // Glove collections add mid-value outcomes that often exceed low input costs
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

          // Try various splits biased toward glove collection (cheaper, more mid-value outcomes)
          for (const [kn, gl] of [[1, 4], [2, 3], [3, 2]]) {
            if (knList.length < kn || glList.length < gl) continue;
            // Random offset into cheapest range
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
          const existInputs = getInputs.all(existing.id) as TradeUpInput[];
          if (existInputs.length !== 5) break;

          // Find the listings for this trade-up
          const listingById = new Map<string, ListingWithCollection>();
          for (const l of allListings) listingById.set(l.id, l);

          const currentInputs = existInputs.map(i => listingById.get(i.listing_id)).filter(Boolean) as ListingWithCollection[];
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
            const result = evaluateKnifeTradeUp(db, newInputs, knifeFinishCache);
            if (result && result.profit_cents > existing.profit_cents) {
              if (!bestResult || result.profit_cents > bestResult.profit_cents) {
                bestResult = result;
              }
            }
          }

          if (bestResult) {
            const chanceToProfit = bestResult.outcomes.reduce((sum, o) =>
              sum + (o.estimated_price_cents > bestResult!.total_cost_cents ? o.probability : 0), 0
            );
            const bestCaseSwap = Math.max(...bestResult.outcomes.map(o => o.estimated_price_cents)) - bestResult.total_cost_cents;
            const worstCaseSwap = Math.min(...bestResult.outcomes.map(o => o.estimated_price_cents)) - bestResult.total_cost_cents;
            const applyUpdate = db.transaction(() => {
              updateTradeUp.run(
                bestResult!.total_cost_cents, bestResult!.expected_value_cents,
                bestResult!.profit_cents, bestResult!.roi_percentage, chanceToProfit,
                bestCaseSwap, worstCaseSwap, JSON.stringify(bestResult!.outcomes), existing.id
              );
              deleteInputs.run(existing.id);
              for (const input of bestResult!.inputs) {
                insertInput.run(existing.id, input.listing_id, input.skin_id, input.skin_name,
                  input.collection_name, input.price_cents, input.float_value, input.condition);
              }
            });
            applyUpdate();
            improved++;
            // Update the cached profit for future improvement attempts
            existing.profit_cents = bestResult.profit_cents;
          }
          explored++;
          continue; // Don't fall through to the new trade-up insertion below
        }
      }

      if (!inputs || inputs.length !== 5) continue;
      explored++;

      const sig = inputs.map(i => i.id).sort().join(",");
      if (existingSignatures.has(sig)) continue;

      const result = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
      if (!result || result.profit_cents <= 0) continue;

      existingSignatures.add(sig);
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0
      );
      const bestCaseNew = Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;
      const worstCaseNew = Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;

      const saveTu = db.transaction(() => {
        const info = insertTradeUp.run(
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          bestCaseNew, worstCaseNew, JSON.stringify(result.outcomes)
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
export function exploreKnifeWithBudget(
  db: Database.Database,
  deadlineMs: number,
  existingSignatures: Set<string>,
  options: {
    onProgress?: (msg: string) => void;
  } = {}
): TradeUp[] {
  buildPriceCache(db);

  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon));
  if (allListings.length === 0) return [];

  const allAdjusted = addAdjustedFloat(allListings);
  const byCollection = new Map<string, ListingWithCollection[]>();
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byCollection.get(l.collection_name) ?? [];
    list.push(l);
    byCollection.set(l.collection_name, list);
    const adjList = byColAdj.get(l.collection_name) ?? [];
    adjList.push(l);
    byColAdj.set(l.collection_name, adjList);
  }
  for (const [, list] of byCollection) list.sort((a, b) => a.price_cents - b.price_cents);
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });
  if (knifeCollections.length === 0) return [];

  // Profit-guided weighted pool
  const profitWeights = new Map<string, number>();
  const profitRows = db.prepare(`
    SELECT tui.collection_name, COUNT(*) as cnt
    FROM trade_up_inputs tui JOIN trade_ups t ON t.id = tui.trade_up_id
    WHERE t.type = 'covert_knife' AND t.profit_cents > 0
    GROUP BY tui.collection_name
  `).all() as { collection_name: string; cnt: number }[];
  for (const r of profitRows) profitWeights.set(r.collection_name, r.cnt);
  const weightedPool: string[] = [];
  for (const col of knifeCollections) {
    const weight = Math.max(1, profitWeights.get(col) ?? 0);
    const repeats = Math.min(10, Math.ceil(Math.sqrt(weight)));
    for (let i = 0; i < repeats; i++) weightedPool.push(col);
  }

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const results: TradeUp[] = [];
  let explored = 0;

  while (Date.now() < deadlineMs - 1000) {
    explored++;
    if (explored % 500 === 0) {
      const remaining = Math.round((deadlineMs - Date.now()) / 1000);
      options.onProgress?.(`Knife explore: ${explored} iters, ${results.length} found (${remaining}s left)`);
    }

    try {
      const strategy = Math.floor(Math.random() * 7);
      let inputs: ListingWithCollection[] | null = null;

      switch (strategy) {
        case 0: {
          // Random pair with random split + offset
          const colA = pick(weightedPool);
          const colB = pick(weightedPool.filter(c => c !== colA));
          const listA = byCollection.get(colA) ?? [];
          const listB = byCollection.get(colB) ?? [];
          const countA = 1 + Math.floor(Math.random() * 4);
          const countB = 5 - countA;
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
          if (list.length < 5) break;
          const maxOff = Math.min(list.length - 5, 30);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 5);
          break;
        }

        case 2: {
          // Condition-pure from random collection
          const col = pick(weightedPool);
          const list = byCollection.get(col) ?? [];
          const conditions = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
          const cond = pick(conditions);
          const condListings = list.filter(l => floatToCondition(l.float_value) === cond);
          if (condListings.length < 5) break;
          const off = Math.floor(Math.random() * Math.min(condListings.length - 5 + 1, 10));
          inputs = condListings.slice(off, off + 5);
          break;
        }

        case 3: {
          // Triple collection pool
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
          // Global cheapest pool
          const knifeOnly = allListings.filter(l => CASE_KNIFE_MAP[l.collection_name]);
          const sorted = [...knifeOnly].sort((a, b) => a.price_cents - b.price_cents);
          const maxOff = Math.min(sorted.length - 5, 100);
          if (maxOff < 0) break;
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = sorted.slice(off, off + 5);
          break;
        }

        case 5: {
          // Float-targeted random pair
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
          // High-chance-profit targeting: single-knife × glove collection
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
      }

      if (!inputs || inputs.length !== 5) continue;
      explored++;

      const sig = inputs.map(i => i.id).sort().join(",");
      if (existingSignatures.has(sig)) continue;

      const result = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
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
