/**
 * Knife theory engine — slightly optimistic screener.
 *
 * Theory identifies promising collection combos for validation by discovery.
 * Intentionally slightly optimistic: uses target float directly (not adjusted),
 * matches discovery's 2% seller fee (no extra uncertainty margin), and allows
 * thin-supply float ranges. This ensures profitable combos aren't missed.
 * False positives are acceptable — discovery validates with real listings.
 *
 * Uses priceAtFloat() chain (KNN → learned → interpolated → ref fallback)
 * to price inputs. Skips float < 0.01 (impossible).
 *
 * Flow: theory gen → buildWantedList() → daemon fetches INPUT listings → re-calc
 */

import Database from "better-sqlite3";
import { floatToCondition, type TradeUp } from "../../shared/types.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS, DOPPLER_PHASES, KNIFE_WEAPONS } from "./knife-data.js";
import { calculateOutputFloat } from "./core.js";
import { lookupPrice } from "./pricing.js";
import {
  getLearnedPrice, getInterpolatedPrice, getSupplyCount,
  isFloatUnavailable, knnPriceAtFloat, getKnnObservationCountBroad,
  getFloatBucket,
  clearKnnCache, clearSupplyCache, clearLearnedCache,
} from "./theory-validation.js";

export interface TheoryOutcome {
  skinName: string;
  probability: number;
  predictedFloat: number;
  predictedCondition: string;
  estimatedPriceCents: number;
}

export interface PessimisticTheory {
  collections: string[];
  split: number[];
  inputSkins: { skinName: string; collection: string; priceCents: number; floatValue: number; condition: string }[];
  adjustedFloat: number;
  totalCostCents: number;
  expectedValueCents: number;
  profitCents: number;
  roiPercentage: number;
  outcomeCount: number;
  outcomes: TheoryOutcome[];
  dataGaps: string[];
}

export interface DataGap {
  skinName: string;
  conditions: string[];
  isInput: boolean;
  theoriesAffected: number;
  maxPotentialProfit: number;
  priority: number;
}

export interface WantedListing {
  skin_name: string;
  collection_name: string;
  target_float: number;
  max_float: number;
  ref_price_cents: number;
  priority_score: number;
}

interface CovertSkin {
  id: string;
  name: string;
  collection: string;
  collectionId: string;
  minFloat: number;
  maxFloat: number;
  refPrices: Record<string, number>;
}

interface FinishInfo {
  name: string;
  minFloat: number;
  maxFloat: number;
}

interface TheoryListing {
  id: string;
  skin_name: string;
  weapon: string;
  collection_name: string;
  price_cents: number;
  float_value: number;
  min_float: number;
  max_float: number;
  adjustedFloat: number;
}

// No seller fee or discount — theory is an optimistic screener.
// Discovery applies the real 2% fee during validation.
// This gives theory ~2% overestimate on outputs, ensuring profitable combos aren't missed.
const OUTPUT_DISCOUNT = 1.0;
const MIN_SUPPLY_FOR_THEORY = 1; // allow thin supply — theory is a screener, not a predictor

// Float scan: dense for singles, medium for pairs
const SCAN_POINTS_DENSE: number[] = (() => {
  const pts: number[] = [];
  for (let t = 0.01; t < 1.0; t = Math.round((t + 0.005) * 100000) / 100000) pts.push(t);
  return pts;
})();

const SCAN_POINTS_MEDIUM: number[] = (() => {
  const pts: number[] = [];
  for (let t = 0.02; t < 1.0; t = Math.round((t + 0.02) * 100000) / 100000) pts.push(t);
  return pts;
})();

const SCAN_POINTS_COARSE: number[] = (() => {
  const pts: number[] = [];
  for (let t = 0.05; t < 1.0; t = Math.round((t + 0.05) * 100000) / 100000) pts.push(t);
  return pts;
})();

const _lpCache = new Map<string, number>();

function lp(db: Database.Database, skinName: string, float: number): number {
  const key = `${skinName}:${floatToCondition(float)}`;
  if (_lpCache.has(key)) return _lpCache.get(key)!;
  const price = lookupPrice(db, skinName, float);
  _lpCache.set(key, price);
  return price;
}

const COND_RANGES = [
  { name: "Factory New", min: 0.0, max: 0.07 },
  { name: "Minimal Wear", min: 0.07, max: 0.15 },
  { name: "Field-Tested", min: 0.15, max: 0.38 },
  { name: "Well-Worn", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", min: 0.45, max: 1.0 },
];

function refPriceFallback(float: number, refPrices: Record<string, number>): number | null {
  for (const cond of COND_RANGES) {
    if (float < cond.max || cond.name === "Battle-Scarred") {
      const price = refPrices[cond.name];
      return (price && price > 0) ? price : null;
    }
  }
  return null;
}

/**
 * Price a Covert skin input at a specific float.
 *
 * Philosophy: For INPUTS (what we buy), float-precise sale data is ground truth.
 * Sales are validated by buyers spending real money at specific floats.
 * Listings are secondary — they show seller's ask, not market price.
 *
 * Priority:
 *   1. KNN from price_observations (59K+ sales — richest, most precise data)
 *   2. Float-bucket averages (precomputed from listings, good when KNN sparse)
 *   3. Nth-cheapest listing at this condition (actual order book)
 *   4. Condition-level ref fallback (coarsest, last resort)
 *
 * No skinport — unreliable for precision pricing.
 */
function priceAtFloat(
  db: Database.Database,
  skinName: string,
  float: number,
  refPrices: Record<string, number>
): number | null {
  if (isFloatUnavailable(db, skinName, float)) return null;

  const supply = getSupplyCount(db, skinName, float);
  if (supply > 0 && supply < MIN_SUPPLY_FOR_THEORY) return null;

  // 1. KNN from price_observations — sale-weighted, float-precise
  // Sales are the strongest signal: real money at real floats.
  const knnPrice = knnPriceAtFloat(db, skinName, float);
  if (knnPrice !== null) return knnPrice;

  // 2. Float-bucket price from float_price_data (listing averages per float range)
  const bucketPrice = getFloatBucketPrice(db, skinName, float);
  if (bucketPrice !== null) return bucketPrice;

  // 3. Real learned price (listing-derived bucket data)
  const realLearned = getLearnedPrice(db, skinName, float, { realOnly: true });
  if (realLearned !== null) return realLearned;

  // Price void detection: if we have many observations nearby but none yielded
  // a KNN price, this float range is likely genuinely priceless (no supply)
  const broadObs = getKnnObservationCountBroad(db, skinName, float);
  if (broadObs >= 5) return null;

  // 4. Interpolated from adjacent buckets
  const interpolated = getInterpolatedPrice(db, skinName, float);
  if (interpolated !== null) return interpolated;

  // 5. Last resort: condition-level ref (no skinport — CSFloat data only)
  return refPriceFallback(float, refPrices);
}

function loadCovertSkins(db: Database.Database): Map<string, CovertSkin[]> {
  const knifeWeaponSet = new Set(KNIFE_WEAPONS as readonly string[]);

  const rows = db.prepare(`
    SELECT s.id, s.name, s.min_float, s.max_float, s.weapon,
      c.name as collection_name, c.id as collection_id
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0
  `).all() as { id: string; name: string; min_float: number; max_float: number; weapon: string; collection_name: string; collection_id: string }[];

  // Load ref prices per skin (CSFloat only — no skinport/steam noise)
  const priceRows = db.prepare(`
    SELECT skin_name, condition, avg_price_cents, source
    FROM price_data WHERE avg_price_cents > 0
      AND source IN ('csfloat_sales', 'csfloat_ref')
    ORDER BY CASE source
      WHEN 'csfloat_sales' THEN 1
      WHEN 'csfloat_ref' THEN 2
      ELSE 3
    END
  `).all() as { skin_name: string; condition: string; avg_price_cents: number; source: string }[];

  const refMap = new Map<string, Record<string, number>>();
  for (const p of priceRows) {
    let prices = refMap.get(p.skin_name);
    if (!prices) { prices = {}; refMap.set(p.skin_name, prices); }
    if (!(p.condition in prices)) prices[p.condition] = p.avg_price_cents;
  }

  const byCollection = new Map<string, CovertSkin[]>();
  for (const r of rows) {
    if (knifeWeaponSet.has(r.weapon)) continue; // Skip knife/glove skins
    if (!CASE_KNIFE_MAP[r.collection_name]) continue;

    const list = byCollection.get(r.collection_name) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      collection: r.collection_name,
      collectionId: r.collection_id,
      minFloat: r.min_float,
      maxFloat: r.max_float,
      refPrices: refMap.get(r.name) ?? {},
    });
    byCollection.set(r.collection_name, list);
  }
  return byCollection;
}

function loadFinishes(db: Database.Database): Map<string, FinishInfo[]> {
  const weapons = new Set<string>();
  for (const cm of Object.values(CASE_KNIFE_MAP)) {
    for (const w of cm.knifeTypes) weapons.add(w);
    if (cm.gloveGen) {
      for (const g of Object.keys(GLOVE_GEN_SKINS[cm.gloveGen] ?? {})) weapons.add(g);
    }
  }

  const byWeapon = new Map<string, FinishInfo[]>();
  for (const weapon of weapons) {
    const skins = db.prepare(
      "SELECT DISTINCT name, min_float, max_float FROM skins WHERE weapon = ? AND stattrak = 0"
    ).all(weapon) as { name: string; min_float: number; max_float: number }[];
    byWeapon.set(weapon, skins.map(s => ({ name: s.name, minFloat: s.min_float, maxFloat: s.max_float })));
  }
  return byWeapon;
}

function evalKnifePool(
  db: Database.Database,
  collections: string[],
  inputCounts: number[],
  inputFloats: { float_value: number; min_float: number; max_float: number }[],
  finishCache: Map<string, FinishInfo[]>
): { ev: number; outcomes: TheoryOutcome[]; dataGaps: string[] } {
  let totalEv = 0;
  const outcomes: TheoryOutcome[] = [];
  const dataGaps: string[] = [];

  for (let ci = 0; ci < collections.length; ci++) {
    const colName = collections[ci];
    const caseInfo = CASE_KNIFE_MAP[colName];
    if (!caseInfo) continue;

    const colWeight = inputCounts[ci] / 5;
    const allFinishes: (FinishInfo & { itemType: string })[] = [];

    // Knife finishes
    if (caseInfo.knifeTypes.length > 0 && caseInfo.knifeFinishes.length > 0) {
      const allowed = new Set(caseInfo.knifeFinishes);
      for (const knifeType of caseInfo.knifeTypes) {
        for (const f of finishCache.get(knifeType) ?? []) {
          const finishName = f.name.includes(" | ") ? f.name.split(" | ")[1] : null;
          if (finishName ? allowed.has(finishName) : allowed.has("Vanilla")) {
            allFinishes.push({ ...f, itemType: knifeType });
          }
        }
      }
    }

    // Glove finishes
    if (caseInfo.gloveGen) {
      const genSkins = GLOVE_GEN_SKINS[caseInfo.gloveGen];
      if (genSkins) {
        for (const [gloveType, finishNames] of Object.entries(genSkins)) {
          const allowedNames = new Set(finishNames.map(f => `★ ${gloveType} | ${f}`));
          for (const f of finishCache.get(gloveType) ?? []) {
            if (allowedNames.has(f.name)) allFinishes.push({ ...f, itemType: gloveType });
          }
        }
      }
    }

    if (allFinishes.length === 0) continue;
    const perFinishProb = colWeight / allFinishes.length;

    for (const finish of allFinishes) {
      const rawFloat = calculateOutputFloat(inputFloats, finish.minFloat, finish.maxFloat);
      const predFloat = rawFloat;
      const predCondition = floatToCondition(predFloat);
      const finishPart = finish.name.includes(" | ") ? finish.name.split(" | ")[1] : null;
      const dopplerPhases = finishPart ? DOPPLER_PHASES[finishPart] : undefined;

      if (dopplerPhases) {
        // Per-phase Doppler pricing
        const phaseEntries: { name: string; prob: number; price: number }[] = [];
        for (const { phase, weight: phaseWeight } of dopplerPhases) {
          const phaseName = `${finish.name} ${phase}`;
          const price = lp(db, phaseName, predFloat);
          if (price <= 0) continue;
          phaseEntries.push({ name: phaseName, prob: perFinishProb * phaseWeight, price });
        }
        if (phaseEntries.length === 0) {
          dataGaps.push(finish.name);
          continue;
        }

        // Collapse if all same price (fell back to base Doppler)
        const allSamePrice = phaseEntries.every(e => e.price === phaseEntries[0].price);
        if (allSamePrice) {
          const totalProb = phaseEntries.reduce((s, e) => s + e.prob, 0);
          const price = phaseEntries[0].price;
          totalEv += totalProb * price;
          outcomes.push({
            skinName: finish.name, probability: totalProb, predictedFloat: predFloat,
            predictedCondition: predCondition, estimatedPriceCents: price,
          });
        } else {
          for (const entry of phaseEntries) {
            totalEv += entry.prob * entry.price;
            outcomes.push({
              skinName: entry.name, probability: entry.prob, predictedFloat: predFloat,
              predictedCondition: predCondition, estimatedPriceCents: entry.price,
            });
          }
        }
      } else {
        const price = lp(db, finish.name, predFloat);
        if (price <= 0) {
          dataGaps.push(finish.name);
          continue;
        }
        totalEv += perFinishProb * price;
        outcomes.push({
          skinName: finish.name, probability: perFinishProb, predictedFloat: predFloat,
          predictedCondition: predCondition, estimatedPriceCents: price,
        });
      }
    }
  }

  // Merge duplicate outcomes (same skin from multiple collections sharing a knife/glove pool)
  const mergedMap = new Map<string, TheoryOutcome>();
  for (const o of outcomes) {
    const key = `${o.skinName}:${o.predictedCondition}`;
    const existing = mergedMap.get(key);
    if (existing) {
      existing.probability += o.probability;
    } else {
      mergedMap.set(key, { ...o });
    }
  }
  const mergedOutcomes = [...mergedMap.values()];

  // Apply seller fee + pricing uncertainty discount
  return {
    ev: totalEv * OUTPUT_DISCOUNT,
    outcomes: mergedOutcomes.map(o => ({ ...o, estimatedPriceCents: Math.round(o.estimatedPriceCents * OUTPUT_DISCOUNT) })),
    dataGaps: [...new Set(dataGaps)],
  };
}

const _bucketPriceCache = new Map<string, number | null>();

/**
 * Get price from float_price_data buckets — our most accurate float-specific data.
 * These are precomputed averages from actual listings within each float range.
 * Requires listing_count >= 3 to filter noise.
 */
function getFloatBucketPrice(db: Database.Database, skinName: string, float: number): number | null {
  const key = `${skinName}:${float.toFixed(4)}`;
  if (_bucketPriceCache.has(key)) return _bucketPriceCache.get(key)!;

  const row = db.prepare(`
    SELECT avg_price_cents, listing_count FROM float_price_data
    WHERE skin_name = ? AND float_min <= ? AND float_max > ?
      AND listing_count >= 3
    LIMIT 1
  `).get(skinName, float, float) as { avg_price_cents: number; listing_count: number } | undefined;

  const price = row ? row.avg_price_cents : null;
  _bucketPriceCache.set(key, price);
  return price;
}

// Uses float_price_data buckets for float-aware floors, falls back to
// condition-level cheapest when no bucket data exists.
// For N copies, uses Nth-cheapest listing to account for order book depth.
let _listingFloorCache: Map<string, number> | null = null;

function getListingFloors(db: Database.Database): Map<string, number> {
  if (_listingFloorCache) return _listingFloorCache;

  _listingFloorCache = new Map();

  // Get cheapest non-stattrak listing per skin per condition
  const rows = db.prepare(`
    SELECT s.name, l.float_value, l.price_cents
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE l.stattrak = 0 AND l.price_cents > 0 AND s.rarity = 'Covert'
    ORDER BY s.name, l.price_cents ASC
  `).all() as { name: string; float_value: number; price_cents: number }[];

  for (const r of rows) {
    const cond = floatToCondition(r.float_value);
    const key = `${r.name}:${cond}`;
    // First row per key is cheapest (ordered by price ASC)
    if (!_listingFloorCache.has(key)) {
      _listingFloorCache.set(key, r.price_cents);
    }
  }

  return _listingFloorCache;
}

let _nthCheapestCache: Map<string, number[]> | null = null;

/**
 * Get the Nth cheapest listing price for a skin+condition.
 * When theory needs N copies, it should use the Nth cheapest, not the floor.
 */
function getNthCheapestPrice(db: Database.Database, skinName: string, condition: string, n: number): number | null {
  if (!_nthCheapestCache) {
    _nthCheapestCache = new Map();
    const rows = db.prepare(`
      SELECT s.name, l.float_value, l.price_cents
      FROM listings l
      JOIN skins s ON l.skin_id = s.id
      WHERE l.stattrak = 0 AND l.price_cents > 0 AND s.rarity = 'Covert'
      ORDER BY s.name, l.price_cents ASC
    `).all() as { name: string; float_value: number; price_cents: number }[];

    for (const r of rows) {
      const cond = floatToCondition(r.float_value);
      const key = `${r.name}:${cond}`;
      const list = _nthCheapestCache.get(key) ?? [];
      list.push(r.price_cents);
      _nthCheapestCache.set(key, list);
    }
  }

  const key = `${skinName}:${condition}`;
  const prices = _nthCheapestCache.get(key);
  if (!prices || prices.length === 0) return null;
  // Return Nth cheapest (0-indexed), or last if not enough listings
  return prices[Math.min(n - 1, prices.length - 1)];
}

/**
 * Load all Covert gun listings from DB with adjusted floats, grouped by collection.
 * Used by deep scan to estimate costs from real purchasable listings instead of
 * statistical price estimates. Pre-sorted by price ASC within each collection.
 */
function preloadListings(db: Database.Database): Map<string, TheoryListing[]> {
  const knifeWeaponSet = new Set(KNIFE_WEAPONS as readonly string[]);

  const rows = db.prepare(`
    SELECT l.id, s.name as skin_name, s.weapon, c.name as collection_name,
      l.price_cents, l.float_value, s.min_float, s.max_float
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = 'Covert' AND l.stattrak = 0
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      AND l.price_cents > 0
    ORDER BY l.price_cents ASC
  `).all() as { id: string; skin_name: string; weapon: string; collection_name: string;
    price_cents: number; float_value: number; min_float: number; max_float: number }[];

  const byCol = new Map<string, TheoryListing[]>();
  for (const r of rows) {
    if (knifeWeaponSet.has(r.weapon)) continue;
    if (!CASE_KNIFE_MAP[r.collection_name]) continue;
    const range = r.max_float - r.min_float;
    const listing: TheoryListing = {
      ...r,
      adjustedFloat: range > 0 ? (r.float_value - r.min_float) / range : 0,
    };
    const list = byCol.get(r.collection_name) ?? [];
    list.push(listing);
    byCol.set(r.collection_name, list);
  }

  return byCol;
}

/**
 * Compute normalized float values where output condition transitions occur.
 *
 * For each knife/glove finish in the combo's output pool:
 *   outputFloat = finishMinFloat + avgNorm * (finishMaxFloat - finishMinFloat)
 *   avgNorm_boundary = (conditionBoundary - finishMinFloat) / (finishMaxFloat - finishMinFloat)
 *
 * Scanning just below a boundary produces a better condition output, potentially
 * worth 50-100%+ more. Returns sorted unique boundary-adjacent scan points.
 */
export function getKnifeConditionBoundaries(
  collections: string[],
  finishCache: Map<string, FinishInfo[]>
): number[] {
  const condBoundaryFloats = [0.07, 0.15, 0.38, 0.45]; // FN|MW, MW|FT, FT|WW, WW|BS
  const points = new Set<number>();

  for (const colName of collections) {
    const caseInfo = CASE_KNIFE_MAP[colName];
    if (!caseInfo) continue;

    const allFinishes: FinishInfo[] = [];
    if (caseInfo.knifeTypes.length > 0 && caseInfo.knifeFinishes.length > 0) {
      const allowed = new Set(caseInfo.knifeFinishes);
      for (const knifeType of caseInfo.knifeTypes) {
        for (const f of finishCache.get(knifeType) ?? []) {
          const finishName = f.name.includes(" | ") ? f.name.split(" | ")[1] : null;
          if (finishName ? allowed.has(finishName) : allowed.has("Vanilla")) {
            allFinishes.push(f);
          }
        }
      }
    }
    if (caseInfo.gloveGen) {
      const genSkins = GLOVE_GEN_SKINS[caseInfo.gloveGen];
      if (genSkins) {
        for (const [gloveType, finishNames] of Object.entries(genSkins)) {
          const allowedNames = new Set(finishNames.map(f => `★ ${gloveType} | ${f}`));
          for (const f of finishCache.get(gloveType) ?? []) {
            if (allowedNames.has(f.name)) allFinishes.push(f);
          }
        }
      }
    }

    for (const finish of allFinishes) {
      const range = finish.maxFloat - finish.minFloat;
      if (range <= 0) continue;
      for (const boundary of condBoundaryFloats) {
        const avgNorm = (boundary - finish.minFloat) / range;
        if (avgNorm > 0.01 && avgNorm < 0.99) {
          // Just below boundary = better condition output
          points.add(Math.round((avgNorm - 0.003) * 10000) / 10000);
          // Just above boundary = worse condition (for cost comparison)
          points.add(Math.round((avgNorm + 0.003) * 10000) / 10000);
        }
      }
    }
  }

  return [...points].filter(p => p > 0.01 && p < 1.0).sort((a, b) => a - b);
}

function estimateInputs(
  db: Database.Database,
  skinsByCol: Map<string, CovertSkin[]>,
  collections: string[],
  inputCounts: number[],
  targetNorm: number,
): {
  cost: number;
  inputSkins: { skinName: string; collection: string; priceCents: number; floatValue: number; condition: string }[];
  inputFloats: { float_value: number; min_float: number; max_float: number }[];
} | null {
  const inputSkins: PessimisticTheory["inputSkins"] = [];
  const inputFloats: { float_value: number; min_float: number; max_float: number }[] = [];
  let totalCost = 0;

  // Condition midpoint norms for mixing (within [0,1] normalized range)
  const COND_NORMS = [
    { name: "Factory New", norm: 0.035 },
    { name: "Minimal Wear", norm: 0.11 },
    { name: "Field-Tested", norm: 0.265 },
    { name: "Well-Worn", norm: 0.415 },
    { name: "Battle-Scarred", norm: 0.725 },
  ];

  for (let ci = 0; ci < collections.length; ci++) {
    const colName = collections[ci];
    const count = inputCounts[ci];
    const skins = skinsByCol.get(colName);
    if (!skins || skins.length === 0) return null;

    // For each skin, get price at each condition midpoint
    type SkinOption = { skin: CovertSkin; condPrices: { cond: typeof COND_NORMS[0]; price: number; targetFloat: number }[] };
    const skinOptions: SkinOption[] = [];

    for (const skin of skins) {
      const condPrices: SkinOption["condPrices"] = [];
      for (const cn of COND_NORMS) {
        const targetFloat = cn.norm * (skin.maxFloat - skin.minFloat) + skin.minFloat;
        if (targetFloat < skin.minFloat || targetFloat > skin.maxFloat) continue;
        let price = priceAtFloat(db, skin.name, targetFloat, skin.refPrices);
        if (!price) price = getNthCheapestPrice(db, skin.name, cn.name, 1);
        if (price) condPrices.push({ cond: cn, price, targetFloat });
      }
      if (condPrices.length > 0) skinOptions.push({ skin, condPrices });
    }

    if (skinOptions.length === 0) return null;

    // Strategy 1: uniform float (all inputs at targetNorm)
    // Uses priceAtFloat for the base price (KNN/bucket-aware), then adds
    // a depth premium per copy — buying 5 at a specific float costs more
    // than 5x the floor. We use the condition-level order book for depth
    // ratios but anchor to the float-precise base price.
    let bestMix: { skin: CovertSkin; inputs: { price: number; float: number; condition: string }[]; cost: number } | null = null;

    for (const opt of skinOptions) {
      const targetFloat = targetNorm * (opt.skin.maxFloat - opt.skin.minFloat) + opt.skin.minFloat;
      const condition = floatToCondition(targetFloat);
      const basePrice = priceAtFloat(db, opt.skin.name, targetFloat, opt.skin.refPrices);
      if (!basePrice) continue;

      const inputs: { price: number; float: number; condition: string }[] = [];
      let mixCost = 0;

      // Use condition-level order book to estimate depth premium
      const floor = getNthCheapestPrice(db, opt.skin.name, condition, 1);
      for (let i = 0; i < count; i++) {
        let p: number;
        if (floor && floor > 0) {
          // Scale base price by the ratio of Nth-cheapest to floor
          const nth = getNthCheapestPrice(db, opt.skin.name, condition, i + 1);
          const ratio = nth ? nth / floor : 1 + i * 0.02; // ~2% premium per copy if no data
          p = Math.round(basePrice * ratio);
        } else {
          p = Math.round(basePrice * (1 + i * 0.02)); // ~2% premium per copy
        }
        inputs.push({ price: p, float: targetFloat, condition });
        mixCost += p;
      }
      if (!bestMix || mixCost < bestMix.cost) {
        bestMix = { skin: opt.skin, inputs, cost: mixCost };
      }
    }

    // Strategy 2: mixed-condition — try mixes of 2 conditions that average to targetNorm
    // For count inputs, try (a inputs at cond1, count-a at cond2) where avg(norms) ≈ targetNorm
    for (const opt of skinOptions) {
      if (opt.condPrices.length < 2) continue;
      for (let ci1 = 0; ci1 < opt.condPrices.length; ci1++) {
        for (let ci2 = ci1 + 1; ci2 < opt.condPrices.length; ci2++) {
          const c1 = opt.condPrices[ci1];
          const c2 = opt.condPrices[ci2];
          // Solve: (a * c1.norm + (count - a) * c2.norm) / count = targetNorm
          // a = count * (targetNorm - c2.norm) / (c1.norm - c2.norm)
          const denom = c1.cond.norm - c2.cond.norm;
          if (Math.abs(denom) < 0.001) continue;
          const aExact = count * (targetNorm - c2.cond.norm) / denom;
          // Try both floor and ceil to find best integer split
          for (const a of [Math.floor(aExact), Math.ceil(aExact)]) {
            if (a < 0 || a > count) continue;
            const b = count - a;

            // Compute actual avg norm with this integer split
            const actualAvgNorm = (a * c1.cond.norm + b * c2.cond.norm) / count;
            // Allow ±0.01 tolerance — small deviation acceptable for cost savings
            if (Math.abs(actualAvgNorm - targetNorm) > 0.01) continue;

            // Price: float-precise base with depth premium from order book
            let mixCost = 0;
            const inputs: { price: number; float: number; condition: string }[] = [];

            const floor1 = getNthCheapestPrice(db, opt.skin.name, c1.cond.name, 1);
            for (let i = 0; i < a; i++) {
              let p: number;
              if (floor1 && floor1 > 0) {
                const nth = getNthCheapestPrice(db, opt.skin.name, c1.cond.name, i + 1);
                const ratio = nth ? nth / floor1 : 1 + i * 0.02;
                p = Math.round(c1.price * ratio);
              } else {
                p = Math.round(c1.price * (1 + i * 0.02));
              }
              inputs.push({ price: p, float: c1.targetFloat, condition: c1.cond.name });
              mixCost += p;
            }
            const floor2 = getNthCheapestPrice(db, opt.skin.name, c2.cond.name, 1);
            for (let i = 0; i < b; i++) {
              let p: number;
              if (floor2 && floor2 > 0) {
                const nth = getNthCheapestPrice(db, opt.skin.name, c2.cond.name, i + 1);
                const ratio = nth ? nth / floor2 : 1 + i * 0.02;
                p = Math.round(c2.price * ratio);
              } else {
                p = Math.round(c2.price * (1 + i * 0.02));
              }
              inputs.push({ price: p, float: c2.targetFloat, condition: c2.cond.name });
              mixCost += p;
            }

            if (!bestMix || mixCost < bestMix.cost) {
              bestMix = { skin: opt.skin, inputs, cost: mixCost };
            }
          }
        }
      }
    }

    if (!bestMix) return null;

    for (const inp of bestMix.inputs) {
      inputSkins.push({
        skinName: bestMix.skin.name,
        collection: colName,
        priceCents: inp.price,
        floatValue: inp.float,
        condition: inp.condition,
      });
      inputFloats.push({
        float_value: inp.float,
        min_float: bestMix.skin.minFloat,
        max_float: bestMix.skin.maxFloat,
      });
      totalCost += inp.price;
    }
  }

  if (inputFloats.length !== inputCounts.reduce((s, c) => s + c, 0)) return null;
  return { cost: totalCost, inputSkins, inputFloats };
}

/**
 * Estimate inputs using real DB listings instead of statistical prices.
 *
 * Key advantages over estimateInputs():
 *   1. Uses actual listing prices — no statistical estimation error
 *   2. Can mix conditions within a collection (e.g., 2 MW + 3 FT) if cheaper
 *      while staying within float budget — finds combos pure-condition misses
 *   3. Uses real float values for output calculation — no assumed target float
 *
 * Selection: price-greedy with float budget constraint. Pools all eligible
 * listings, sorts by price, greedily picks respecting per-collection quotas
 * and keeping avg adjusted float ≤ target.
 */
function estimateInputsFromListings(
  listingsByCol: Map<string, TheoryListing[]>,
  collections: string[],
  inputCounts: number[],
  targetNorm: number,
): {
  cost: number;
  inputSkins: PessimisticTheory["inputSkins"];
  inputFloats: { float_value: number; min_float: number; max_float: number }[];
} | null {
  const count = inputCounts.reduce((s, c) => s + c, 0);
  const totalBudget = count * targetNorm;

  // Build quotas map
  const quotas = new Map<string, number>();
  for (let ci = 0; ci < collections.length; ci++) {
    quotas.set(collections[ci], inputCounts[ci]);
  }

  // Merge eligible listings from all collections
  const candidates: TheoryListing[] = [];
  for (const [col, quota] of quotas) {
    const pool = listingsByCol.get(col);
    if (!pool || pool.length < quota) return null;
    for (const l of pool) {
      if (l.adjustedFloat <= totalBudget) candidates.push(l);
    }
  }

  // Price-greedy: sort by price ascending
  candidates.sort((a, b) => a.price_cents - b.price_cents);

  // Greedy selection respecting quotas and float budget
  const picked = new Map<string, number>();
  const result: TheoryListing[] = [];
  let usedFloat = 0;
  const usedIds = new Set<string>();

  for (const l of candidates) {
    if (result.length >= count) break;
    const colQuota = quotas.get(l.collection_name);
    if (colQuota === undefined) continue;
    const colPicked = picked.get(l.collection_name) ?? 0;
    if (colPicked >= colQuota) continue;
    if (usedIds.has(l.id)) continue;
    if (usedFloat + l.adjustedFloat <= totalBudget) {
      result.push(l);
      usedFloat += l.adjustedFloat;
      picked.set(l.collection_name, colPicked + 1);
      usedIds.add(l.id);
    }
  }

  // Verify all quotas met
  for (const [col, quota] of quotas) {
    if ((picked.get(col) ?? 0) < quota) return null;
  }
  if (result.length !== count) return null;

  const inputSkins: PessimisticTheory["inputSkins"] = result.map(l => ({
    skinName: l.skin_name,
    collection: l.collection_name,
    priceCents: l.price_cents,
    floatValue: l.float_value,
    condition: floatToCondition(l.float_value),
  }));

  const inputFloats = result.map(l => ({
    float_value: l.float_value,
    min_float: l.min_float,
    max_float: l.max_float,
  }));

  return { cost: result.reduce((s, l) => s + l.price_cents, 0), inputSkins, inputFloats };
}

/**
 * Keep the best theory per collection combo signature.
 * Includes negative-profit theories because:
 *   1. Prices fluctuate — today's -$50 could be +$50 tomorrow
 *   2. Pessimistic pricing overestimates costs → real combos may be cheaper
 *   3. High-variance combos (FN gloves) have huge upside even with negative EV
 *   4. Theory guides API spend — we need to fetch data for near-miss combos too
 */
export interface TheoryGenOptions {
  onProgress?: (msg: string) => void;
  maxTheories?: number;           // Default 5000
  minRoiThreshold?: number;       // Default -100
  /** Focus on theories within this cost range (cents). Gets 60% of slots. */
  budgetRange?: { minCents: number; maxCents: number };
  /** Cooldown map: combo_keys currently on cooldown (from theory_tracking). Skipped during generation. */
  cooldownMap?: Map<string, { status: string; gap: number; cooldownUntil: string }>;
}

/**
 * Build a stable combo key from collections + split.
 * Sorted so order doesn't matter.
 */
export function theoryComboKey(collections: string[], split: number[]): string {
  return collections.map((c, i) => `${c}:${split[i]}`).sort().join("|");
}

export function generatePessimisticKnifeTheories(
  db: Database.Database,
  options: TheoryGenOptions = {}
): PessimisticTheory[] {
  const MAX_THEORIES = options.maxTheories ?? 5000;
  const MIN_ROI_THRESHOLD = options.minRoiThreshold ?? -100;
  const cooldownMap = options.cooldownMap;
  let skippedByCooldown = 0;
  _lpCache.clear();
  _listingFloorCache = null;
  _bucketPriceCache.clear();
  _nthCheapestCache = null;
  clearKnnCache();
  clearSupplyCache();
  clearLearnedCache();

  options.onProgress?.("Loading data...");
  const skinsByCol = loadCovertSkins(db);
  const finishCache = loadFinishes(db);

  const knifeCollections = [...skinsByCol.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });

  console.log(`  Theory: ${knifeCollections.length} knife collections, float-aware pricing`);

  // Track best theory per combo signature (collections + split + condition profile)
  const bestByCombo = new Map<string, PessimisticTheory>();

  const maybeAdd = (t: PessimisticTheory) => {
    // Skip combos with terrible ROI (too negative to ever become profitable)
    if (t.totalCostCents > 0 && t.roiPercentage < MIN_ROI_THRESHOLD) return;
    // Skip if no outcomes priced
    if (t.outcomes.length === 0) return;

    // Skip combos on cooldown (recently validated as unprofitable)
    if (cooldownMap) {
      const ck = theoryComboKey(t.collections, t.split);
      const cd = cooldownMap.get(ck);
      if (cd && new Date(cd.cooldownUntil) > new Date()) {
        skippedByCooldown++;
        return;
      }
    }

    const sig = `${t.collections.join("+")}:${t.split.join("/")}:${t.outcomes.map(o => `${o.skinName}:${o.predictedCondition}`).sort().join("|")}`;
    const existing = bestByCombo.get(sig);
    if (!existing || t.profitCents > existing.profitCents) {
      bestByCombo.set(sig, t);
    }
  };

  const makeTheory = (
    collections: string[], split: number[],
    est: NonNullable<ReturnType<typeof estimateInputs>>,
    ev: number, outcomes: TheoryOutcome[], dataGaps: string[]
  ): PessimisticTheory => {
    const profit = Math.round(ev) - est.cost;
    return {
      collections, split,
      inputSkins: est.inputSkins,
      adjustedFloat: 0, // Set by caller
      totalCostCents: est.cost,
      expectedValueCents: Math.round(ev),
      profitCents: profit,
      roiPercentage: est.cost > 0 ? (profit / est.cost) * 100 : 0,
      outcomeCount: outcomes.length,
      outcomes,
      dataGaps,
    };
  };

  // Singles: each collection x dense scan
  options.onProgress?.("Theory: scanning singles...");
  let evaluated = 0;
  let profitable = 0;

  for (const colName of knifeCollections) {
    for (const T of SCAN_POINTS_DENSE) {
      const est = estimateInputs(db, skinsByCol, [colName], [5], T);
      if (!est) continue;

      const { ev, outcomes, dataGaps } = evalKnifePool(
        db, [colName], [5], est.inputFloats, finishCache
      );

      evaluated++;
      const theory = makeTheory([colName], [5], est, ev, outcomes, dataGaps);
      theory.adjustedFloat = T;
      if (theory.profitCents > 0) profitable++;
      maybeAdd(theory);
    }
  }
  options.onProgress?.(`Theory: ${evaluated} singles scanned, ${profitable} profitable, ${bestByCombo.size} kept`);

  // Pairs: all C(n,2) x 4 splits x medium scan
  options.onProgress?.("Theory: scanning pairs...");
  const pairsBefore = bestByCombo.size;

  for (let i = 0; i < knifeCollections.length; i++) {
    for (let j = i + 1; j < knifeCollections.length; j++) {
      const colA = knifeCollections[i];
      const colB = knifeCollections[j];

      for (const countA of [1, 2, 3, 4]) {
        const countB = 5 - countA;

        for (const T of SCAN_POINTS_MEDIUM) {
          const est = estimateInputs(db, skinsByCol, [colA, colB], [countA, countB], T);
          if (!est) continue;

          const { ev, outcomes, dataGaps } = evalKnifePool(
            db, [colA, colB], [countA, countB], est.inputFloats, finishCache
          );

          evaluated++;
          const theory = makeTheory([colA, colB], [countA, countB], est, ev, outcomes, dataGaps);
          theory.adjustedFloat = T;
          if (theory.profitCents > 0) profitable++;
          maybeAdd(theory);
        }
      }
    }
  }

  const pairTheories = bestByCombo.size - pairsBefore;
  options.onProgress?.(`Theory: ${pairTheories} pair combos, ${bestByCombo.size} total kept`);

  // Triples: top N collections x split patterns x coarse scan
  options.onProgress?.("Theory: scanning triples...");
  const triplesBefore = bestByCombo.size;
  const maxTripleCol = Math.min(knifeCollections.length, 20);

  for (let i = 0; i < maxTripleCol; i++) {
    for (let j = i + 1; j < maxTripleCol; j++) {
      for (let k = j + 1; k < maxTripleCol; k++) {
        const cols = [knifeCollections[i], knifeCollections[j], knifeCollections[k]];

        // Split patterns for 5 inputs across 3 collections
        const splitPatterns = [[3, 1, 1], [2, 2, 1]];
        for (const baseSplits of splitPatterns) {
          // Generate unique permutations
          const perms = new Set<string>();
          for (let p0 = 0; p0 < 3; p0++) {
            for (let p1 = 0; p1 < 3; p1++) {
              if (p1 === p0) continue;
              const p2 = 3 - p0 - p1;
              const split = [baseSplits[p0], baseSplits[p1], baseSplits[p2]];
              const key = split.join(",");
              if (perms.has(key)) continue;
              perms.add(key);

              for (const T of SCAN_POINTS_COARSE) {
                const est = estimateInputs(db, skinsByCol, cols, split, T);
                if (!est) continue;

                const { ev, outcomes, dataGaps } = evalKnifePool(
                  db, cols, split, est.inputFloats, finishCache
                );

                evaluated++;
                const theory = makeTheory(cols, split, est, ev, outcomes, dataGaps);
                theory.adjustedFloat = T;
                if (theory.profitCents > 0) profitable++;
                maybeAdd(theory);
              }
            }
          }
        }
      }
    }
  }

  const tripleTheories = bestByCombo.size - triplesBefore;
  options.onProgress?.(`Theory: ${tripleTheories} triple combos, ${bestByCombo.size} total kept`);

  // Deep scan: boundary-focused refinement with real listing data
  // Enumerates combos INDEPENDENTLY of broad scan (which may be fully cooldown-blocked).
  // Sources: (1) near-miss combos from cooldownMap, (2) all singles, (3) broad scan survivors.
  // Uses real listing prices and boundary-focused scanning. Bypasses cooldowns since
  // real pricing is more accurate than statistical estimates.
  options.onProgress?.("Theory: deep scan around condition boundaries...");
  const listingsByCol = preloadListings(db);
  const listingCount = [...listingsByCol.values()].reduce((s, l) => s + l.length, 0);
  console.log(`  Deep scan: ${listingCount} listings loaded across ${listingsByCol.size} collections`);

  // Build candidate combos for deep scan INDEPENDENTLY of broad scan
  const deepCandidates: { collections: string[]; split: number[] }[] = [];
  const seenDeepCombos = new Set<string>();

  // Source 1: Near-miss combos from cooldown tracking (gap < $100)
  // These are closest to profitability — most likely to flip with real listing pricing
  let deepNearMissCount = 0;
  if (cooldownMap) {
    for (const [comboKey, { gap }] of cooldownMap) {
      if (gap > 10000) continue; // Only combos within $100 of profitability
      if (deepNearMissCount >= 2000) break; // Cap to prevent 10+ min deep scan
      // Parse combo_key format: "Collection A:3|Collection B:2"
      const parts = comboKey.split("|");
      const collections: string[] = [];
      const split: number[] = [];
      for (const part of parts) {
        const lastColon = part.lastIndexOf(":");
        if (lastColon === -1) continue;
        collections.push(part.substring(0, lastColon));
        split.push(parseInt(part.substring(lastColon + 1)));
      }
      if (collections.length > 0 && split.reduce((s, c) => s + c, 0) === 5) {
        const key = `${collections.join("+")}:${split.join("/")}`;
        if (!seenDeepCombos.has(key)) {
          seenDeepCombos.add(key);
          deepCandidates.push({ collections, split });
          deepNearMissCount++;
        }
      }
    }
  }

  // Source 2: All singles (42 collections, one combo each)
  for (const colName of knifeCollections) {
    const key = `${colName}:5`;
    if (!seenDeepCombos.has(key)) {
      seenDeepCombos.add(key);
      deepCandidates.push({ collections: [colName], split: [5] });
    }
  }

  // Source 3: Top broad scan results (if any survived cooldown filtering)
  const broadTopN = [...bestByCombo.values()]
    .sort((a, b) => b.roiPercentage - a.roiPercentage)
    .slice(0, 100);
  for (const theory of broadTopN) {
    const key = `${theory.collections.join("+")}:${theory.split.join("/")}`;
    if (!seenDeepCombos.has(key)) {
      seenDeepCombos.add(key);
      deepCandidates.push({ collections: theory.collections, split: theory.split });
    }
  }

  console.log(`  Deep scan candidates: ${deepCandidates.length} combos (${deepNearMissCount} near-miss, ${knifeCollections.length} singles, ${broadTopN.length} broad scan)`);

  let deepEvaluated = 0;
  let deepProfitable = 0;
  let deepImproved = 0;
  const deepBefore = bestByCombo.size;

  // Track combo+target pairs to avoid redundant evaluations
  const seenDeepKeys = new Set<string>();

  for (const { collections, split } of deepCandidates) {
    const comboKey = `${collections.join("+")}:${split.join("/")}`;
    const boundaries = getKnifeConditionBoundaries(collections, finishCache);

    // Dense scan ±0.02 around each condition boundary, step 0.002
    for (const boundary of boundaries) {
      for (let offset = -0.02; offset <= 0.02; offset += 0.002) {
        const T = Math.round((boundary + offset) * 10000) / 10000;
        if (T < 0.01 || T >= 1.0) continue;

        const deepKey = `${comboKey}:${T}`;
        if (seenDeepKeys.has(deepKey)) continue;
        seenDeepKeys.add(deepKey);

        const est = estimateInputsFromListings(listingsByCol, collections, split, T);
        if (!est) continue;

        const { ev, outcomes, dataGaps } = evalKnifePool(
          db, collections, split, est.inputFloats, finishCache
        );

        deepEvaluated++;
        const deepTheory = makeTheory(collections, split, est, ev, outcomes, dataGaps);
        deepTheory.adjustedFloat = T;
        if (deepTheory.profitCents > 0) deepProfitable++;

        // Deep scan bypasses cooldown check — uses real listing prices, more accurate
        // than broad scan's statistical estimates. A combo invalidated at -$24 might
        // now be profitable with new listings or boundary-focused float targeting.
        if (deepTheory.outcomes.length === 0) continue;
        if (deepTheory.totalCostCents > 0 && deepTheory.roiPercentage < MIN_ROI_THRESHOLD) continue;

        const sig = `${deepTheory.collections.join("+")}:${deepTheory.split.join("/")}:${deepTheory.outcomes.map(o => `${o.skinName}:${o.predictedCondition}`).sort().join("|")}`;
        const existing = bestByCombo.get(sig);
        if (existing && deepTheory.profitCents > existing.profitCents) deepImproved++;
        if (!existing || deepTheory.profitCents > existing.profitCents) {
          bestByCombo.set(sig, deepTheory);
        }
      }
    }
  }

  const deepNew = bestByCombo.size - deepBefore;
  options.onProgress?.(`Theory: deep scan done (${deepEvaluated} evaluated, ${deepProfitable} profitable, ${deepNew} new, ${deepImproved} improved)`);
  console.log(`  Deep scan: ${deepEvaluated} evaluated, ${deepProfitable} profitable, ${deepNew} new combos, ${deepImproved} improved`);

  // Compute chance to profit for all theories
  const theories = [...bestByCombo.values()];
  const chanceMap = new Map<PessimisticTheory, number>();
  for (const t of theories) {
    chanceMap.set(t, t.outcomes.reduce((sum, o) =>
      sum + (o.estimatedPriceCents > t.totalCostCents ? o.probability : 0), 0
    ));
  }

  // Sort by: ROI (primary), then chance to profit (tiebreak)
  const sortByValue = (a: PessimisticTheory, b: PessimisticTheory) => {
    // Primary: ROI (higher = better deal)
    if (Math.abs(a.roiPercentage - b.roiPercentage) > 1) return b.roiPercentage - a.roiPercentage;
    // Tiebreak: chance to profit
    return (chanceMap.get(b) ?? 0) - (chanceMap.get(a) ?? 0);
  };

  let kept: PessimisticTheory[];

  if (options.budgetRange) {
    const { minCents, maxCents } = options.budgetRange;
    const inRange = theories.filter(t => t.totalCostCents >= minCents && t.totalCostCents <= maxCents);
    const outRange = theories.filter(t => t.totalCostCents < minCents || t.totalCostCents > maxCents);

    inRange.sort(sortByValue);
    outRange.sort(sortByValue);

    // 60% of slots for target range, 40% for everything else
    const rangeSlots = Math.floor(MAX_THEORIES * 0.6);
    const otherSlots = MAX_THEORIES - rangeSlots;
    const rangeKept = inRange.slice(0, rangeSlots);
    const otherKept = outRange.slice(0, otherSlots);

    // If one bucket has leftover slots, give to the other
    const rangeLeftover = Math.max(0, rangeSlots - rangeKept.length);
    const otherLeftover = Math.max(0, otherSlots - otherKept.length);
    if (rangeLeftover > 0) otherKept.push(...outRange.slice(otherSlots, otherSlots + rangeLeftover));
    if (otherLeftover > 0) rangeKept.push(...inRange.slice(rangeSlots, rangeSlots + otherLeftover));

    kept = [...rangeKept, ...otherKept];
    kept.sort(sortByValue);

    const rangeProfit = rangeKept.filter(t => t.profitCents > 0).length;
    console.log(`  Budget target: $${(minCents / 100).toFixed(0)}-$${(maxCents / 100).toFixed(0)} → ${inRange.length} combos (${rangeProfit} profitable, ${rangeKept.length} kept)`);
  } else {
    theories.sort(sortByValue);
    kept = theories.slice(0, MAX_THEORIES);
  }

  const profitableCount = kept.filter(t => t.profitCents > 0).length;
  const nearMissCount = kept.length - profitableCount;

  if (skippedByCooldown > 0) {
    console.log(`  Cooldown: skipped ${skippedByCooldown} combos on cooldown (recently invalidated)`);
  }
  console.log(`  Theory totals: ${profitableCount} profitable + ${nearMissCount} near-miss = ${kept.length} kept (${evaluated} combos evaluated)`);
  if (kept.length > 0) {
    console.log(`  Top theories (sorted by ROI + chance to profit):`);
    for (const t of kept.slice(0, 8)) {
      const chanceToProfit = t.outcomes.reduce((sum, o) =>
        sum + (o.estimatedPriceCents > t.totalCostCents ? o.probability : 0), 0
      );
      const inputDesc = [...new Set(t.inputSkins.map(i => `${i.skinName.split(" | ").pop()} ${i.condition}`))].join(", ");
      const profitStr = t.profitCents >= 0 ? `+$${(t.profitCents / 100).toFixed(2)}` : `-$${(Math.abs(t.profitCents) / 100).toFixed(2)}`;
      console.log(`    ${(chanceToProfit * 100).toFixed(0)}% chance ${t.roiPercentage.toFixed(0)}% ROI | ${t.collections.join(" + ")} [${t.split.join("/")}]: ${profitStr} cost $${(t.totalCostCents / 100).toFixed(2)} | ${inputDesc}`);
    }
    if (nearMissCount > 0) {
      const worst = kept[kept.length - 1];
      console.log(`  Worst kept: ${(worst.roiPercentage).toFixed(0)}% ROI ($${(worst.profitCents / 100).toFixed(2)})`);
    }
  }

  return kept;
}

/**
 * Near-miss info from materialization — theories that are close to profitable.
 * Used to boost wanted list priority for skins in near-miss combos.
 */
export interface NearMissInfo {
  combo: string;       // "The Recoil Collection,The Snakebite Collection"
  gap: number;         // how many cents short of profitable (positive = loss amount)
  theoryProfit: number;
}

/**
 * Build a wanted list of INPUT listings to fetch via API.
 * Extracts unique skin+float combos from theories, sorted by priority.
 * Near-miss combos (from previous cycle's materialization) get a massive
 * priority boost — these are closest to flipping profitable with better listings.
 */
export function buildWantedList(
  theories: PessimisticTheory[],
  nearMisses?: NearMissInfo[]
): WantedListing[] {
  // Build a set of collections in near-miss combos with their gap
  // Smaller gap = higher boost (closer to profitable)
  const nearMissBoost = new Map<string, number>(); // collection → boost score
  if (nearMisses && nearMisses.length > 0) {
    for (const nm of nearMisses) {
      // Boost inversely proportional to gap: $5 gap → 200 boost, $50 gap → 20, $100 gap → 10
      const boost = Math.round(1000 / Math.max(nm.gap / 100, 1));
      for (const col of nm.combo.split(",")) {
        const existing = nearMissBoost.get(col.trim()) ?? 0;
        nearMissBoost.set(col.trim(), Math.max(existing, boost));
      }
    }
  }

  const map = new Map<string, WantedListing>();

  for (const theory of theories) {
    // Score combines ROI and chance to profit — both matter for prioritizing API spend
    // ROI tells us efficiency, chance tells us likelihood of winning
    const chanceToProfit = theory.outcomes.reduce((sum, o) =>
      sum + (o.estimatedPriceCents > theory.totalCostCents ? o.probability : 0), 0
    );
    const roiComponent = Math.max(0, theory.roiPercentage + 100); // 0-200+ scale, 100 = break-even
    const chanceComponent = chanceToProfit * 100; // 0-100 scale
    let score = roiComponent * 0.6 + chanceComponent * 0.4; // Weighted blend

    // Boost score for skins in near-miss combos
    for (const col of theory.collections) {
      const boost = nearMissBoost.get(col);
      if (boost) score += boost;
    }

    for (const input of theory.inputSkins) {
      const bucket = getFloatBucket(input.floatValue);
      if (!bucket) continue;

      const key = `${input.skinName}:${bucket.min}:${bucket.max}`;
      const existing = map.get(key);
      if (!existing || score > existing.priority_score) {
        map.set(key, {
          skin_name: input.skinName,
          collection_name: input.collection,
          target_float: input.floatValue,
          max_float: bucket.max,
          ref_price_cents: input.priceCents,
          priority_score: score,
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => b.priority_score - a.priority_score);
}

export function saveTheoryTradeUps(db: Database.Database, theories: PessimisticTheory[]) {
  const lookupSkinId = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1");

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, combo_key, outcomes_json)
    VALUES (?, ?, ?, ?, ?, 'covert_knife', ?, ?, 1, ?, ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    // Clear old knife theoretical trade-ups only (scoped to covert_knife type)
    db.exec("DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE is_theoretical = 1 AND type = 'covert_knife')");
    db.exec("DELETE FROM trade_ups WHERE is_theoretical = 1 AND type = 'covert_knife'");

    for (const theory of theories) {
      const chanceToProfit = theory.outcomes.reduce((sum, o) =>
        sum + (o.estimatedPriceCents > theory.totalCostCents ? o.probability : 0), 0
      );
      const posOutcomes = theory.outcomes.filter(o => o.estimatedPriceCents > 0);
      const bestCase = posOutcomes.length > 0
        ? Math.max(...posOutcomes.map(o => o.estimatedPriceCents)) - theory.totalCostCents : 0;
      const worstCase = posOutcomes.length > 0
        ? Math.min(...posOutcomes.map(o => o.estimatedPriceCents)) - theory.totalCostCents : -theory.totalCostCents;

      // Build outcomes JSON — theory outcomes use different field names, normalize to TradeUpOutcome
      const outcomesForJson = theory.outcomes
        .filter(o => o.estimatedPriceCents > 0 || o.probability > 0)
        .map(o => {
          const skinRow = lookupSkinId.get(o.skinName) as { id: string } | undefined;
          return {
            skin_id: skinRow?.id ?? "",
            skin_name: o.skinName,
            collection_name: theory.collections[0] ?? "",
            probability: o.probability,
            predicted_float: o.predictedFloat,
            predicted_condition: o.predictedCondition,
            estimated_price_cents: o.estimatedPriceCents,
          };
        });

      const comboKey = theoryComboKey(theory.collections, theory.split);
      const result = insertTradeUp.run(
        theory.totalCostCents, theory.expectedValueCents, theory.profitCents,
        theory.roiPercentage, chanceToProfit, bestCase, worstCase, comboKey,
        JSON.stringify(outcomesForJson)
      );
      const tradeUpId = result.lastInsertRowid;

      // Insert inputs
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

