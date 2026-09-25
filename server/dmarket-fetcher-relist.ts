/**
 * Relist a DMarket offer that came back under a new offer id before the
 * fetcher deletes the old row and cascades trade-ups to partial.
 *
 * v2 offers identify a listing by offerId, which changes on relist. There is
 * no separate asset id on DMarketV2Offer. An inspect URI (`A<assetId>D`) is
 * the only stable per-item id in that payload; prefer it when both sides
 * have one. Otherwise match skin, float within 1e-7, and paint seed when
 * both are known.
 */

import type pg from "pg";
import { applyListingPriceToInputs } from "./engine.js";

export const RELIST_FLOAT_EPSILON = 1e-7;

export interface DMarketRelistSide {
  id: string;
  skinName: string;
  floatValue: number;
  paintSeed: number | null;
  assetId: string | null;
  priceCents: number;
}

export interface DMarketRelink {
  oldId: string;
  newId: string;
  priceCents: number;
}

const INSPECT_ASSET = /A(\d+)D/;

export function assetIdFromInspect(inspect: string | null | undefined): string | null {
  if (!inspect) return null;
  let decoded = inspect;
  try { decoded = decodeURIComponent(inspect); } catch { decoded = inspect; }
  const match = INSPECT_ASSET.exec(decoded);
  return match ? match[1] : null;
}

function floatsMatch(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= RELIST_FLOAT_EPSILON;
}

function seedsCompatible(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return a === b;
}

export function isDMarketRelist(stored: DMarketRelistSide, incoming: DMarketRelistSide): boolean {
  if (stored.id === incoming.id) return false;
  if (stored.skinName !== incoming.skinName) return false;
  if (stored.assetId && incoming.assetId) return stored.assetId === incoming.assetId;
  if (!floatsMatch(stored.floatValue, incoming.floatValue)) return false;
  return seedsCompatible(stored.paintSeed, incoming.paintSeed);
}

/** One incoming offer per stored row. Shared or multiple hits are not relinked. */
export function planDMarketRelinks(
  stored: readonly DMarketRelistSide[],
  incoming: readonly DMarketRelistSide[],
): { relinks: DMarketRelink[]; deleteIds: string[] } {
  const incomingIds = new Set(incoming.map(item => item.id));
  const missing = stored.filter(row => !incomingIds.has(row.id));
  const chosen = new Map<string, DMarketRelink>();
  const deleteIds: string[] = [];

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
      continue;
    }
    const previous = [...chosen.entries()].find(([, relink]) => relink.newId === match.id);
    if (previous) {
      deleteIds.push(previous[0], row.id);
      chosen.delete(previous[0]);
      continue;
    }
    chosen.set(row.id, { oldId: row.id, newId: match.id, priceCents: match.priceCents });
  }

  return { relinks: [...chosen.values()], deleteIds };
}

/**
 * Point trade-up inputs at the new offer, reprice through applyListingPriceToInputs,
 * and delete the old listing. Does not cascade. Caller cascades `deleteIds` only.
 */
export async function applyDMarketRelinks(pool: pg.Pool, relinks: readonly DMarketRelink[]): Promise<number> {
  let applied = 0;
  for (const relink of relinks) {
    await pool.query(
      `UPDATE trade_up_inputs SET listing_id = $1 WHERE listing_id = $2`,
      [relink.newId, relink.oldId],
    );
    await applyListingPriceToInputs(pool, relink.newId, relink.priceCents, "dmarket");
    await pool.query(`DELETE FROM listings WHERE id = $1`, [relink.oldId]);
    applied++;
  }
  return applied;
}
