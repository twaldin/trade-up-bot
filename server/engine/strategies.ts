import Database from "better-sqlite3";
import { type TradeUp, type TradeUpInput, type TradeUpOutcome } from "../../shared/types.js";
import type { ListingWithCollection } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS } from "./knife-data.js";
import { buildPriceCache } from "./pricing.js";
import { evaluateKnifeTradeUp, getKnifeFinishesWithPrices } from "./knife-evaluation.js";

// ─── Tier 2 Strategies ──────────────────────────────────────────────────────

/**
 * Reverse lookup: Start from most expensive knife/glove outputs,
 * find cheapest inputs that produce them.
 */
export function findTradeUpsForTargetOutputs(
  db: Database.Database,
  options: { onProgress?: (msg: string) => void } = {}
): TradeUp[] {
  buildPriceCache(db);

  // Build collection → cheapest Covert gun listings
  const listingsByCol = new Map<string, ListingWithCollection[]>();
  const allCovertListings = db.prepare(`
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.paint_seed, l.stattrak,
           s.name as skin_name, s.min_float, s.max_float, s.rarity,
           c.name as collection_name, c.id as collection_id
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0 AND l.stattrak = 0
      AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
      AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
      AND s.weapon != 'Shadow Daggers'
    ORDER BY l.price_cents ASC
  `).all() as ListingWithCollection[];

  for (const l of allCovertListings) {
    const list = listingsByCol.get(l.collection_name) ?? [];
    list.push(l);
    listingsByCol.set(l.collection_name, list);
  }

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allKnifeTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allKnifeTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allKnifeTypes.add(gt);
    }
  }
  for (const kt of allKnifeTypes) {
    const finishes = getKnifeFinishesWithPrices(db, kt);
    if (finishes.length > 0) knifeFinishCache.set(kt, finishes);
  }

  // Rank all outputs by price (most expensive first)
  const allOutputs: { name: string; price: number; itemType: string }[] = [];
  for (const [itemType, finishes] of knifeFinishCache) {
    for (const f of finishes) {
      allOutputs.push({ name: f.name, price: f.maxPrice, itemType });
    }
  }
  allOutputs.sort((a, b) => b.price - a.price);
  const topOutputs = allOutputs.slice(0, 100);

  // Find which collections produce each output
  const results: TradeUp[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < topOutputs.length; i++) {
    const target = topOutputs[i];
    if (i % 10 === 0) {
      options.onProgress?.(`Reverse lookup: ${i}/${topOutputs.length} targets (${results.length} found)`);
    }

    // Find collections that include this item type
    const targetCollections: string[] = [];
    for (const [colName, caseInfo] of Object.entries(CASE_KNIFE_MAP)) {
      // Check if this collection produces this item type
      if (caseInfo.knifeTypes.includes(target.itemType)) {
        // Check if the finish is in this case's finish set
        const finishName = target.name.split(" | ")[1];
        const isVanilla = !finishName;
        if (isVanilla ? caseInfo.knifeFinishes.includes("Vanilla") : caseInfo.knifeFinishes.includes(finishName)) {
          targetCollections.push(colName);
        }
      }
      // Check gloves
      if (caseInfo.gloveGen) {
        const genSkins = GLOVE_GEN_SKINS[caseInfo.gloveGen];
        if (genSkins[target.itemType]) {
          const finishName = target.name.split(" | ")[1];
          if (finishName && genSkins[target.itemType].includes(finishName)) {
            targetCollections.push(colName);
          }
        }
      }
    }

    // Try single-collection trade-ups
    for (const colName of targetCollections) {
      const listings = listingsByCol.get(colName);
      if (!listings || listings.length < 5) continue;

      // Try cheapest 5
      const inputs = listings.slice(0, 5);
      const sig = inputs.map(i => i.id).sort().join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);

      const tu = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
      if (tu && tu.profit_cents > 0) results.push(tu);

      // Try offsets for more combinations
      for (let off = 1; off <= Math.min(15, listings.length - 5); off++) {
        const offInputs = listings.slice(off, off + 5);
        const offSig = offInputs.map(i => i.id).sort().join(",");
        if (seen.has(offSig)) continue;
        seen.add(offSig);
        const offTu = evaluateKnifeTradeUp(db, offInputs, knifeFinishCache);
        if (offTu && offTu.profit_cents > 0) results.push(offTu);
      }
    }

    // Try 2-collection combos biased toward target
    if (targetCollections.length >= 2) {
      for (let a = 0; a < targetCollections.length; a++) {
        const colA = targetCollections[a];
        const listA = listingsByCol.get(colA);
        if (!listA || listA.length < 4) continue;

        for (let b = a + 1; b < targetCollections.length; b++) {
          const colB = targetCollections[b];
          const listB = listingsByCol.get(colB);
          if (!listB || listB.length < 1) continue;

          // 4:1 split — 80% chance of colA's pool
          const inputs41 = [...listA.slice(0, 4), listB[0]];
          const sig41 = inputs41.map(i => i.id).sort().join(",");
          if (!seen.has(sig41)) {
            seen.add(sig41);
            const tu = evaluateKnifeTradeUp(db, inputs41, knifeFinishCache);
            if (tu && tu.profit_cents > 0) results.push(tu);
          }

          // 3:2 split
          if (listB.length >= 2) {
            const inputs32 = [...listA.slice(0, 3), ...listB.slice(0, 2)];
            const sig32 = inputs32.map(i => i.id).sort().join(",");
            if (!seen.has(sig32)) {
              seen.add(sig32);
              const tu = evaluateKnifeTradeUp(db, inputs32, knifeFinishCache);
              if (tu && tu.profit_cents > 0) results.push(tu);
            }
          }
        }
      }
    }

    // Also try mixing target collection with NON-target collections (cheap fillers)
    for (const colName of targetCollections) {
      const listT = listingsByCol.get(colName);
      if (!listT || listT.length < 1) continue;

      // Find cheapest non-target collection listings as fillers
      for (const [fillCol, fillListings] of listingsByCol) {
        if (targetCollections.includes(fillCol)) continue;
        if (!(fillCol in CASE_KNIFE_MAP)) continue; // must be a knife-mapped collection
        if (fillListings.length < 4) continue;

        // 1 from target (keeps 20% chance), 4 cheap fillers
        const inputs = [listT[0], ...fillListings.slice(0, 4)];
        const sig = inputs.map(i => i.id).sort().join(",");
        if (seen.has(sig)) continue;
        seen.add(sig);
        const tu = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
        if (tu && tu.profit_cents > 0) results.push(tu);
      }
    }
  }

  options.onProgress?.(`Reverse lookup complete: ${results.length} profitable trade-ups`);
  return results;
}

/**
 * For each profitable trade-up near a condition boundary, try swapping
 * inputs for lower-float versions to push the output into a better condition.
 */
export function optimizeConditionBreakpoints(
  db: Database.Database,
  options: { onProgress?: (msg: string) => void } = {}
): { improved: number; checked: number } {
  buildPriceCache(db);

  const boundaries = [
    { name: "FN", threshold: 0.07 },
    { name: "MW", threshold: 0.15 },
    { name: "FT", threshold: 0.38 },
    { name: "WW", threshold: 0.45 },
  ];

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allKnifeTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allKnifeTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allKnifeTypes.add(gt);
    }
  }
  for (const kt of allKnifeTypes) {
    const finishes = getKnifeFinishesWithPrices(db, kt);
    if (finishes.length > 0) knifeFinishCache.set(kt, finishes);
  }

  // Load all Covert gun listings grouped by collection
  const allListings = db.prepare(`
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.paint_seed, l.stattrak,
           s.name as skin_name, s.min_float, s.max_float, s.rarity,
           c.name as collection_name, c.id as collection_id
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0 AND l.stattrak = 0
      AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
      AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
      AND s.weapon != 'Shadow Daggers'
    ORDER BY l.price_cents ASC
  `).all() as ListingWithCollection[];

  // Index by collection, sorted by price
  const byCollection = new Map<string, ListingWithCollection[]>();
  for (const l of allListings) {
    const list = byCollection.get(l.collection_name) ?? [];
    list.push(l);
    byCollection.set(l.collection_name, list);
  }

  // Load existing profitable knife trade-ups
  const tradeUps = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents
    FROM trade_ups t
    WHERE t.type = 'covert_knife' AND t.profit_cents > -5000
    ORDER BY t.profit_cents DESC
    LIMIT 500
  `).all() as { id: number; total_cost_cents: number; expected_value_cents: number; profit_cents: number }[];

  let improved = 0;
  let checked = 0;

  for (const tu of tradeUps) {
    const inputs = db.prepare(
      "SELECT * FROM trade_up_inputs WHERE trade_up_id = ?"
    ).all(tu.id) as TradeUpInput[];
    const outcomes = db.prepare(
      "SELECT * FROM trade_up_outcomes WHERE trade_up_id = ?"
    ).all(tu.id) as TradeUpOutcome[];

    // Check if any outcome is near a condition boundary
    let nearBoundary = false;
    for (const outcome of outcomes) {
      for (const b of boundaries) {
        const distance = outcome.predicted_float - b.threshold;
        if (distance > 0 && distance < 0.03) {
          nearBoundary = true;
          break;
        }
      }
      if (nearBoundary) break;
    }
    if (!nearBoundary) continue;
    checked++;

    // Reconstruct ListingWithCollection from inputs
    const inputListings: ListingWithCollection[] = [];
    for (const inp of inputs) {
      const listing = db.prepare(`
        SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.paint_seed, l.stattrak,
               s.name as skin_name, s.min_float, s.max_float, s.rarity,
               c.name as collection_name, c.id as collection_id
        FROM listings l
        JOIN skins s ON l.skin_id = s.id
        JOIN skin_collections sc ON s.id = sc.skin_id
        JOIN collections c ON sc.collection_id = c.id
        WHERE l.id = ?
      `).get(inp.listing_id) as ListingWithCollection | undefined;
      if (listing) inputListings.push(listing);
    }

    if (inputListings.length !== 5) continue;

    // Try swapping each input for a lower-float alternative from the same collection
    for (let slot = 0; slot < 5; slot++) {
      const original = inputListings[slot];
      const colListings = byCollection.get(original.collection_name);
      if (!colListings) continue;

      // Find lower-float alternatives (more expensive but better float)
      const adjustedOriginal = (original.float_value - original.min_float) / (original.max_float - original.min_float);

      for (const candidate of colListings) {
        if (candidate.id === original.id) continue;
        const adjustedCandidate = (candidate.float_value - candidate.min_float) / (candidate.max_float - candidate.min_float);
        if (adjustedCandidate >= adjustedOriginal) continue; // not lower float
        if (candidate.price_cents <= original.price_cents) continue; // cheaper won't help — we already found those
        if (candidate.price_cents > original.price_cents + 10000) break; // don't spend more than $100 extra per slot

        // Try the swap
        const newInputs = [...inputListings];
        newInputs[slot] = candidate;

        const newTu = evaluateKnifeTradeUp(db, newInputs, knifeFinishCache);
        if (newTu && newTu.profit_cents > tu.profit_cents + 100) {
          // This is better by at least $1 — save it
          // Update the existing trade-up in DB
          db.prepare(`
            UPDATE trade_ups SET
              total_cost_cents = ?, expected_value_cents = ?, profit_cents = ?,
              roi_percentage = ?, chance_to_profit = ?,
              best_case_cents = ?, worst_case_cents = ?
            WHERE id = ?
          `).run(
            newTu.total_cost_cents, newTu.expected_value_cents, newTu.profit_cents,
            newTu.roi_percentage,
            newTu.outcomes.filter(o => o.estimated_price_cents > newTu.total_cost_cents).reduce((s, o) => s + o.probability, 0),
            Math.max(...newTu.outcomes.map(o => o.estimated_price_cents)) - newTu.total_cost_cents,
            Math.min(...newTu.outcomes.map(o => o.estimated_price_cents)) - newTu.total_cost_cents,
            tu.id
          );

          // Replace inputs
          db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id = ?").run(tu.id);
          const insertInput = db.prepare(`
            INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const inp of newTu.inputs) {
            insertInput.run(tu.id, inp.listing_id, inp.skin_id, inp.skin_name, inp.collection_name, inp.price_cents, inp.float_value, inp.condition);
          }

          // Replace outcomes
          db.prepare("DELETE FROM trade_up_outcomes WHERE trade_up_id = ?").run(tu.id);
          const insertOutcome = db.prepare(`
            INSERT INTO trade_up_outcomes (trade_up_id, skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const out of newTu.outcomes) {
            insertOutcome.run(tu.id, out.skin_id, out.skin_name, out.collection_name, out.probability, out.predicted_float, out.predicted_condition, out.estimated_price_cents);
          }

          improved++;
          inputListings[slot] = candidate; // keep the improvement for subsequent swaps
          break; // Move to next slot
        }
      }
    }

    if (checked % 50 === 0) {
      options.onProgress?.(`Breakpoint optimizer: ${checked}/${tradeUps.length} checked, ${improved} improved`);
    }
  }

  options.onProgress?.(`Breakpoint optimizer done: ${checked} checked, ${improved} improved`);
  return { improved, checked };
}

/**
 * Find trade-ups using StatTrak Covert inputs.
 * StatTrak inputs guarantee a StatTrak knife output (no gloves possible),
 * eliminating glove pool dilution for mixed knife+glove collections.
 */
export function findStatTrakKnifeTradeUps(
  db: Database.Database,
  options: { onProgress?: (msg: string) => void } = {}
): TradeUp[] {
  buildPriceCache(db);

  // Get StatTrak Covert gun listings
  const stListings = db.prepare(`
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.paint_seed, l.stattrak,
           s.name as skin_name, s.min_float, s.max_float, s.rarity,
           c.name as collection_name, c.id as collection_id
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = 'Covert' AND l.stattrak = 1
      AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
      AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
      AND s.weapon != 'Shadow Daggers'
    ORDER BY l.price_cents ASC
  `).all() as ListingWithCollection[];

  if (stListings.length < 5) {
    options.onProgress?.("StatTrak search: not enough StatTrak Covert listings (<5)");
    return [];
  }

  // Build knife-only finish cache (StatTrak = knives only, no gloves)
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allKnifeTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allKnifeTypes.add(kt);
    // NOTE: no gloves for StatTrak — that's the whole point
  }
  for (const kt of allKnifeTypes) {
    // Get knife prices (we use non-ST prices as proxy for now — ST knives are typically more expensive)
    const finishes = getKnifeFinishesWithPrices(db, kt);
    if (finishes.length > 0) knifeFinishCache.set(kt, finishes);
  }

  // Group by collection
  const byCol = new Map<string, ListingWithCollection[]>();
  for (const l of stListings) {
    const list = byCol.get(l.collection_name) ?? [];
    list.push(l);
    byCol.set(l.collection_name, list);
  }

  const results: TradeUp[] = [];
  const seen = new Set<string>();
  const colNames = [...byCol.keys()].filter(cn => cn in CASE_KNIFE_MAP);

  options.onProgress?.(`StatTrak search: ${stListings.length} ST listings across ${colNames.length} collections`);

  // Single collection
  for (const colName of colNames) {
    const listings = byCol.get(colName)!;
    if (listings.length < 5) continue;

    for (let off = 0; off <= Math.min(20, listings.length - 5); off++) {
      const inputs = listings.slice(off, off + 5);
      const sig = inputs.map(i => i.id).sort().join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);

      const tu = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
      if (tu && tu.profit_cents > 0) results.push(tu);
    }
  }

  // Two collection combos
  for (let a = 0; a < colNames.length; a++) {
    const listA = byCol.get(colNames[a])!;
    for (let b = a + 1; b < colNames.length; b++) {
      const listB = byCol.get(colNames[b])!;
      for (const countA of [1, 2, 3, 4]) {
        const countB = 5 - countA;
        if (listA.length < countA || listB.length < countB) continue;

        const inputs = [...listA.slice(0, countA), ...listB.slice(0, countB)];
        const sig = inputs.map(i => i.id).sort().join(",");
        if (seen.has(sig)) continue;
        seen.add(sig);

        const tu = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
        if (tu && tu.profit_cents > 0) results.push(tu);
      }
    }
  }

  options.onProgress?.(`StatTrak search done: ${results.length} profitable from ${seen.size} evaluated`);
  return results;
}

/**
 * Targeted hunt for trade-ups in a specific cost range.
 * Exhaustively tries collection combos that could produce trade-ups
 * in the target budget with emphasis on high chance-to-profit OR high upside.
 */
export function huntBudgetRange(
  db: Database.Database,
  options: {
    minCostCents?: number;
    maxCostCents?: number;
    iterations?: number;
    onProgress?: (msg: string) => void;
  } = {}
): { found: number; explored: number } {
  const minCost = options.minCostCents ?? 15000; // $150
  const maxCost = options.maxCostCents ?? 35000; // $350
  const iterations = options.iterations ?? 5000;
  buildPriceCache(db);

  // Build finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allKnifeTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allKnifeTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allKnifeTypes.add(gt);
    }
  }
  for (const kt of allKnifeTypes) {
    const finishes = getKnifeFinishesWithPrices(db, kt);
    if (finishes.length > 0) knifeFinishCache.set(kt, finishes);
  }

  // Get all Covert gun listings
  const allListings = db.prepare(`
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.paint_seed, l.stattrak,
           s.name as skin_name, s.min_float, s.max_float, s.rarity,
           c.name as collection_name, c.id as collection_id
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0 AND l.stattrak = 0
      AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
      AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
      AND s.weapon != 'Shadow Daggers'
    ORDER BY l.price_cents ASC
  `).all() as ListingWithCollection[];

  const knifeCollections = [...new Set(allListings
    .filter(l => CASE_KNIFE_MAP[l.collection_name])
    .map(l => l.collection_name))];

  const byCollection = new Map<string, ListingWithCollection[]>();
  for (const l of allListings) {
    if (!CASE_KNIFE_MAP[l.collection_name]) continue;
    const list = byCollection.get(l.collection_name) ?? [];
    list.push(l);
    byCollection.set(l.collection_name, list);
  }

  // Pre-compute per-input average cost target
  const avgPerInput = (minCost + maxCost) / 2 / 5; // ~$50 per input on average

  // DB statements
  const existingSignatures = new Set<string>();
  const existingRows = db.prepare(`
    SELECT GROUP_CONCAT(listing_id) as sig FROM trade_up_inputs
    GROUP BY trade_up_id
  `).all() as { sig: string }[];
  for (const row of existingRows) {
    if (row.sig) existingSignatures.add(row.sig.split(",").sort().join(","));
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

  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  let found = 0;
  let explored = 0;

  for (let i = 0; i < iterations; i++) {
    if (i % 500 === 0 && i > 0) {
      options.onProgress?.(`Budget hunt ($${minCost/100}-$${maxCost/100}): ${i}/${iterations}, ${found} found, ${explored} explored`);
    }

    try {
      // Strategy: pick random collections and try to build a 5-input combo
      // that lands in the target cost range
      let inputs: ListingWithCollection[] | null = null;

      const strat = Math.floor(Math.random() * 5);

      if (strat <= 1) {
        // Two collections, try to hit budget with mix of cheap + mid-price
        const colA = pick(knifeCollections);
        const colB = pick(knifeCollections);
        if (colA === colB) continue;
        const listA = byCollection.get(colA) ?? [];
        const listB = byCollection.get(colB) ?? [];
        if (listA.length < 2 || listB.length < 1) continue;

        // Random split
        const countA = 1 + Math.floor(Math.random() * 4);
        const countB = 5 - countA;
        if (listA.length < countA || listB.length < countB) continue;

        // Try to find inputs that sum to target range
        // Pick random offsets and check cost
        for (let attempt = 0; attempt < 5; attempt++) {
          const offA = Math.floor(Math.random() * Math.min(listA.length - countA + 1, 30));
          const offB = Math.floor(Math.random() * Math.min(listB.length - countB + 1, 30));
          const candidate = [...listA.slice(offA, offA + countA), ...listB.slice(offB, offB + countB)];
          const cost = candidate.reduce((s, c) => s + c.price_cents, 0);
          if (cost >= minCost && cost <= maxCost) {
            inputs = candidate;
            break;
          }
        }
      } else if (strat === 2) {
        // Single collection, find 5 inputs in budget
        const col = pick(knifeCollections);
        const list = byCollection.get(col) ?? [];
        if (list.length < 5) continue;

        for (let attempt = 0; attempt < 10; attempt++) {
          const off = Math.floor(Math.random() * Math.min(list.length - 5 + 1, 50));
          const candidate = list.slice(off, off + 5);
          const cost = candidate.reduce((s, c) => s + c.price_cents, 0);
          if (cost >= minCost && cost <= maxCost) {
            inputs = candidate;
            break;
          }
        }
      } else if (strat === 3) {
        // Three collections for maximum output diversity
        const cols = [pick(knifeCollections), pick(knifeCollections), pick(knifeCollections)];
        if (new Set(cols).size < 2) continue;
        const lists = cols.map(c => byCollection.get(c) ?? []);
        if (lists.some(l => l.length < 1)) continue;

        // Pool and pick cheapest 5 that fit budget
        const pool: ListingWithCollection[] = [];
        for (const l of lists) pool.push(...l.slice(0, 20));
        pool.sort((a, b) => a.price_cents - b.price_cents);

        for (let attempt = 0; attempt < 10; attempt++) {
          const off = Math.floor(Math.random() * Math.min(pool.length - 5 + 1, 30));
          const candidate = pool.slice(off, off + 5);
          const cost = candidate.reduce((s, c) => s + c.price_cents, 0);
          if (cost >= minCost && cost <= maxCost) {
            inputs = candidate;
            break;
          }
        }
      } else {
        // Global pool — pick 5 random from all collections in budget range
        const knifeListings = allListings.filter(l => CASE_KNIFE_MAP[l.collection_name]);
        // Filter to per-input range ($20-80 each)
        const inRange = knifeListings.filter(l => l.price_cents >= minCost / 8 && l.price_cents <= maxCost / 3);
        if (inRange.length < 5) continue;

        for (let attempt = 0; attempt < 10; attempt++) {
          const shuffled = [...inRange].sort(() => Math.random() - 0.5);
          const candidate = shuffled.slice(0, 5);
          const cost = candidate.reduce((s, c) => s + c.price_cents, 0);
          if (cost >= minCost && cost <= maxCost) {
            inputs = candidate;
            break;
          }
        }
      }

      if (!inputs || inputs.length !== 5) continue;
      explored++;

      const sig = inputs.map(i => i.id).sort().join(",");
      if (existingSignatures.has(sig)) continue;

      const result = evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
      if (!result || result.profit_cents <= 0) continue;
      if (result.total_cost_cents < minCost || result.total_cost_cents > maxCost) continue;

      existingSignatures.add(sig);
      const chanceToProfit = result.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > result.total_cost_cents ? o.probability : 0), 0
      );
      const bestCase = Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;
      const worstCase = Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents;

      const saveTu = db.transaction(() => {
        const info = insertTradeUp.run(
          result.total_cost_cents, result.expected_value_cents,
          result.profit_cents, result.roi_percentage, chanceToProfit,
          bestCase, worstCase
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
      // Skip errors
    }
  }

  options.onProgress?.(`Budget hunt done: ${found} found, ${explored} explored`);
  return { found, explored };
}
