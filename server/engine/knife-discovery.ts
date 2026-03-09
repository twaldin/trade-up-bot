import Database from "better-sqlite3";
import { floatToCondition, type TradeUp, type TradeUpInput } from "../../shared/types.js";
import type { ListingWithCollection, AdjustedListing } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS } from "./knife-data.js";
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
  } = {}
): TradeUp[] {
  options.onProgress?.("Building price cache for knife trade-ups...");
  buildPriceCache(db);

  // Get all Covert gun listings (knife trade-up inputs)
  const KNIFE_WEAPONS = [
    "Bayonet", "Karambit", "Butterfly Knife", "Flip Knife", "Gut Knife",
    "Huntsman Knife", "M9 Bayonet", "Falchion Knife", "Shadow Daggers",
    "Bowie Knife", "Navaja Knife", "Stiletto Knife", "Ursus Knife",
    "Talon Knife", "Classic Knife", "Paracord Knife", "Survival Knife",
    "Nomad Knife", "Skeleton Knife", "Kukri Knife",
  ];

  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !KNIFE_WEAPONS.includes(l.weapon)); // Only gun skins, not knives

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
  const seen = new Set<string>();

  const tryAdd = (tu: TradeUp | null) => {
    if (!tu || tu.expected_value_cents === 0) return;
    const key = tu.inputs.map(i => i.listing_id).sort().join(",");
    if (seen.has(key)) return;
    seen.add(key);
    results.push(tu);
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

  // Pre-compute float transitions for knife outcomes
  // For knives, transition points matter because output float determines condition → price
  const knifeTransitionPoints = [0.001, 0.01, 0.03, 0.05, 0.10, 0.15, 0.25, 0.35, 0.45];

  // Knife selection helpers use the parameterized versions from selection.ts with count=5
  const selectForKnifeFloat = (quotas: Map<string, number>, maxAvgAdjusted: number) =>
    selectForFloatTarget(byColAdj, quotas, maxAvgAdjusted, 5);
  const selectLowestKnifeFloat = (quotas: Map<string, number>) =>
    selectLowestFloat(byColAdj, quotas, 5);

  // ── Step 1: Single-collection knife trade-ups ──
  options.onProgress?.("Knife: single-collection combos...");
  for (const colName of knifeCollections) {
    const listings = byCollection.get(colName)!;
    if (listings.length < 5) continue;

    // Sliding windows (cheapest)
    for (let offset = 0; offset + 5 <= listings.length && offset < 30; offset++) {
      tryAdd(evaluateKnifeTradeUp(db, listings.slice(offset, offset + 5), knifeFinishCache));
    }

    // Float-targeted: for each transition point
    const quotas = new Map([[colName, 5]]);
    for (const target of knifeTransitionPoints) {
      const selected = selectForKnifeFloat(quotas, target);
      if (selected) tryAdd(evaluateKnifeTradeUp(db, selected, knifeFinishCache));
    }

    // Lowest-float selection
    const lowestFloat = selectLowestKnifeFloat(quotas);
    if (lowestFloat) tryAdd(evaluateKnifeTradeUp(db, lowestFloat, knifeFinishCache));

    // Condition-pure groups
    const byCondition = new Map<string, ListingWithCollection[]>();
    for (const l of listings) {
      const cond = floatToCondition(l.float_value);
      const list = byCondition.get(cond) ?? [];
      list.push(l);
      byCondition.set(cond, list);
    }
    for (const [, condListings] of byCondition) {
      if (condListings.length >= 5) {
        tryAdd(evaluateKnifeTradeUp(db, condListings.slice(0, 5), knifeFinishCache));
        if (condListings.length >= 10) {
          tryAdd(evaluateKnifeTradeUp(db, condListings.slice(5, 10), knifeFinishCache));
        }
      }
    }

    // Per-skin pooling
    const bySkin = new Map<string, ListingWithCollection[]>();
    for (const l of listings) {
      const list = bySkin.get(l.skin_id) ?? [];
      list.push(l);
      bySkin.set(l.skin_id, list);
    }
    const skinGroups = [...bySkin.values()];
    if (skinGroups.length >= 2) {
      const pooled = skinGroups.flatMap(g => g.slice(0, 3)).sort((a, b) => a.price_cents - b.price_cents);
      if (pooled.length >= 5) {
        for (let off = 0; off + 5 <= pooled.length && off < 15; off += 3) {
          tryAdd(evaluateKnifeTradeUp(db, pooled.slice(off, off + 5), knifeFinishCache));
        }
      }
    }
  }

  options.onProgress?.(`Knife: singles done (${results.length} trade-ups)`);

  // ── Step 2: Two-collection knife trade-ups ──
  options.onProgress?.("Knife: two-collection combos...");
  for (let i = 0; i < knifeCollections.length; i++) {
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
        tryAdd(evaluateKnifeTradeUp(db, [
          ...listingsA.slice(0, countA),
          ...listingsB.slice(0, countB),
        ], knifeFinishCache));

        // Offset combos
        if (listingsA.length >= countA + 5 && listingsB.length >= countB + 5) {
          tryAdd(evaluateKnifeTradeUp(db, [
            ...listingsA.slice(5, 5 + countA),
            ...listingsB.slice(5, 5 + countB),
          ], knifeFinishCache));
        }

        // Mixed: cheap A + offset B
        if (listingsB.length >= countB + 5) {
          tryAdd(evaluateKnifeTradeUp(db, [
            ...listingsA.slice(0, countA),
            ...listingsB.slice(5, 5 + countB),
          ], knifeFinishCache));
        }
        if (listingsA.length >= countA + 5) {
          tryAdd(evaluateKnifeTradeUp(db, [
            ...listingsA.slice(5, 5 + countA),
            ...listingsB.slice(0, countB),
          ], knifeFinishCache));
        }

        // Float-targeted
        const quotas = new Map([[colA, countA], [colB, countB]]);
        for (const target of knifeTransitionPoints) {
          const selected = selectForKnifeFloat(quotas, target);
          if (selected) tryAdd(evaluateKnifeTradeUp(db, selected, knifeFinishCache));
        }

        // Lowest-float
        const lowestFloat = selectLowestKnifeFloat(quotas);
        if (lowestFloat) tryAdd(evaluateKnifeTradeUp(db, lowestFloat, knifeFinishCache));
      }
    }
  }

  options.onProgress?.(`Knife: pairs done (${results.length} trade-ups)`);

  // ── Step 3: Three-collection knife trade-ups ──
  options.onProgress?.("Knife: three-collection combos...");
  const maxTripleKnife = Math.min(knifeCollections.length, 20);
  for (let i = 0; i < maxTripleKnife; i++) {
    for (let j = i + 1; j < maxTripleKnife; j++) {
      for (let k = j + 1; k < maxTripleKnife; k++) {
        const cols = [knifeCollections[i], knifeCollections[j], knifeCollections[k]];
        const pooled = cols
          .flatMap(c => byCollection.get(c) ?? [])
          .sort((a, b) => a.price_cents - b.price_cents);
        if (pooled.length < 5) continue;

        // Cheapest 5
        tryAdd(evaluateKnifeTradeUp(db, pooled.slice(0, 5), knifeFinishCache));

        // Ratio patterns: [3,1,1], [2,2,1]
        for (const ratios of [[3, 1, 1], [2, 2, 1]]) {
          const colsSorted = cols
            .map(c => ({ name: c, count: byCollection.get(c)?.length ?? 0 }))
            .sort((a, b) => b.count - a.count);
          const quotas = new Map<string, number>();
          for (let r = 0; r < 3; r++) quotas.set(colsSorted[r].name, ratios[r]);

          // Cheapest per quota
          const inputs: ListingWithCollection[] = [];
          let valid = true;
          for (const [colName, count] of quotas) {
            const list = byCollection.get(colName) ?? [];
            if (list.length < count) { valid = false; break; }
            inputs.push(...list.slice(0, count));
          }
          if (valid && inputs.length === 5) {
            tryAdd(evaluateKnifeTradeUp(db, inputs, knifeFinishCache));
          }

          // Float-targeted
          for (const target of knifeTransitionPoints.slice(0, 5)) {
            const selected = selectForKnifeFloat(quotas, target);
            if (selected) tryAdd(evaluateKnifeTradeUp(db, selected, knifeFinishCache));
          }
        }
      }
    }
  }

  options.onProgress?.(`Knife: triples done (${results.length} trade-ups)`);

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

  const KNIFE_WEAPONS = [
    "Bayonet", "Karambit", "Butterfly Knife", "Flip Knife", "Gut Knife",
    "Huntsman Knife", "M9 Bayonet", "Falchion Knife", "Shadow Daggers",
    "Bowie Knife", "Navaja Knife", "Stiletto Knife", "Ursus Knife",
    "Talon Knife", "Classic Knife", "Paracord Knife", "Survival Knife",
    "Nomad Knife", "Skeleton Knife", "Kukri Knife",
  ];

  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !KNIFE_WEAPONS.includes(l.weapon));
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
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents)
    VALUES (?, ?, ?, ?, ?, 'covert_knife', ?, ?)
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
  let improved = 0;

  // Also load existing trade-ups for improvement attempts
  const existingTradeUps = db.prepare(`
    SELECT id, profit_cents, total_cost_cents FROM trade_ups WHERE type = 'covert_knife' AND profit_cents > 0
    ORDER BY profit_cents DESC LIMIT 200
  `).all() as { id: number; profit_cents: number; total_cost_cents: number }[];
  const getInputs = db.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?");

  const updateTradeUp = db.prepare(`
    UPDATE trade_ups SET total_cost_cents = ?, expected_value_cents = ?, profit_cents = ?, roi_percentage = ?, chance_to_profit = ?, best_case_cents = ?, worst_case_cents = ?
    WHERE id = ?
  `);
  const deleteInputs = db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id = ?");
  const deleteOutcomes = db.prepare("DELETE FROM trade_up_outcomes WHERE trade_up_id = ?");

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
          const colA = pick(knifeCollections);
          const colB = pick(knifeCollections.filter(c => c !== colA));
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
          const col = pick(knifeCollections);
          const list = byCollection.get(col) ?? [];
          if (list.length < 5) break;
          const maxOff = Math.min(list.length - 5, 30);
          const off = Math.floor(Math.random() * (maxOff + 1));
          inputs = list.slice(off, off + 5);
          break;
        }

        case 2: {
          // Float-targeted random pair
          const colA = pick(knifeCollections);
          const colB = pick(knifeCollections.filter(c => c !== colA));
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
          const col = pick(knifeCollections);
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
            : pick(knifeCollections);
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
                bestCaseSwap, worstCaseSwap, existing.id
              );
              deleteInputs.run(existing.id);
              deleteOutcomes.run(existing.id);
              for (const input of bestResult!.inputs) {
                insertInput.run(existing.id, input.listing_id, input.skin_id, input.skin_name,
                  input.collection_name, input.price_cents, input.float_value, input.condition);
              }
              for (const outcome of bestResult!.outcomes) {
                insertOutcome.run(existing.id, outcome.skin_id, outcome.skin_name, outcome.collection_name,
                  outcome.probability, outcome.predicted_float, outcome.predicted_condition,
                  outcome.estimated_price_cents);
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
          bestCaseNew, worstCaseNew
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
      // Skip errors in random exploration
    }
  }

  return { found, explored, improved };
}
