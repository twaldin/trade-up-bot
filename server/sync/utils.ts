
import pg from "pg";
import { MAX_LISTING_AGE_DAYS, CONDITIONS_LIST } from "./types.js";
import type { CSFloatListing } from "./types.js";

export function isListingTooOld(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const cutoff = Date.now() - MAX_LISTING_AGE_DAYS * 24 * 60 * 60 * 1000;
  return created < cutoff;
}

// Normalize rarity names from ByMykel to our standard names
export function normalizeRarity(raw: string): string {
  const map: Record<string, string> = {
    "Consumer Grade": "Consumer Grade",
    "Industrial Grade": "Industrial Grade",
    "Mil-Spec Grade": "Mil-Spec",
    "Mil-Spec": "Mil-Spec",
    Restricted: "Restricted",
    Classified: "Classified",
    Covert: "Covert",
    Extraordinary: "Extraordinary",
    Contraband: "Contraband",
  };
  return map[raw] ?? raw;
}

// Resolve a CSFloat listing's skin to our DB skin ID
export async function findSkinId(
  pool: pg.Pool,
  marketHashName: string
): Promise<string | null> {
  // market_hash_name is like "AK-47 | Redline (Field-Tested)" or "StatTrak™ AK-47 | Redline (Field-Tested)"
  // Our skin name is like "AK-47 | Redline" or "StatTrak™ AK-47 | Redline"
  const baseName = marketHashName.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const { rows } = await pool.query(
    "SELECT id FROM skins WHERE name = $1 LIMIT 1",
    [baseName]
  );

  if (rows[0]) return rows[0].id;

  // Try stripping the star prefix for knives/gloves
  const noStar = baseName.replace(/^★\s*/, "").trim();
  if (noStar !== baseName) {
    const { rows: rows2 } = await pool.query(
      "SELECT id FROM skins WHERE name = $1 LIMIT 1",
      [noStar]
    );
    return rows2[0]?.id ?? null;
  }

  return null;
}

// Extract and save CSFloat reference prices from listing responses
// These come free with every listing API call — CSFloat's own market estimates
export async function saveReferencePrice(pool: pg.Pool, listing: CSFloatListing) {
  if (!listing.reference?.base_price || listing.reference.base_price <= 0) return;

  const condMatch = listing.item.market_hash_name.match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/
  );
  if (!condMatch) return;

  const condition = condMatch[1];
  const skinName = listing.item.market_hash_name.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const priceCents = listing.reference.base_price;
  const qty = listing.reference.quantity ?? 0;

  await pool.query(`
    INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_ref', NOW())
    ON CONFLICT (skin_name, condition, source) DO UPDATE SET
      avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
  `, [skinName, condition, priceCents, priceCents, priceCents, qty]);
}

export async function saveReferencePrices(pool: pg.Pool, listings: CSFloatListing[]) {
  // Only save one reference per skin+condition (they're all the same within a condition)
  const seen = new Set<string>();
  for (const listing of listings) {
    if (!listing.reference?.base_price) continue;
    const key = listing.item.market_hash_name;
    if (seen.has(key)) continue;
    seen.add(key);
    await saveReferencePrice(pool, listing);
  }
}

/**
 * Determine which conditions are valid for a skin based on its float range.
 */
export function getValidConditions(
  minFloat: number,
  maxFloat: number
): string[] {
  return CONDITIONS_LIST
    .filter((c) => minFloat < c.max && maxFloat > c.min)
    .map((c) => c.name);
}
