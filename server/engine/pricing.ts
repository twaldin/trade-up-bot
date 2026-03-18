// Condition-level output pricing with multi-source cache.

import pg from "pg";
import { floatToCondition } from "../../shared/types.js";
import { CONDITION_BOUNDS, type PriceAnchor } from "./types.js";
import { MARKETPLACE_FEES, effectiveSellProceeds } from "./fees.js";
import { knnOutputPriceAtFloat } from "./knn-pricing.js";

const CONDITION_MIDPOINTS: { name: string; mid: number }[] = [
  { name: "Factory New", mid: 0.035 },
  { name: "Minimal Wear", mid: 0.11 },
  { name: "Field-Tested", mid: 0.265 },
  { name: "Well-Worn", mid: 0.415 },
  { name: "Battle-Scarred", mid: 0.725 },
];

export const priceCache = new Map<string, number>();
export const priceSources = new Map<string, string>(); // key → source label
export let priceCacheBuilt = false;

// Per-source listing floor caches (for per-marketplace output pricing)
export const dmarketFloorCache = new Map<string, number>(); // skinName:condition → lowest DMarket listing
export const skinportFloorCache = new Map<string, number>(); // skinName:condition → lowest Skinport listing
// Cache for getConditionPrices results — avoids repeated DB queries for knife phase names
const conditionPricesCache = new Map<string, PriceAnchor[]>();
let priceCacheBuiltAt = 0;
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Rebuild price cache. Skips if already built within TTL unless force=true. */
export async function buildPriceCache(pool: pg.Pool, force = false) {
  if (!force && priceCacheBuilt && Date.now() - priceCacheBuiltAt < PRICE_CACHE_TTL_MS) {
    return; // Cache is fresh, skip rebuild
  }
  priceCache.clear();
  priceSources.clear();
  dmarketFloorCache.clear();
  skinportFloorCache.clear();
  conditionPricesCache.clear();

  const condBounds = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  // Step 1: CSFloat sale history median prices
  // Step 1: CSFloat ref prices FIRST (conservative condition-level averages, high volume).
  // Sales are skewed by low-float premiums within a condition (FT 0.15 = $11 vs FT 0.32 = $6).
  // Ref is the better estimate for "average price at this condition".
  let salesCount = 0;
  const { rows: refRows2 } = await pool.query(`
    SELECT skin_name, condition, min_price_cents, median_price_cents, volume
    FROM price_data WHERE source = 'csfloat_ref' AND volume >= 3
  `);
  for (const row of refRows2) {
    const price = row.median_price_cents > 0 ? row.median_price_cents : row.min_price_cents;
    if (price > 0) {
      const k = `${row.skin_name}:${row.condition}`;
      priceCache.set(k, price);
      priceSources.set(k, `csfloat_ref (${row.volume} vol)`);
      salesCount++;
    }
  }

  // Step 1b: CSFloat sales fill gaps where ref doesn't exist
  const { rows: salesRows } = await pool.query(`
    SELECT skin_name, condition, median_price_cents, volume
    FROM price_data WHERE source = 'csfloat_sales'
  `);
  for (const row of salesRows) {
    if (row.median_price_cents > 0 && row.volume >= 2) {
      const k = `${row.skin_name}:${row.condition}`;
      if (!priceCache.has(k)) {
        priceCache.set(k, row.median_price_cents);
        priceSources.set(k, `csfloat_sales (${row.volume} sales)`);
        salesCount++;
      }
    }
  }

  // Step 1b: Lowest Covert listings per condition — use min(sale_median, lowest_listing)
  // Always prefer the lower estimate to avoid inflated EV calculations
  let listingOverrides = 0;
  let listingFills = 0;

  // Build per-condition reference price from price_data to detect outlier listings
  // Per-condition avoids filtering out legitimate FN premiums (e.g., Wild Lotus FN=$17k vs BS=$150)
  const refPrice = new Map<string, number>();
  const { rows: refRows } = await pool.query(`
    SELECT skin_name, condition, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE median_price_cents END) as ref
    FROM price_data WHERE (min_price_cents > 0 OR median_price_cents > 0)
      AND source IN ('csfloat_sales', 'csfloat_ref')
    GROUP BY skin_name, condition
  `);
  for (const r of refRows) if (r.ref > 0) refPrice.set(`${r.skin_name}:${r.condition}`, r.ref);

  for (const cond of condBounds) {
    const { rows } = await pool.query(`
      SELECT s.name, s.rarity, MIN(l.price_cents) as lowest_price, COUNT(*) as cnt
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.float_value >= $1 AND l.float_value < $2
        AND l.source = 'csfloat'
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      GROUP BY s.name, s.rarity
    `, [cond.min, cond.max]);

    for (const row of rows) {
      if (row.lowest_price <= 0) continue;
      // Filter out outlier listings: >5x the per-condition reference price
      const ref = refPrice.get(`${row.name}:${cond.name}`);
      if (ref && row.lowest_price > ref * 5) continue;

      const key = `${row.name}:${cond.name}`;
      const existing = priceCache.get(key);

      if (existing !== undefined) {
        // Override only if listing is LOWER (more conservative for output pricing)
        if (row.lowest_price < existing) {
          priceCache.set(key, row.lowest_price);
          priceSources.set(key, `listing floor (${row.cnt} listings, lower than ${priceSources.get(key)})`);
          listingOverrides++;
        }
      } else if (row.rarity === "Covert" && parseInt(row.cnt, 10) >= 3) {
        // For Covert inputs with decent listing depth: fill from listings
        priceCache.set(key, row.lowest_price);
        priceSources.set(key, `listing floor (${row.cnt} listings)`);
        listingFills++;
      }
      // For Extraordinary (knives/gloves): don't fill from listings alone —
      // let ref/steam/skinport prices fill first (listings can be inflated by rare patterns)
    }
  }

  // Step 2: Ref already loaded in Step 1. Count for logging.
  const csfloatRefCount = refRows2.length;

  // CSFloat-only output pricing. No DMarket/Steam/Skinport gap-fill.
  // CSFloat ref + sales + listing floors are the only trusted sources.
  // Coverage builds naturally as listing API cycles through all rarities.
  const steamPriceCount = 0;
  const skinportPriceCount = 0;

  // Step 3: Fill remaining gaps from listings (last resort for knives/gloves)
  let listingLastResort = 0;
  for (const cond of condBounds) {
    const { rows } = await pool.query(`
      SELECT s.name, MIN(l.price_cents) as lowest_price
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.float_value >= $1 AND l.float_value < $2
        AND l.source = 'csfloat'
        AND s.rarity = 'Extraordinary'
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      GROUP BY s.name
    `, [cond.min, cond.max]);

    for (const row of rows) {
      if (row.lowest_price <= 0) continue;
      const ref = refPrice.get(`${row.name}:${cond.name}`);
      if (ref && row.lowest_price > ref * 5) continue;

      const key = `${row.name}:${cond.name}`;
      const existing = priceCache.get(key);
      if (existing === undefined) {
        priceCache.set(key, row.lowest_price);
        priceSources.set(key, `knife listing floor`);
        listingLastResort++;
      } else if (row.lowest_price < existing) {
        priceCache.set(key, row.lowest_price);
        priceSources.set(key, `knife listing floor (lower than ${priceSources.get(key)})`);
        listingOverrides++;
      }
    }
  }

  // Step 4: Condition extrapolation for ★ items — fill missing conditions from adjacent known ones
  // Uses conservative ratios: 0.85x stepping down (worse condition), 1.0x stepping up (no FN premium assumed)
  let knifeExtrapolated = 0;
  const condOrder = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
  const STEP_DOWN = 0.85; // conservative discount for worse condition
  const STEP_UP = 1.15;   // conservative FN premium over MW (real premiums often 2-10x)

  // Collect all ★ skin names that have at least one cached price
  const knifeSkins = new Set<string>();
  for (const key of priceCache.keys()) {
    if (key.startsWith("★") && !key.includes("StatTrak")) {
      knifeSkins.add(key.split(":")[0]);
    }
  }

  for (const skinName of knifeSkins) {
    // Find which conditions we already have
    const existing = new Map<number, number>(); // condIndex → price
    for (let i = 0; i < condOrder.length; i++) {
      const p = priceCache.get(`${skinName}:${condOrder[i]}`);
      if (p !== undefined && p > 0) existing.set(i, p);
    }
    if (existing.size === 0 || existing.size === condOrder.length) continue;

    // Extrapolate outward from each known condition (single-hop only to limit error)
    for (const [idx, price] of existing) {
      // Extrapolate one step worse (higher float)
      if (idx < condOrder.length - 1 && !existing.has(idx + 1)) {
        const key = `${skinName}:${condOrder[idx + 1]}`;
        if (!priceCache.has(key)) {
          const extPrice = Math.round(price * STEP_DOWN);
          priceCache.set(key, extPrice);
          priceSources.set(key, `extrapolated from ${condOrder[idx]}`);
          knifeExtrapolated++;
        }
      }
      // Extrapolate one step better (lower float)
      if (idx > 0 && !existing.has(idx - 1)) {
        const key = `${skinName}:${condOrder[idx - 1]}`;
        if (!priceCache.has(key)) {
          const extPrice = Math.round(price * STEP_UP);
          priceCache.set(key, extPrice);
          priceSources.set(key, `extrapolated from ${condOrder[idx]}`);
          knifeExtrapolated++;
        }
      }
    }
  }

  await buildSourceFloorCaches(pool);
  console.log(`  Price cache: ${salesCount} sales, ${listingOverrides} listing overrides (lower), ${listingFills} listing fills, ${listingLastResort} knife listing fills, ${csfloatRefCount} ref, ${steamPriceCount} steam, ${skinportPriceCount} skinport, ${knifeExtrapolated} knife extrapolated = ${priceCache.size} total (DM floors: ${dmarketFloorCache.size}, SP floors: ${skinportFloorCache.size})`);
  priceCacheBuilt = true;
  priceCacheBuiltAt = Date.now();
}

async function buildSourceFloorCaches(pool: pg.Pool) {
  dmarketFloorCache.clear();
  skinportFloorCache.clear();

  const condBounds = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  for (const source of ["dmarket", "skinport"] as const) {
    const cache = source === "dmarket" ? dmarketFloorCache : skinportFloorCache;
    for (const cond of condBounds) {
      // Require 2+ listings for floor price — single listings are unreliable
      // (collector prices, mispriced items, etc.)
      const { rows } = await pool.query(`
        SELECT s.name, MIN(l.price_cents) as lowest_price, COUNT(*) as cnt
        FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE l.float_value >= $1 AND l.float_value < $2
          AND l.source = $3
          AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
        GROUP BY s.name
        HAVING COUNT(*) >= 2
      `, [cond.min, cond.max, source]);

      for (const row of rows) {
        if (row.lowest_price <= 0) continue;
        cache.set(`${row.name}:${cond.name}`, row.lowest_price);
      }
    }
  }
}

export function lookupPrice(
  pool: pg.Pool,
  skinName: string,
  predictedFloat: number
): number {
  const condition = floatToCondition(predictedFloat);
  const cached = priceCache.get(`${skinName}:${condition}`);
  if (cached !== undefined && cached > 0) return cached;

  // No interpolation between conditions — FN premiums make linear interpolation wildly wrong.
  // If we don't have CSFloat data for this exact condition, return 0 (unpriced).
  // The price cache already has CSFloat sales + ref + listing floors per condition.
  return 0;
}

export interface OutputPriceResult {
  priceCents: number;      // net proceeds after seller fee
  marketplace: string;     // 'csfloat' | 'dmarket' | 'skinport'
  grossPrice: number;      // price before fee
  feePct: number;          // seller fee percentage
}

/**
 * Look up best output price across all marketplaces.
 * Returns the marketplace with highest net proceeds after seller fees.
 */
export async function lookupOutputPrice(
  pool: pg.Pool,
  skinName: string,
  predictedFloat: number
): Promise<OutputPriceResult> {
  const condition = floatToCondition(predictedFloat);

  // Float-precise KNN for knife/glove skins only (they have rich sale observation data).
  // Non-knife skins lack observations — KNN returns null, falling through to condition-level.
  if (skinName.startsWith("★")) {
    const knn = await knnOutputPriceAtFloat(pool, skinName, predictedFloat);
    if (knn && knn.confidence >= 0.5) {
      // Find the best marketplace net proceeds for the KNN price
      // DMarket excluded from output pricing — unreliable floor prices
      const csfNet = effectiveSellProceeds(knn.priceCents, "csfloat");
      const spGross = skinportFloorCache.get(`${skinName}:${condition}`) ?? 0;
      const spNet = spGross > 0 ? effectiveSellProceeds(spGross, "skinport") : 0;

      let best: OutputPriceResult = {
        priceCents: csfNet,
        marketplace: "csfloat",
        grossPrice: knn.priceCents,
        feePct: MARKETPLACE_FEES.csfloat.sellerFee,
      };
      if (spNet > best.priceCents) {
        best = { priceCents: spNet, marketplace: "skinport", grossPrice: spGross, feePct: MARKETPLACE_FEES.skinport.sellerFee };
      }

      // Conservative: if cached condition-level price is lower, use that instead
      // Only check the in-memory cache — don't trigger DB queries for every knife finish
      const condCached = priceCache.get(`${skinName}:${condition}`);
      if (condCached && condCached > 0) {
        const condNet = effectiveSellProceeds(condCached, "csfloat");
        if (condNet < best.priceCents) {
          best = { priceCents: condNet, marketplace: "csfloat", grossPrice: condCached, feePct: MARKETPLACE_FEES.csfloat.sellerFee };
        }
      }

      return best;
    }
  }

  // CSFloat: use the full price cache (sales + ref + extrapolation)
  const csfloatGross = lookupPrice(pool, skinName, predictedFloat);
  const csfloatNet = csfloatGross > 0 ? effectiveSellProceeds(csfloatGross, "csfloat") : 0;

  // DMarket: use listing floor for NON-knife skins only.
  // Knife/glove skins excluded (thin liquidity, collector outliers).
  // Commodity gun skins have many DMarket listings — floor is reliable.
  const isKnife = skinName.startsWith("★");
  const dmGross = isKnife ? 0 : (dmarketFloorCache.get(`${skinName}:${condition}`) ?? 0);
  const dmNet = dmGross > 0 ? effectiveSellProceeds(dmGross, "dmarket") : 0;

  // Skinport: listing floor only (skip for StatTrak — unreliable thin-volume data)
  const isStatTrak = skinName.startsWith("StatTrak");
  const spGross = isStatTrak ? 0 : (skinportFloorCache.get(`${skinName}:${condition}`) ?? 0);
  const spNet = spGross > 0 ? effectiveSellProceeds(spGross, "skinport") : 0;

  // CSFloat price cache (sales + ref) is the primary source — highest volume, most reliable.
  // DMarket/Skinport floors only used to FILL GAPS when CSFloat has no data for this skin+condition.
  // This prevents low-volume Skinport outliers ($471, 5 vol) from overriding CSFloat sales ($210, 40 vol).
  let best: OutputPriceResult = {
    priceCents: csfloatNet,
    marketplace: "csfloat",
    grossPrice: csfloatGross,
    feePct: MARKETPLACE_FEES.csfloat.sellerFee,
  };

  // CSFloat-only output pricing. No DMarket/Skinport gap-fill — both overestimate.
  // If CSFloat has no data, price stays 0 (conservative: unpriced outcome = $0).
  return best;
}

export async function getConditionPrices(
  pool: pg.Pool,
  skinName: string
): Promise<PriceAnchor[]> {
  const cached = conditionPricesCache.get(skinName);
  if (cached !== undefined) return cached;

  const { rows: skinInfoRows } = await pool.query(
    `SELECT min_float, max_float FROM skins WHERE name = $1 AND stattrak = 0 LIMIT 1`,
    [skinName]
  );
  const skinInfo = skinInfoRows[0] as { min_float: number; max_float: number } | undefined;

  // Prefer CSFloat data; fall back to Skinport min_price if no CSFloat data at all
  const { rows } = await pool.query(
    `SELECT condition, min_price_cents, avg_price_cents
     FROM price_data WHERE skin_name = $1 AND source IN ('csfloat_sales', 'csfloat_ref')
       AND (min_price_cents > 0 OR avg_price_cents > 0)
     ORDER BY min_price_cents DESC`,
    [skinName]
  );

  if (rows.length === 0) {
    // StatTrak: don't use Skinport-only pricing for outputs — too unreliable
    // (Skinport has thin volume and inflated prices for ST items)
    const isStatTrak = skinName.startsWith("StatTrak™");
    if (isStatTrak) {
      conditionPricesCache.set(skinName, []);
      return [];
    }

    // No Skinport/Steam fallback — CSFloat-only for output pricing accuracy.
    // Doppler phase fallback: "★ Karambit | Doppler Phase 1" → "★ Karambit | Doppler"
    // Covers: "Phase N", "Ruby", "Sapphire", "Black Pearl", "Emerald"
    const phaseMatch = skinName.match(/^(.+\| (?:Doppler|Gamma Doppler))\s+(?:Phase \d|Ruby|Sapphire|Black Pearl|Emerald)$/);
    if (phaseMatch) {
      const baseName = phaseMatch[1];
      const { rows: baseRows } = await pool.query(
        `SELECT condition, min_price_cents, avg_price_cents FROM price_data WHERE skin_name = $1`,
        [baseName]
      );
      const result = buildAnchors(baseRows, 1.0, skinInfo);
      conditionPricesCache.set(skinName, result);
      return result;
    }
    conditionPricesCache.set(skinName, []);
    return [];
  }

  const result = buildAnchors(rows, 1.0, skinInfo);
  conditionPricesCache.set(skinName, result);
  return result;
}

export function buildAnchors(
  rows: { condition: string; min_price_cents: number; avg_price_cents: number }[],
  multiplier: number,
  floatRange?: { min_float: number; max_float: number }
): PriceAnchor[] {
  const anchors: PriceAnchor[] = [];
  for (const row of rows) {
    const midpoint = CONDITION_MIDPOINTS.find((c) => c.name === row.condition);
    if (!midpoint) continue;

    if (floatRange) {
      const bounds = CONDITION_BOUNDS.find(b => b.name === row.condition);
      if (bounds && (floatRange.min_float >= bounds.max || floatRange.max_float <= bounds.min)) {
        continue;
      }
    }

    const price = row.avg_price_cents > 0 ? row.avg_price_cents : row.min_price_cents;
    if (price <= 0) continue;
    anchors.push({ float: midpoint.mid, price: Math.round(price * multiplier) });
  }
  anchors.sort((a, b) => a.float - b.float);
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].price > anchors[i - 1].price) {
      anchors[i].price = anchors[i - 1].price;
    }
  }
  return anchors;
}

export function interpolatePrice(anchors: PriceAnchor[], float: number): number {
  if (anchors.length === 0) return 0;
  // Single anchor: only use if float is in the SAME condition.
  // FN ($141) should NOT be used for MW, FT, WW, or BS.
  if (anchors.length === 1) {
    const anchorCond = floatToCondition(anchors[0].float);
    const targetCond = floatToCondition(float);
    return anchorCond === targetCond ? anchors[0].price : 0;
  }
  // Multi-anchor: interpolate within range, don't extrapolate beyond.
  // If float is outside all anchors, only use nearest if same condition.
  if (float <= anchors[0].float) {
    return floatToCondition(float) === floatToCondition(anchors[0].float) ? anchors[0].price : 0;
  }
  if (float >= anchors[anchors.length - 1].float) {
    return floatToCondition(float) === floatToCondition(anchors[anchors.length - 1].float)
      ? anchors[anchors.length - 1].price : 0;
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    if (float >= lo.float && float <= hi.float) {
      const t = (float - lo.float) / (hi.float - lo.float);
      return Math.round(lo.price + t * (hi.price - lo.price));
    }
  }
  return anchors[anchors.length - 1].price;
}
