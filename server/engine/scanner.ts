/**
 * Market scanners: cross-marketplace arbitrage and low-float premium detection.
 *
 * These scanners analyze existing DB data — no API calls needed.
 * Run during daemon cooldown or on-demand via API.
 */

import Database from "better-sqlite3";
import { MARKETPLACE_FEES } from "./fees.js";
import { knnOutputPriceAtFloat } from "./theory-validation.js";

export interface ArbitrageOpportunity {
  skinName: string;
  rarity: string;
  condition: string;
  buyMarketplace: string;
  buyPrice: number;       // cents, including buyer fee
  sellMarketplace: string;
  sellPrice: number;      // cents, after seller fee
  profitCents: number;
  roiPct: number;
  buyListingId: string;
  buyFloat: number;
  salesVolume: number;    // how many sales back the sell price
  lastSaleAge: string;    // how recent the sale data is
}

export interface FloatSnipe {
  skinName: string;
  rarity: string;
  condition: string;
  marketplace: string;
  listingPrice: number;   // cents
  floatValue: number;
  avgConditionPrice: number; // cents — average FN sale price
  discountPct: number;    // how far below avg (positive = below)
  salesVolume: number;
  listingId: string;
}

/**
 * Find cross-marketplace arbitrage: buy on DMarket, sell on CSFloat.
 * Uses real sale data (not listing floors) for sell-side pricing.
 */
export function findArbitrageOpportunities(
  db: Database.Database,
  options: { minProfitCents?: number; minSalesVolume?: number; maxAgeDays?: number; limit?: number } = {}
): ArbitrageOpportunity[] {
  const minProfit = options.minProfitCents ?? 50;  // $0.50 minimum
  const minVol = options.minSalesVolume ?? 5;  // 5+ condition-matched sales required
  const maxAge = options.maxAgeDays ?? 14;
  const limit = options.limit ?? 100;

  // Get cheapest DMarket listing per skin+condition (condition-matched)
  const condBounds = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  const dmListings: {
    skin_name: string; rarity: string; listing_id: string;
    price_cents: number; float_value: number; condition: string;
  }[] = [];

  for (const cond of condBounds) {
    const rows = db.prepare(`
      SELECT s.name as skin_name, s.rarity, MIN(l.id) as listing_id, MIN(l.price_cents) as price_cents,
        l.float_value
      FROM listings l
      JOIN skins s ON l.skin_id = s.id
      WHERE l.source = 'dmarket' AND l.stattrak = 0
        AND l.float_value >= ? AND l.float_value < ?
        AND s.name NOT LIKE '%Doppler%'
      GROUP BY s.id
      ORDER BY price_cents ASC
    `).all(cond.min, cond.max) as { skin_name: string; rarity: string; listing_id: string; price_cents: number; float_value: number }[];
    for (const r of rows) {
      dmListings.push({ ...r, condition: cond.name });
    }
  }

  // Pre-load sale averages BY CONDITION (the key fix — no cross-condition mixing)
  const saleAvgs = new Map<string, { avg: number; cnt: number; lastSale: string }>();
  for (const cond of condBounds) {
    const saleRows = db.prepare(`
      SELECT skin_name, AVG(price_cents) as avg_price, COUNT(*) as cnt, MAX(observed_at) as last_sale
      FROM price_observations
      WHERE source = 'sale'
        AND observed_at > datetime('now', '-' || ? || ' days')
        AND float_value >= ? AND float_value < ?
      GROUP BY skin_name
      HAVING cnt >= ?
    `).all(maxAge, cond.min, cond.max, minVol) as { skin_name: string; avg_price: number; cnt: number; last_sale: string }[];
    for (const r of saleRows) {
      saleAvgs.set(`${r.skin_name}:${cond.name}`, { avg: r.avg_price, cnt: r.cnt, lastSale: r.last_sale });
    }
  }

  const results: ArbitrageOpportunity[] = [];

  for (const dm of dmListings) {
    const buyPrice = Math.round(dm.price_cents * (1 + MARKETPLACE_FEES.dmarket.buyerFeePct));

    // Try KNN float-precise pricing first — avoids false positives from condition-average inflation
    const knn = knnOutputPriceAtFloat(db, dm.skin_name, dm.float_value);
    if (knn) {
      const sellPrice = Math.round(knn.priceCents * (1 - MARKETPLACE_FEES.csfloat.sellerFee));
      const profit = sellPrice - buyPrice;
      if (profit >= minProfit) {
        // Use condition-average data for volume/age metadata if available
        const sales = saleAvgs.get(`${dm.skin_name}:${dm.condition}`);
        results.push({
          skinName: dm.skin_name,
          rarity: dm.rarity,
          condition: dm.condition,
          buyMarketplace: "dmarket",
          buyPrice,
          sellMarketplace: "csfloat",
          sellPrice,
          profitCents: profit,
          roiPct: Math.round((profit / buyPrice) * 10000) / 100,
          buyListingId: dm.listing_id,
          buyFloat: dm.float_value,
          salesVolume: knn.observationCount,
          lastSaleAge: sales?.lastSale ?? "",
        });
      }
      continue;
    }

    // Fallback: condition-average pricing when KNN has insufficient data
    const sales = saleAvgs.get(`${dm.skin_name}:${dm.condition}`);
    if (!sales) continue;

    const sellPrice = Math.round(sales.avg * (1 - MARKETPLACE_FEES.csfloat.sellerFee));
    const profit = sellPrice - buyPrice;

    if (profit < minProfit) continue;

    results.push({
      skinName: dm.skin_name,
      rarity: dm.rarity,
      condition: dm.condition,
      buyMarketplace: "dmarket",
      buyPrice,
      sellMarketplace: "csfloat",
      sellPrice,
      profitCents: profit,
      roiPct: Math.round((profit / buyPrice) * 10000) / 100,
      buyListingId: dm.listing_id,
      buyFloat: dm.float_value,
      salesVolume: sales.cnt,
      lastSaleAge: sales.lastSale,
    });
  }

  results.sort((a, b) => b.profitCents - a.profitCents);
  return results.slice(0, limit);
}

/**
 * Find low-float skins listed below their expected price.
 * Compares individual listing price vs average FN sale price.
 */
export function findFloatSnipes(
  db: Database.Database,
  options: { maxFloat?: number; minDiscountPct?: number; minSalesVolume?: number; limit?: number } = {}
): FloatSnipe[] {
  const maxFloat = options.maxFloat ?? 0.01;  // Very low float only
  const minDiscount = options.minDiscountPct ?? 15;  // At least 15% below average
  const minVol = options.minSalesVolume ?? 10;  // 10+ FN sales for reliable average
  const limit = options.limit ?? 50;

  // Include all skins — Dopplers use phase-qualified names for comparison
  const listings = db.prepare(`
    SELECT s.name as skin_name, s.rarity, l.id as listing_id, l.price_cents, l.float_value, l.source, l.phase
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value < ? AND l.stattrak = 0
      AND s.rarity IN ('Covert', 'Classified', 'Extraordinary')
    ORDER BY l.float_value ASC
  `).all(maxFloat) as {
    skin_name: string; rarity: string; listing_id: string;
    price_cents: number; float_value: number; source: string; phase: string | null;
  }[];

  const results: FloatSnipe[] = [];

  // Cache FN averages — use phase-qualified name for Dopplers
  const fnAvgCache = new Map<string, { avg: number; cnt: number }>();

  for (const l of listings) {
    // For Dopplers, compare against phase-specific sales (e.g., "★ Bayonet | Doppler Phase 2")
    const compareName = l.phase && l.skin_name.includes("Doppler")
      ? `${l.skin_name} ${l.phase}`
      : l.skin_name;

    // Try KNN float-precise pricing first — compares against sales at similar floats
    const knn = knnOutputPriceAtFloat(db, compareName, l.float_value);
    if (knn) {
      const discount = ((1 - l.price_cents / knn.priceCents) * 100);
      if (discount >= minDiscount) {
        results.push({
          skinName: l.skin_name,
          rarity: l.rarity,
          condition: "Factory New",
          marketplace: l.source,
          listingPrice: l.price_cents,
          floatValue: l.float_value,
          avgConditionPrice: Math.round(knn.priceCents),
          discountPct: Math.round(discount * 10) / 10,
          salesVolume: knn.observationCount,
          listingId: l.listing_id,
        });
      }
      continue;
    }

    // Fallback: condition-average pricing when KNN has insufficient data
    if (!fnAvgCache.has(compareName)) {
      const avg = db.prepare(`
        SELECT AVG(price_cents) as avg, COUNT(*) as cnt
        FROM price_observations
        WHERE skin_name = ? AND float_value < 0.07 AND source = 'sale'
      `).get(compareName) as { avg: number | null; cnt: number };
      fnAvgCache.set(compareName, { avg: avg?.avg ?? 0, cnt: avg?.cnt ?? 0 });
    }

    const { avg, cnt } = fnAvgCache.get(compareName)!;
    if (avg <= 0 || cnt < minVol) continue;

    const discount = ((1 - l.price_cents / avg) * 100);
    if (discount < minDiscount) continue;

    results.push({
      skinName: l.skin_name,
      rarity: l.rarity,
      condition: "Factory New",
      marketplace: l.source,
      listingPrice: l.price_cents,
      floatValue: l.float_value,
      avgConditionPrice: Math.round(avg),
      discountPct: Math.round(discount * 10) / 10,
      salesVolume: cnt,
      listingId: l.listing_id,
    });
  }

  results.sort((a, b) => b.discountPct - a.discountPct);
  return results.slice(0, limit);
}
