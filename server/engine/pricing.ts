/**
 * Price lookup engine: multi-source cache with fallback interpolation.
 *
 * Priority: csfloat_sales > listing floor > csfloat_ref > steam > skinport
 */

import Database from "better-sqlite3";
import { floatToCondition } from "../../shared/types.js";
import type { PriceAnchor } from "./types.js";

const CONDITION_MIDPOINTS: { name: string; mid: number }[] = [
  { name: "Factory New", mid: 0.035 },
  { name: "Minimal Wear", mid: 0.11 },
  { name: "Field-Tested", mid: 0.265 },
  { name: "Well-Worn", mid: 0.415 },
  { name: "Battle-Scarred", mid: 0.725 },
];

export const priceCache = new Map<string, number>();
export let priceCacheBuilt = false;
let priceCacheBuiltAt = 0;
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Rebuild price cache. Skips if already built within TTL unless force=true. */
export function buildPriceCache(db: Database.Database, force = false) {
  if (!force && priceCacheBuilt && Date.now() - priceCacheBuiltAt < PRICE_CACHE_TTL_MS) {
    return; // Cache is fresh, skip rebuild
  }
  priceCache.clear();

  const condBounds = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  // Step 1: CSFloat sale history median prices
  let salesCount = 0;
  const salesRows = db.prepare(`
    SELECT skin_name, condition, median_price_cents, volume
    FROM price_data WHERE source = 'csfloat_sales'
  `).all() as { skin_name: string; condition: string; median_price_cents: number; volume: number }[];
  for (const row of salesRows) {
    if (row.median_price_cents > 0 && row.volume >= 2) {
      priceCache.set(`${row.skin_name}:${row.condition}`, row.median_price_cents);
      salesCount++;
    }
  }

  // Step 1b: Lowest Covert listings per condition — use min(sale_median, lowest_listing)
  // Always prefer the lower estimate to avoid inflated EV calculations
  let listingOverrides = 0;
  let listingFills = 0;

  // Build reference price from price_data to detect outlier listings
  const refPrice = new Map<string, number>();
  const refRows = db.prepare(`
    SELECT skin_name, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE median_price_cents END) as ref
    FROM price_data WHERE (min_price_cents > 0 OR median_price_cents > 0)
    GROUP BY skin_name
  `).all() as { skin_name: string; ref: number }[];
  for (const r of refRows) if (r.ref > 0) refPrice.set(r.skin_name, r.ref);

  for (const cond of condBounds) {
    const rows = db.prepare(`
      SELECT s.name, s.rarity, MIN(l.price_cents) as lowest_price, COUNT(*) as cnt
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.float_value >= ? AND l.float_value < ?
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      GROUP BY s.name, s.rarity
    `).all(cond.min, cond.max) as { name: string; rarity: string; lowest_price: number; cnt: number }[];

    for (const row of rows) {
      if (row.lowest_price <= 0) continue;
      // Filter out outlier listings: >5x the reference price from price_data
      const ref = refPrice.get(row.name);
      if (ref && row.lowest_price > ref * 5) continue;

      const key = `${row.name}:${cond.name}`;
      const existing = priceCache.get(key);

      if (row.rarity === "Covert" && row.cnt >= 5) {
        // For Covert outputs with decent listing depth: use min(sale, listing)
        if (existing !== undefined) {
          if (row.lowest_price < existing) {
            priceCache.set(key, row.lowest_price);
            listingOverrides++;
          }
        } else {
          priceCache.set(key, row.lowest_price);
          listingFills++;
        }
      } else if (!existing) {
        // For non-Covert or thin data: only fill gaps (last resort)
        priceCache.set(key, row.lowest_price);
        listingFills++;
      }
    }
  }

  // Step 2: CSFloat reference prices (fill gaps only)
  let csfloatRefCount = 0;
  const csfloatRefRows = db.prepare(`
    SELECT skin_name, condition, min_price_cents, median_price_cents
    FROM price_data WHERE source = 'csfloat_ref'
  `).all() as { skin_name: string; condition: string; min_price_cents: number; median_price_cents: number }[];
  for (const row of csfloatRefRows) {
    const key = `${row.skin_name}:${row.condition}`;
    if (priceCache.has(key)) continue;
    const price = row.median_price_cents > 0 ? row.median_price_cents : row.min_price_cents;
    if (price > 0) {
      priceCache.set(key, price);
      csfloatRefCount++;
    }
  }

  // Step 3: Steam Market prices (fill gaps only)
  let steamCount = 0;
  const steamRows = db.prepare(`
    SELECT skin_name, condition, min_price_cents, median_price_cents
    FROM price_data WHERE source = 'steam'
  `).all() as { skin_name: string; condition: string; min_price_cents: number; median_price_cents: number }[];
  for (const row of steamRows) {
    const key = `${row.skin_name}:${row.condition}`;
    if (priceCache.has(key)) continue;
    const price = row.median_price_cents > 0 ? row.median_price_cents : row.min_price_cents;
    if (price > 0) {
      priceCache.set(key, price);
      steamCount++;
    }
  }

  // Step 4: Skinport (fill gaps only)
  let skinportCount = 0;
  const skinportRows = db.prepare(`
    SELECT skin_name, condition, min_price_cents, median_price_cents
    FROM price_data WHERE source = 'skinport'
  `).all() as { skin_name: string; condition: string; min_price_cents: number; median_price_cents: number }[];
  for (const row of skinportRows) {
    const key = `${row.skin_name}:${row.condition}`;
    if (priceCache.has(key)) continue;
    const price = row.median_price_cents > 0 ? row.median_price_cents : row.min_price_cents;
    if (price > 0) {
      priceCache.set(key, price);
      skinportCount++;
    }
  }

  console.log(`  Price cache: ${salesCount} sales, ${listingOverrides} listing overrides (lower), ${listingFills} listing fills, ${csfloatRefCount} ref, ${steamCount} steam, ${skinportCount} skinport = ${priceCache.size} total`);
  priceCacheBuilt = true;
  priceCacheBuiltAt = Date.now();
}

export function lookupPrice(
  db: Database.Database,
  skinName: string,
  predictedFloat: number
): number {
  const condition = floatToCondition(predictedFloat);
  const cached = priceCache.get(`${skinName}:${condition}`);
  if (cached !== undefined && cached > 0) return cached;

  const prices = getConditionPrices(db, skinName);
  if (prices.length === 0) return 0;
  return interpolatePrice(prices, predictedFloat);
}

export function getConditionPrices(
  db: Database.Database,
  skinName: string
): PriceAnchor[] {
  const skinInfo = db.prepare(
    `SELECT min_float, max_float FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1`
  ).get(skinName) as { min_float: number; max_float: number } | undefined;

  const rows = db
    .prepare(
      `SELECT condition, min_price_cents, avg_price_cents
       FROM price_data WHERE skin_name = ?
       ORDER BY min_price_cents DESC`
    )
    .all(skinName) as {
    condition: string;
    min_price_cents: number;
    avg_price_cents: number;
  }[];

  if (rows.length === 0) {
    const cleanName = skinName.replace(/^StatTrak™\s+/, "");
    if (cleanName !== skinName) {
      const cleanRows = db
        .prepare(
          `SELECT condition, min_price_cents, avg_price_cents
           FROM price_data WHERE skin_name = ?`
        )
        .all(cleanName) as typeof rows;
      return buildAnchors(cleanRows, 2.0, skinInfo);
    }
    return [];
  }

  return buildAnchors(rows, 1.0, skinInfo);
}

export function buildAnchors(
  rows: { condition: string; min_price_cents: number; avg_price_cents: number }[],
  multiplier: number,
  floatRange?: { min_float: number; max_float: number }
): PriceAnchor[] {
  const CONDITION_BOUNDS: Record<string, { min: number; max: number }> = {
    "Factory New": { min: 0.0, max: 0.07 },
    "Minimal Wear": { min: 0.07, max: 0.15 },
    "Field-Tested": { min: 0.15, max: 0.38 },
    "Well-Worn": { min: 0.38, max: 0.45 },
    "Battle-Scarred": { min: 0.45, max: 1.0 },
  };

  const anchors: PriceAnchor[] = [];
  for (const row of rows) {
    const midpoint = CONDITION_MIDPOINTS.find((c) => c.name === row.condition);
    if (!midpoint) continue;

    if (floatRange) {
      const bounds = CONDITION_BOUNDS[row.condition];
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
  if (anchors.length === 1) return anchors[0].price;
  if (float <= anchors[0].float) return anchors[0].price;
  if (float >= anchors[anchors.length - 1].float)
    return anchors[anchors.length - 1].price;
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
