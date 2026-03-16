/**
 * Generic rarity-tier theory engine — optimistic screener.
 *
 * Originally Classified→Covert only, now parameterized by RarityTierConfig
 * to support any rarity tier (Restricted→Classified, Mil-Spec→Restricted, etc.).
 *
 * - N inputs (configurable via tier.inputCount), parameterized input rarity
 * - Outputs are gun skins of the next rarity tier
 * - excludeKnifeOutputs filters ★ skins (only needed for Classified→Covert)
 * - Input pricing uses KNN chain → listing floor fallback
 * - Output pricing uses condition-level lookupPrice()
 * - Optimistic: no seller fee on outputs, discovery validates with 2% fee
 *
 * Flow: theory gen → buildWantedListForTier() → daemon fetches → discovery validates
 */

import Database from "better-sqlite3";
import { floatToCondition } from "../../shared/types.js";
import { EXCLUDED_COLLECTIONS } from "./types.js";
import type { ClassifiedTheory } from "./types.js";
import { calculateOutputFloat } from "./core.js";
import { lookupPrice } from "./pricing.js";
import { effectiveBuyCostRaw } from "./fees.js";
import { knnPriceAtFloat, getLearnedPrice, getInterpolatedPrice } from "./theory-validation.js";
import type { WantedListing, NearMissInfo } from "./theory-pessimistic.js";
import type { RarityTierConfig } from "./rarity-tiers.js";


export interface ClassifiedTheoryResult {
  generated: number;
  profitable: number;
  wantedList: WantedListing[];
  bestFloatTargets: number[];
  theories: ClassifiedTheory[];
}

interface TierSkin {
  id: string;
  name: string;
  collection: string;
  collectionId: string;
  minFloat: number;
  maxFloat: number;
}

// No seller fee in theory — discovery applies 2% fee during validation
const OUTPUT_DISCOUNT = 1.0;

const _lpCache = new Map<string, number>();

function lp(db: Database.Database, skinName: string, float: number): number {
  const key = `${skinName}:${floatToCondition(float)}`;
  if (_lpCache.has(key)) return _lpCache.get(key)!;
  const price = lookupPrice(db, skinName, float);
  _lpCache.set(key, price);
  return price;
}

// For classified inputs, we need the ACTUAL cost to buy N listings, not floor × N.
// The Nth cheapest listing may cost significantly more than the 1st.
// Pre-loads all classified listings sorted by price per collection+condition.

interface ListingEntry { price: number; float: number; skinName: string; minFloat: number; maxFloat: number; }

// Key: "collection:condition" → sorted array of listings (cheapest first)
const _listingsByColCond = new Map<string, ListingEntry[]>();
// Key: "skin:condition" → cheapest listing price
const _skinFloorCache = new Map<string, number>();

function buildListingPriceCache(db: Database.Database, rarity: string = "Classified"): void {
  _listingsByColCond.clear();
  _skinFloorCache.clear();

  const rows = db.prepare(`
    SELECT s.name as skin_name, c.name as collection_name,
      l.price_cents, l.float_value, s.min_float, s.max_float, l.source
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = ? AND l.stattrak = 0 AND l.listing_type = 'buy_now'
    ORDER BY c.name, l.price_cents ASC
  `).all(rarity) as { skin_name: string; collection_name: string; price_cents: number; float_value: number; min_float: number; max_float: number; source: string }[];

  for (const r of rows) {
    const condition = floatToCondition(r.float_value);
    const effectivePrice = effectiveBuyCostRaw(r.price_cents, r.source || 'csfloat');

    const key = `${r.collection_name}:${condition}`;
    const arr = _listingsByColCond.get(key) ?? [];
    arr.push({ price: effectivePrice, float: r.float_value, skinName: r.skin_name, minFloat: r.min_float, maxFloat: r.max_float });
    _listingsByColCond.set(key, arr);

    const skinKey = `${r.skin_name}:${condition}`;
    const existing = _skinFloorCache.get(skinKey);
    if (!existing || effectivePrice < existing) {
      _skinFloorCache.set(skinKey, effectivePrice);
    }
  }
}

/**
 * Price a classified input at a specific float using KNN chain.
 * Falls back to listing floor if KNN has no data (common for cheap classified skins).
 */
function priceInputAtFloat(db: Database.Database, skinName: string, float: number, listingPrice: number): number {
  // 1. KNN from price_observations
  const knn = knnPriceAtFloat(db, skinName, float);
  if (knn !== null) return knn;

  // 2. Float-bucket learned prices
  const learned = getLearnedPrice(db, skinName, float);
  if (learned !== null) return learned;

  // 3. Interpolated from adjacent buckets
  const interp = getInterpolatedPrice(db, skinName, float);
  if (interp !== null) return interp;

  // 4. Fall back to actual listing price
  return listingPrice;
}

/**
 * Get the N cheapest listings from a collection at a given condition.
 * Uses KNN-chain pricing when available, falls back to listing price.
 * Returns { totalCost, listings } or null if fewer than N exist.
 */
function cheapestNListings(db: Database.Database, collection: string, condition: string, n: number): { totalCost: number; listings: ListingEntry[] } | null {
  const pool = _listingsByColCond.get(`${collection}:${condition}`);
  if (!pool || pool.length < n) return null;
  const selected = pool.slice(0, n);
  // Price each listing via KNN chain for more accurate cost estimation
  const totalCost = selected.reduce((sum, l) => sum + priceInputAtFloat(db, l.skinName, l.float, l.price), 0);
  return { totalCost, listings: selected };
}

function loadSkinsForRarity(db: Database.Database, rarity: string = "Classified"): Map<string, TierSkin[]> {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.min_float, s.max_float,
      c.name as collection_name, c.id as collection_id
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = ? AND s.stattrak = 0
  `).all(rarity) as { id: string; name: string; min_float: number; max_float: number; collection_name: string; collection_id: string }[];

  const byCollection = new Map<string, TierSkin[]>();
  for (const r of rows) {
    if (EXCLUDED_COLLECTIONS.has(r.collection_id)) continue;
    const list = byCollection.get(r.collection_name) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      collection: r.collection_name,
      collectionId: r.collection_id,
      minFloat: r.min_float,
      maxFloat: r.max_float,
    });
    byCollection.set(r.collection_name, list);
  }
  return byCollection;
}

function loadOutputSkins(db: Database.Database, outputRarity: string = "Covert", excludeKnife: boolean = true): Map<string, TierSkin[]> {
  const knifeFilter = excludeKnife ? " AND s.name NOT LIKE '★%'" : "";
  const rows = db.prepare(`
    SELECT s.id, s.name, s.min_float, s.max_float,
      c.name as collection_name, c.id as collection_id
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = ? AND s.stattrak = 0${knifeFilter}
  `).all(outputRarity) as { id: string; name: string; min_float: number; max_float: number; collection_name: string; collection_id: string }[];

  const byCollection = new Map<string, TierSkin[]>();
  for (const r of rows) {
    if (EXCLUDED_COLLECTIONS.has(r.collection_id)) continue;
    const list = byCollection.get(r.collection_name) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      collection: r.collection_name,
      collectionId: r.collection_id,
      minFloat: r.min_float,
      maxFloat: r.max_float,
    });
    byCollection.set(r.collection_name, list);
  }
  return byCollection;
}

interface EvalOutcome {
  skinName: string;
  collection: string;
  probability: number;
  predictedFloat: number;
  predictedCondition: string;
  estimatedPriceCents: number;
}

function evalOutputPool(
  db: Database.Database,
  collections: string[],
  inputCounts: number[],
  totalInputCount: number,
  inputFloats: { float_value: number; min_float: number; max_float: number }[],
  outcomesByCol: Map<string, TierSkin[]>
): { ev: number; dataGaps: string[]; outcomes: EvalOutcome[] } {
  let totalEv = 0;
  const dataGaps: string[] = [];
  const evalOutcomes: EvalOutcome[] = [];
  let totalOutcomes = 0;

  // Count total outcomes across all collections
  for (let ci = 0; ci < collections.length; ci++) {
    const outcomes = outcomesByCol.get(collections[ci]) ?? [];
    totalOutcomes += outcomes.length;
  }
  if (totalOutcomes === 0) return { ev: 0, dataGaps: [], outcomes: [] };

  for (let ci = 0; ci < collections.length; ci++) {
    const colName = collections[ci];
    const colWeight = inputCounts[ci] / totalInputCount;
    const outcomes = outcomesByCol.get(colName) ?? [];
    if (outcomes.length === 0) continue;

    const perOutcomeProb = colWeight / outcomes.length;

    for (const outcome of outcomes) {
      const predFloat = calculateOutputFloat(inputFloats, outcome.minFloat, outcome.maxFloat);
      const price = lp(db, outcome.name, predFloat);
      if (price <= 0) {
        dataGaps.push(outcome.name);
        continue;
      }
      totalEv += perOutcomeProb * price;
      evalOutcomes.push({
        skinName: outcome.name,
        collection: colName,
        probability: perOutcomeProb,
        predictedFloat: predFloat,
        predictedCondition: floatToCondition(predFloat),
        estimatedPriceCents: Math.round(price),
      });
    }
  }

  return { ev: totalEv * OUTPUT_DISCOUNT, dataGaps: [...new Set(dataGaps)], outcomes: evalOutcomes };
}

export function genericComboKey(prefix: string, collections: string[], split: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < collections.length; i++) {
    parts.push(`${collections[i]}:${split[i]}`);
  }
  return prefix + parts.sort().join("|");
}

/**
 * Generate theories for any rarity tier.
 */
export function generateTheoriesForTier(
  db: Database.Database,
  tier: RarityTierConfig,
  options: {
    onProgress?: (msg: string) => void;
    maxTheories?: number;
    minRoiThreshold?: number;
    cooldownMap?: Map<string, { status: string; gap: number; cooldownUntil: string }>;
  } = {}
): ClassifiedTheory[] {
  const maxTheories = options.maxTheories ?? 3000;
  const cooldownMap = options.cooldownMap ?? new Map();
  const label = `${tier.inputRarity}→${tier.outputRarity} theory`;

  // Clear caches and build Nth-cheapest listing price cache
  _lpCache.clear();
  _listingsByColCond.clear();
  _skinFloorCache.clear();
  buildListingPriceCache(db, tier.inputRarity);
  options.onProgress?.(`${label}: ${_listingsByColCond.size} collection+condition pools, ${_skinFloorCache.size} skin floors`);

  const inputsByCol = loadSkinsForRarity(db, tier.inputRarity);
  const outputsByCol = loadOutputSkins(db, tier.outputRarity, tier.excludeKnifeOutputs);

  // Find collections with both input AND output skins
  const eligibleCollections: string[] = [];
  for (const [colName] of inputsByCol) {
    if (outputsByCol.has(colName)) {
      eligibleCollections.push(colName);
    }
  }

  if (eligibleCollections.length === 0) {
    options.onProgress?.(`${label}: no eligible collections`);
    return [];
  }

  options.onProgress?.(`${label}: ${eligibleCollections.length} eligible collections`);

  const theories: ClassifiedTheory[] = [];

  // Conditions to scan — each produces different output float/condition/value
  const CONDITIONS_TO_SCAN = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

  const N = tier.inputCount;

  // Single-collection theories
  for (const colName of eligibleCollections) {
    const comboKey = genericComboKey(tier.comboKeyPrefix, [colName], [N]);
    if (cooldownMap.has(comboKey)) continue;

    for (const condition of CONDITIONS_TO_SCAN) {
      const result = cheapestNListings(db, colName, condition, N);
      if (!result) continue;

      const { totalCost, listings } = result;

      // Use actual listing floats for output calculation
      const inputFloats = listings.map(l => ({
        float_value: l.float,
        min_float: l.minFloat,
        max_float: l.maxFloat,
      }));

      const { ev, dataGaps, outcomes } = evalOutputPool(
        db, [colName], [N], N, inputFloats, outputsByCol
      );
      if (ev <= 0) continue;

      const profit = ev - totalCost;
      const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      if (roi < (options.minRoiThreshold ?? -100)) continue;

      // Compute average adjusted float for display
      const avgFloat = listings.reduce((s, l) => s + l.float, 0) / listings.length;
      const avgRange = listings.reduce((s, l) => s + (l.maxFloat - l.minFloat), 0) / listings.length;
      const avgMinFloat = listings.reduce((s, l) => s + l.minFloat, 0) / listings.length;
      const adjustedFloat = avgRange > 0 ? (avgFloat - avgMinFloat) / avgRange : 0;

      theories.push({
        collections: [colName],
        split: [10],
        inputSkins: listings.map(l => ({
          skinName: l.skinName, collection: colName,
          priceCents: l.price, floatValue: l.float, condition,
        })),
        adjustedFloat,
        totalCostCents: totalCost,
        evCents: Math.round(ev),
        profitCents: Math.round(profit),
        roiPct: Math.round(roi * 100) / 100,
        outputCondition: floatToCondition(avgFloat),
        confidence: dataGaps.length === 0 ? 'high' : dataGaps.length <= 2 ? 'medium' : 'low',
        comboKey,
        outcomes,
      });
    }
  }

  options.onProgress?.(`${label}: singles done (${theories.length} theories)`);

  // Multi-collection helper: evaluate a combo at a given condition
  function evaluateCombo(
    collections: string[], split: number[], condition: string
  ): ClassifiedTheory | null {
    // Get cheapest N listings from each collection at this condition
    const allInputs: ListingEntry[] = [];
    let totalCost = 0;
    for (let ci = 0; ci < collections.length; ci++) {
      const result = cheapestNListings(db, collections[ci], condition, split[ci]);
      if (!result) return null;
      totalCost += result.totalCost;
      allInputs.push(...result.listings);
    }

    const inputFloats = allInputs.map(l => ({
      float_value: l.float, min_float: l.minFloat, max_float: l.maxFloat,
    }));

    const { ev, dataGaps, outcomes } = evalOutputPool(
      db, collections, split, N, inputFloats, outputsByCol
    );
    if (ev <= 0) return null;

    const profit = ev - totalCost;
    const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    if (roi < (options.minRoiThreshold ?? -100)) return null;

    const comboKey = genericComboKey(tier.comboKeyPrefix, collections, split);
    if (cooldownMap.has(comboKey)) return null;

    const avgFloat = allInputs.reduce((s, l) => s + l.float, 0) / allInputs.length;
    const avgRange = allInputs.reduce((s, l) => s + (l.maxFloat - l.minFloat), 0) / allInputs.length;
    const avgMinFloat = allInputs.reduce((s, l) => s + l.minFloat, 0) / allInputs.length;
    const adjustedFloat = avgRange > 0 ? (avgFloat - avgMinFloat) / avgRange : 0;

    // Build cumulative split boundaries to map listing index → collection
    const cumSplit: number[] = [];
    let cum = 0;
    for (const s of split) { cum += s; cumSplit.push(cum); }

    return {
      collections, split,
      inputSkins: allInputs.map((l, idx) => ({
        skinName: l.skinName,
        collection: collections[cumSplit.findIndex(c => idx < c)],
        priceCents: l.price, floatValue: l.float, condition,
      })),
      adjustedFloat,
      totalCostCents: totalCost,
      evCents: Math.round(ev),
      profitCents: Math.round(profit),
      roiPct: Math.round(roi * 100) / 100,
      outputCondition: floatToCondition(avgFloat),
      confidence: dataGaps.length === 0 ? 'high' : dataGaps.length <= 2 ? 'medium' : 'low',
      comboKey,
      outcomes,
    };
  }

  // Two-collection theories
  const maxPairs = Math.min(eligibleCollections.length, 30);
  for (let i = 0; i < maxPairs; i++) {
    for (let j = i + 1; j < maxPairs; j++) {
      const colA = eligibleCollections[i];
      const colB = eligibleCollections[j];

      for (let splitA = 1; splitA < N; splitA++) {
        const splitB = N - splitA;
        for (const condition of CONDITIONS_TO_SCAN) {
          const theory = evaluateCombo([colA, colB], [splitA, splitB], condition);
          if (theory) theories.push(theory);
        }
      }
    }
  }

  options.onProgress?.(`${label}: pairs done (${theories.length} theories)`);

  // Three-collection theories
  const maxTriples = Math.min(eligibleCollections.length, 25);
  let tripleCount = 0;
  const splitPatterns3 = N === 10
    ? [[8, 1, 1], [5, 3, 2], [4, 4, 2], [4, 3, 3]]
    : [[N - 2, 1, 1], [Math.ceil(N / 2), Math.floor(N / 4), N - Math.ceil(N / 2) - Math.floor(N / 4)]];
  for (let i = 0; i < maxTriples; i++) {
    for (let j = i + 1; j < maxTriples; j++) {
      for (let k = j + 1; k < maxTriples; k++) {
        const cols = [eligibleCollections[i], eligibleCollections[j], eligibleCollections[k]];

        for (const baseSplits of splitPatterns3) {
          const perms = new Set<string>();
          for (let p0 = 0; p0 < 3; p0++) {
            for (let p1 = 0; p1 < 3; p1++) {
              if (p1 === p0) continue;
              const p2 = 3 - p0 - p1;
              const split = [baseSplits[p0], baseSplits[p1], baseSplits[p2]];
              const key = split.join(",");
              if (perms.has(key)) continue;
              perms.add(key);

              for (const condition of CONDITIONS_TO_SCAN) {
                const theory = evaluateCombo(cols, split, condition);
                if (theory) { theories.push(theory); tripleCount++; }
              }
            }
          }
        }
      }
    }
  }

  options.onProgress?.(`${label}: triples done (+${tripleCount}, ${theories.length} total theories)`);

  // Sort by profit descending, deduplicate by comboKey (keep best per combo)
  theories.sort((a, b) => b.profitCents - a.profitCents);
  const bestPerCombo = new Map<string, ClassifiedTheory>();
  for (const t of theories) {
    if (!bestPerCombo.has(t.comboKey) || t.profitCents > bestPerCombo.get(t.comboKey)!.profitCents) {
      bestPerCombo.set(t.comboKey, t);
    }
  }

  const deduped = [...bestPerCombo.values()].sort((a, b) => b.profitCents - a.profitCents).slice(0, maxTheories);
  const profitable = deduped.filter(t => t.profitCents > 0).length;

  options.onProgress?.(`${label}: ${deduped.length} theories (${profitable} profitable)`);

  return deduped;
}

export function buildWantedListForTier(
  theories: ClassifiedTheory[],
  nearMisses?: NearMissInfo[]
): WantedListing[] {
  // Aggregate: which skins are needed, at what floats, with what priority?
  const skinMap = new Map<string, { collection: string; maxFloat: number; refPrice: number; priority: number }>();

  for (const theory of theories) {
    const weight = theory.profitCents > 0 ? 100 : Math.max(1, 50 + theory.profitCents / 100);
    for (const input of theory.inputSkins) {
      const key = `${input.skinName}:${input.collection}`;
      const existing = skinMap.get(key);
      if (!existing || weight > existing.priority) {
        skinMap.set(key, {
          collection: input.collection,
          maxFloat: input.floatValue + 0.05,
          refPrice: input.priceCents,
          priority: weight,
        });
      }
    }
  }

  // Near-miss boost
  if (nearMisses) {
    for (const nm of nearMisses) {
      const cols = nm.combo.split(",").map(c => c.trim());
      for (const col of cols) {
        // Boost all skins from near-miss collections
        for (const [key, entry] of skinMap) {
          if (entry.collection === col) {
            const boost = Math.min(200, Math.round(1000 / Math.max(nm.gap / 100, 1)));
            entry.priority += boost;
          }
        }
      }
    }
  }

  const wantedList: WantedListing[] = [];
  for (const [key, entry] of skinMap) {
    const skinName = key.split(":")[0];
    wantedList.push({
      skin_name: skinName,
      collection_name: entry.collection,
      target_float: entry.maxFloat - 0.05,
      max_float: entry.maxFloat,
      ref_price_cents: entry.refPrice,
      priority_score: entry.priority,
    });
  }

  wantedList.sort((a, b) => b.priority_score - a.priority_score);
  return wantedList;
}

export function saveTheoryTradeUpsForTier(db: Database.Database, theories: ClassifiedTheory[], tradeUpType: string = "classified_covert") {
  const lookupSkinId = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1");

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, combo_key, outcomes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    // Clear old theoretical trade-ups of this type only
    db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE is_theoretical = 1 AND type = ?)").run(tradeUpType);
    db.prepare("DELETE FROM trade_ups WHERE is_theoretical = 1 AND type = ?").run(tradeUpType);

    for (const theory of theories) {
      const chanceToProfit = theory.outcomes.reduce((sum, o) =>
        sum + (o.estimatedPriceCents > theory.totalCostCents ? o.probability : 0), 0
      );
      const posOutcomes = theory.outcomes.filter(o => o.estimatedPriceCents > 0);
      const bestCase = posOutcomes.length > 0
        ? Math.max(...posOutcomes.map(o => o.estimatedPriceCents)) - theory.totalCostCents : 0;
      const worstCase = posOutcomes.length > 0
        ? Math.min(...posOutcomes.map(o => o.estimatedPriceCents)) - theory.totalCostCents : -theory.totalCostCents;

      // Build outcomes JSON — normalize theory outcome field names to TradeUpOutcome
      const outcomesForJson = theory.outcomes
        .filter(o => o.estimatedPriceCents > 0 || o.probability > 0)
        .map(o => {
          const skinRow = lookupSkinId.get(o.skinName) as { id: string } | undefined;
          return {
            skin_id: skinRow?.id ?? "",
            skin_name: o.skinName,
            collection_name: o.collection,
            probability: o.probability,
            predicted_float: o.predictedFloat,
            predicted_condition: o.predictedCondition,
            estimated_price_cents: o.estimatedPriceCents,
          };
        });

      const result = insertTradeUp.run(
        theory.totalCostCents, theory.evCents, theory.profitCents,
        theory.roiPct, chanceToProfit, tradeUpType, bestCase, worstCase, theory.comboKey,
        JSON.stringify(outcomesForJson)
      );
      const tradeUpId = result.lastInsertRowid;

      for (const input of theory.inputSkins) {
        const skinRow = lookupSkinId.get(input.skinName) as { id: string } | undefined;
        insertInput.run(
          tradeUpId, "theoretical", skinRow?.id ?? "", input.skinName,
          input.collection, input.priceCents, input.floatValue, input.condition
        );
      }
    }
  });

  saveAll();
}

