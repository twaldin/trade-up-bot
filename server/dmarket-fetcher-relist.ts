/**
 * Relist a DMarket offer that came back under a new offer id before the
 * fetcher deletes the old row and cascades trade-ups to partial.
 *
 * v2 offers identify a listing by offerId, which changes on relist. A match
 * always requires the same skin and a float within 1e-7, plus paint seed when
 * both sides know one. The classic inspect form `[SM]<id>A<asset>D<d>` is only
 * a tie-breaker when several offers share that float and seed. Valve's hex
 * preview links have no A<asset>D segment and must not yield an id.
 */

import type pg from "pg";
import { applyListingPriceToInputs, ensureInputReferences } from "./engine.js";
import { cacheInvalidatePrefix } from "./redis.js";

export const RELIST_FLOAT_EPSILON = 1e-7;

export interface DMarketRelistSide {
  id: string;
  skinName: string;
  floatValue: number;
  paintSeed: number | null;
  assetId: string | null;
  priceCents: number;
  phase?: string | null;
}

export interface DMarketRelink {
  oldId: string;
  newId: string;
  priceCents: number;
}

export interface DMarketRelinkPlan {
  relinks: DMarketRelink[];
  deleteIds: string[];
  contested: number;
}

/** Classic Steam inspect URI only. Hex preview links return null. */
const CLASSIC_INSPECT_ASSET = /[SM]\d+A(\d+)D/;

export function assetIdFromInspect(inspect: string | null | undefined): string | null {
  if (!inspect) return null;
  let decoded = inspect;
  try { decoded = decodeURIComponent(inspect); } catch { decoded = inspect; }
  const match = CLASSIC_INSPECT_ASSET.exec(decoded);
  return match ? match[1] : null;
}

function floatsMatch(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= RELIST_FLOAT_EPSILON;
}

function seedsCompatible(a: number | null, b: number | null): boolean {
  if (a === 0 || b === 0) return false;
  if (a == null || b == null) return true;
  return a === b;
}

function phasesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return a === b;
}

export function isDMarketRelist(stored: DMarketRelistSide, incoming: DMarketRelistSide): boolean {
  if (stored.id === incoming.id) return false;
  if (stored.skinName !== incoming.skinName) return false;
  if (!floatsMatch(stored.floatValue, incoming.floatValue)) return false;
  if (!seedsCompatible(stored.paintSeed, incoming.paintSeed)) return false;
  return phasesCompatible(stored.phase, incoming.phase);
}

/** One incoming offer per stored row. Shared or multiple hits are not relinked. */
export function planDMarketRelinks(
  stored: readonly DMarketRelistSide[],
  incoming: readonly DMarketRelistSide[],
): DMarketRelinkPlan {
  const incomingIds = new Set(incoming.map(item => item.id));
  const missing = stored.filter(row => !incomingIds.has(row.id));
  const chosen = new Map<string, DMarketRelink>();
  const contestedOffers = new Set<string>();
  const deleteIds: string[] = [];
  let contested = 0;

  for (const row of missing) {
    const hits = incoming.filter(item => isDMarketRelist(row, item));
    let match: DMarketRelistSide | undefined;
    if (hits.length === 1) match = hits[0];
    else if (hits.length > 1 && row.assetId) {
      const byAsset = hits.filter(hit => hit.assetId != null && hit.assetId === row.assetId);
      if (byAsset.length === 1) match = byAsset[0];
    }
    if (!match) {
      deleteIds.push(row.id);
      if (hits.length > 1) contested++;
      continue;
    }
    if (contestedOffers.has(match.id)) {
      deleteIds.push(row.id);
      contested++;
      continue;
    }
    const previous = [...chosen.entries()].find(([, relink]) => relink.newId === match.id);
    if (previous) {
      contestedOffers.add(match.id);
      deleteIds.push(previous[0], row.id);
      chosen.delete(previous[0]);
      contested += 2;
      continue;
    }
    chosen.set(row.id, { oldId: row.id, newId: match.id, priceCents: match.priceCents });
  }

  return { relinks: [...chosen.values()], deleteIds, contested };
}

/**
 * Point trade-up inputs at the new offer, reprice through applyListingPriceToInputs,
 * and delete the old listing. A failed relink is rolled back and returned in
 * `failedIds` so the caller can delete that one listing and cascade it.
 */
export async function applyDMarketRelinks(
  pool: pg.Pool,
  relinks: readonly DMarketRelink[],
): Promise<{ applied: number; failedIds: string[] }> {
  const failedIds: string[] = [];
  if (relinks.length === 0) return { applied: 0, failedIds };
  const refLookup = await ensureInputReferences(pool);
  let applied = 0;
  for (const relink of relinks) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query(
        `UPDATE trade_up_inputs SET listing_id = $1 WHERE listing_id = $2`,
        [relink.newId, relink.oldId],
      );
      await applyListingPriceToInputs(client, relink.newId, relink.priceCents, "dmarket", refLookup);
      await client.query(
        `UPDATE listings AS fresh
         SET claimed_by = old.claimed_by, claimed_at = old.claimed_at
         FROM listings AS old
         WHERE fresh.id = $1 AND old.id = $2 AND old.claimed_by IS NOT NULL`,
        [relink.newId, relink.oldId],
      );
      await client.query(`DELETE FROM listings WHERE id = $1`, [relink.oldId]);
      await client.query("COMMIT");
      applied++;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        const original = err instanceof Error ? err.message : String(err);
        const rollback = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        console.warn(`DMarket relink rollback failed after ${original}: ${rollback}`);
      }
      failedIds.push(relink.oldId);
    } finally {
      client.release();
    }
  }
  if (applied > 0) {
    try { await cacheInvalidatePrefix("tu:"); } catch { /* non-critical */ }
  }
  return { applied, failedIds };
}
