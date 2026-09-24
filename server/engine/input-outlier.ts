/**
 * Input price outlier guard for post-discovery reprice paths.
 * Discovery's 5x reference filter stays the rule for new rows. Reprice and
 * revive only reject a price jump: over 5x the reference AND over 3x the
 * stored input, or (with no reference) over 20x the stored input and more
 * than $50 above it.
 */

import pg from "pg";
import { floatToCondition } from "../../shared/types.js";
import { storedInputCost } from "./fees.js";

type Queryable = pg.Pool | pg.PoolClient;

export const INPUT_OUTLIER_REF_MULTIPLIER = 5;
export const JUMP_RATIO = 3;
export const NO_REF_RATIO = 20;
export const NO_REF_MIN_JUMP_CENTS = 5000;
export const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;

export interface InputReferenceMaps {
  refPriceCache: Map<string, number>;
  skinportMedianCache: Map<string, number>;
}

export interface InputPriceOutlierArgs {
  skinName: string;
  condition: string;
  /** Raw listings.price_cents. No buyer fee. */
  newPriceCents: number;
  /** Stored trade_up_inputs.price_cents being replaced. */
  oldPriceCents: number | null | undefined;
  feeSource: string | null | undefined;
  refCents?: number;
}

export type InputRefLookup = (skinName: string, condition: string) => number | undefined;

/** Per-condition reference maps. Same queries, order, and values as the old pricing.ts block. */
export async function buildInputReferenceMaps(pool: Queryable): Promise<InputReferenceMaps> {
  const refPriceCache = new Map<string, number>();
  const skinportMedianCache = new Map<string, number>();

  const { rows: refRows } = await pool.query(`
    SELECT skin_name, condition, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE median_price_cents END) as ref
    FROM price_data WHERE (min_price_cents > 0 OR median_price_cents > 0)
      AND source IN ('csfloat_sales', 'csfloat_ref')
    GROUP BY skin_name, condition
  `);
  for (const r of refRows) if (r.ref > 0) refPriceCache.set(`${r.skin_name}:${r.condition}`, r.ref);

  const { rows: spRows } = await pool.query(`
    SELECT skin_name, condition, median_price_cents as ref
    FROM price_data WHERE median_price_cents > 0 AND source = 'skinport'
  `);
  let spFills = 0;
  for (const r of spRows) {
    const key = `${r.skin_name}:${r.condition}`;
    if (r.ref > 0) skinportMedianCache.set(key, r.ref);
    if (!refPriceCache.has(key) && r.ref > 0) {
      refPriceCache.set(key, r.ref);
      spFills++;
    }
  }
  if (spFills > 0) console.log(`  Ref price map: ${refRows.length} from CSFloat, ${spFills} gaps filled from Skinport`);

  const { rows: buffRows } = await pool.query(`
    SELECT s.name as skin_name,
      CASE
        WHEN l.float_value < 0.07 THEN 'Factory New'
        WHEN l.float_value < 0.15 THEN 'Minimal Wear'
        WHEN l.float_value < 0.38 THEN 'Field-Tested'
        WHEN l.float_value < 0.45 THEN 'Well-Worn'
        ELSE 'Battle-Scarred'
      END as condition,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY l.price_cents) as median
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.source = 'buff' AND l.price_cents > 0
    GROUP BY s.name, condition
  `);
  let buffFills = 0;
  for (const r of buffRows) {
    const key = `${r.skin_name}:${r.condition}`;
    if (!refPriceCache.has(key) && r.median > 0) {
      refPriceCache.set(key, Math.round(r.median));
      buffFills++;
    }
  }
  if (buffFills > 0) console.log(`  Ref price map: ${buffFills} gaps filled from Buff listings median`);

  return { refPriceCache, skinportMedianCache };
}

/** min(CSFloat ref, Skinport median) when both exist, otherwise whichever exists. */
export function inputReferenceCents(
  skinName: string,
  condition: string,
  maps?: { ref?: Map<string, number>; skinport?: Map<string, number> },
): number | undefined {
  const key = `${skinName}:${condition}`;
  const ref = maps?.ref?.get(key);
  const spRef = maps?.skinport?.get(key);
  const effectiveRef = ref && spRef ? Math.min(ref, spRef) : (spRef ?? ref);
  return effectiveRef || undefined;
}

/** Raw price over 5x the reference. Exactly 5x is not an outlier. */
export function exceedsReferenceCap(rawCents: number, refCents: number | undefined): boolean {
  return !!refCents && rawCents > refCents * INPUT_OUTLIER_REF_MULTIPLIER;
}

export function isInputPriceOutlier(args: InputPriceOutlierArgs): boolean {
  const old = args.oldPriceCents;
  if (old == null || old <= 0) return false;
  const newStored = storedInputCost(args.newPriceCents, args.feeSource);
  if (args.refCents) {
    return exceedsReferenceCap(args.newPriceCents, args.refCents) && newStored > JUMP_RATIO * old;
  }
  return newStored > NO_REF_RATIO * old && newStored - old > NO_REF_MIN_JUMP_CENTS;
}

let localMaps: InputReferenceMaps | null = null;
let localMapsBuiltAt = 0;
let referenceBuild: Promise<InputReferenceMaps> | null = null;

/** Drop the API/checker reference copy. Tests use this between schemas. */
export function resetInputReferenceCache(): void {
  localMaps = null;
  localMapsBuiltAt = 0;
  referenceBuild = null;
}

/**
 * Lookup bound to pricing.ts live maps after buildPriceCache. Otherwise a
 * module-local copy with a 5-minute TTL. Call before any BEGIN.
 */
export async function ensureInputReferences(pool: pg.Pool): Promise<InputRefLookup> {
  const { refPriceCache, skinportMedianCache } = await import("./pricing.js");
  if (refPriceCache.size > 0) {
    return (skinName, condition) => inputReferenceCents(skinName, condition, {
      ref: refPriceCache,
      skinport: skinportMedianCache,
    });
  }
  if (!localMaps || Date.now() - localMapsBuiltAt >= PRICE_CACHE_TTL_MS) {
    if (!referenceBuild) {
      referenceBuild = buildInputReferenceMaps(pool).finally(() => {
        referenceBuild = null;
      });
    }
    const pending = referenceBuild;
    localMaps = await pending;
    localMapsBuiltAt = Date.now();
  }
  const maps = localMaps;
  return (skinName, condition) => inputReferenceCents(skinName, condition, {
    ref: maps.refPriceCache,
    skinport: maps.skinportMedianCache,
  });
}

/** Mark real trade-ups stale. Preserves an existing preserved_at. Does not invalidate cache. */
export async function markTradeUpsOutlierStale(db: Queryable, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE trade_ups SET listing_status = CASE WHEN listing_status = 'active' THEN 'stale' ELSE listing_status END,
       preserved_at = COALESCE(preserved_at, NOW())
     WHERE id = ANY($1::int[]) AND is_theoretical = false`,
    [ids],
  );
  return rowCount ?? 0;
}

/** Trade-ups whose current listing raw price would trip the jump guard against the stored input. */
export async function findOutlierTradeUpIds(
  db: Queryable,
  tradeUpIds: number[],
  refLookup: InputRefLookup,
): Promise<Set<number>> {
  const flagged = new Set<number>();
  if (tradeUpIds.length === 0) return flagged;
  const { rows } = await db.query(
    `SELECT tui.trade_up_id, tui.skin_name, tui.float_value, tui.price_cents AS stored,
            tui.source, l.source AS listing_source, l.price_cents AS raw
     FROM trade_up_inputs tui
     JOIN listings l ON l.id = tui.listing_id
     WHERE tui.trade_up_id = ANY($1::int[])`,
    [tradeUpIds],
  );
  for (const r of rows as {
    trade_up_id: number; skin_name: string; float_value: number; stored: number;
    source: string | null; listing_source: string | null; raw: number;
  }[]) {
    const condition = floatToCondition(Number(r.float_value));
    const feeSource = r.listing_source ?? r.source ?? "csfloat";
    if (isInputPriceOutlier({
      skinName: r.skin_name,
      condition,
      newPriceCents: Number(r.raw),
      oldPriceCents: Number(r.stored),
      feeSource,
      refCents: refLookup(r.skin_name, condition),
    })) flagged.add(r.trade_up_id);
  }
  return flagged;
}
