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
import {
  applyListingPriceToInputs, cascadeTradeUpStatuses, drainDMarketRelinkRecomputes, ensureInputReferences,
  lockTradeUpInputsInIdOrder, pruneDMarketRelinkMap, recordDMarketRelink, recordDMarketRelinkRecompute,
  type DMarketRelinkRecomputeOptions,
} from "./engine.js";
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

export type RelinkSkipReason = "new_id_already_input" | "claimed_target";

export interface RelinkSkip {
  oldId: string;
  reason: RelinkSkipReason;
}

export interface RelinkApplyResult {
  applied: number;
  failedIds: string[];
  /**
   * 55P03/40P01. Rolled back and left in the database so the next cycle
   * plans the relink again. Not a delete.
   */
  deferredIds: string[];
  skipped: RelinkSkip[];
  /** True when reference prices could not be loaded. Callers must not delete. */
  referenceLoadFailed: boolean;
}

export interface ApplyDMarketRelinkHooks {
  /** Test barrier after BEGIN and before the listing locks. */
  beforeListingLock?: () => Promise<void>;
  /** Test barrier after the relink commits and before straggler inputs are moved. */
  beforeStragglerSweep?: () => Promise<void>;
  /** After the listing transaction commits and before cost recompute. Throw to simulate a kill. */
  afterRelinkCommit?: () => Promise<void>;
  /** Leave the durable recompute marker for a later drain. */
  deferRecompute?: boolean;
  /** Fired once the listing rows are locked. */
  onListingLocked?: () => void;
  /** Fired immediately before the listing transaction commits. */
  onListingCommitted?: () => void;
  recompute?: DMarketRelinkRecomputeOptions;
}

/** S or M must start the inspect argument. A later copy of the token is not an asset id. */
const CLASSIC_INSPECT_ASSET = /^[SM]\d+A(\d+)D/;
const INSPECT_MARKER = "csgo_econ_action_preview";

export function assetIdFromInspect(inspect: string | null | undefined): string | null {
  if (!inspect) return null;
  let decoded = inspect;
  try { decoded = decodeURIComponent(inspect); } catch { decoded = inspect; }
  const at = decoded.lastIndexOf(INSPECT_MARKER);
  const payload = (at === -1 ? decoded : decoded.slice(at + INSPECT_MARKER.length)).trim();
  const match = CLASSIC_INSPECT_ASSET.exec(payload);
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

/** False when reference prices failed to load. Callers must skip deletes for the cycle. */
export async function referencePricesAllowDeletes(pool: pg.Pool): Promise<boolean> {
  try {
    await ensureInputReferences(pool);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`DMarket reference-price load failed; skipping deletes this cycle: ${reason}`);
    return false;
  }
}

/** Ids the caller may delete. Empty when the reference-price load failed. Deferred ids stay. */
export function listingIdsToDelete(plan: DMarketRelinkPlan, applied: RelinkApplyResult): string[] {
  if (applied.referenceLoadFailed) return [];
  return [...plan.deleteIds, ...applied.failedIds, ...applied.skipped.map(skip => skip.oldId)];
}

export function relinkLogLine(
  skinName: string,
  plan: DMarketRelinkPlan,
  applied: RelinkApplyResult,
): string {
  const contested = plan.contested + applied.skipped.length;
  const deleted = plan.deleteIds.length + applied.failedIds.length + applied.skipped.length;
  const reasons = applied.skipped.map(skip => skip.reason).join(",");
  const reason = reasons ? ` (${reasons})` : "";
  const deferred = applied.deferredIds.length > 0 ? ` deferred ${applied.deferredIds.length}` : "";
  return `  ${skinName}: relinked ${applied.applied} deleted ${deleted} contested ${contested} failed ${applied.failedIds.length}${deferred}${reason}`;
}

/**
 * Move inputs still on the old id, including rows inserted after the relink write.
 * A cascade that already ran while the input named the deleted id left the
 * trade-up partial. Re-evaluate on the live id after the move so a fully live
 * trade-up is active again. If the live row is missing or claimed, cascade the
 * old id instead of pointing inputs at it.
 */
async function sweepRelinkedInputs(pool: pg.Pool, oldId: string, newId: string): Promise<void> {
  const { rows } = await pool.query<{ claimed_by: string | null }>(
    `SELECT claimed_by FROM listings WHERE id = $1`,
    [newId],
  );
  if (rows[0] && rows[0].claimed_by == null) {
    await pool.query(
      `UPDATE trade_up_inputs SET listing_id = $1 WHERE listing_id = $2`,
      [newId, oldId],
    );
    await cascadeTradeUpStatuses(pool, [newId]);
    return;
  }
  await cascadeTradeUpStatuses(pool, [oldId]);
}

/**
 * Point trade-up inputs at the new offer and delete the old listing. The
 * listing transaction commits before trade-up costs are recomputed, so it does
 * not hold the listing row across that work. Affected trade-up ids are stored
 * in sync_meta in the same transaction; a crash before recompute is recovered
 * by the next drain. Records old id → new id so a later save can follow the
 * relink. A failed relink is rolled back and returned in `failedIds` so the
 * caller can delete that one listing and cascade it. A lock timeout or
 * deadlock (55P03, 40P01) is rolled back into `deferredIds` instead: the old
 * listing stays, and the next cycle plans the relink again. When the
 * reference-price load throws, nothing is applied and `referenceLoadFailed`
 * is set so the caller skips deletes for the cycle. After commit, inputs that
 * landed on the old id are retargeted or cascaded.
 */

const RELINK_DEFER_CODES = new Set(["55P03", "40P01"]);

function pgErrorCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}
export async function applyDMarketRelinks(
  pool: pg.Pool,
  relinks: readonly DMarketRelink[],
  hooks?: ApplyDMarketRelinkHooks,
): Promise<RelinkApplyResult> {
  const failedIds: string[] = [];
  const deferredIds: string[] = [];
  const skipped: RelinkSkip[] = [];
  if (relinks.length === 0) return { applied: 0, failedIds, deferredIds, skipped, referenceLoadFailed: false };
  let refLookup;
  try {
    refLookup = await ensureInputReferences(pool);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`DMarket relink skipped; reference-price load failed: ${reason}`);
    return { applied: 0, failedIds, deferredIds, skipped, referenceLoadFailed: true };
  }
  if (!hooks?.deferRecompute) {
    try {
      await drainDMarketRelinkRecomputes(pool, hooks?.recompute);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`DMarket relink recompute drain failed: ${reason}`);
    }
  }
  let applied = 0;
  for (const relink of relinks) {
    const client = await pool.connect();
    let released = false;
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      if (hooks?.beforeListingLock) await hooks.beforeListingLock();
      // Lock one listing at a time, sorted by id, before reading claimed_by.
      // A merge holding FOR KEY SHARE on an earlier id blocks here; the input
      // UPDATE then sees the rows that merge committed. One statement with
      // ORDER BY does not acquire the row locks in that order. The claim copy
      // uses the values read under these locks, not a later unlocked read.
      const locked = new Map<string, { claimed_by: string | null; claimed_at: Date | null }>();
      for (const id of [...new Set([relink.oldId, relink.newId])].sort()) {
        const { rows } = await client.query<{ id: string; claimed_by: string | null; claimed_at: Date | null }>(
          `SELECT id, claimed_by, claimed_at FROM listings WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (rows[0]) locked.set(rows[0].id, { claimed_by: rows[0].claimed_by, claimed_at: rows[0].claimed_at });
      }
      if (hooks?.onListingLocked) hooks.onListingLocked();
      if (locked.get(relink.newId)?.claimed_by) {
        await client.query("ROLLBACK");
        skipped.push({ oldId: relink.oldId, reason: "claimed_target" });
        continue;
      }
      const { rows: used } = await client.query(
        `SELECT 1 FROM trade_up_inputs WHERE listing_id = $1 LIMIT 1`,
        [relink.newId],
      );
      if (used.length > 0) {
        await client.query("ROLLBACK");
        skipped.push({ oldId: relink.oldId, reason: "new_id_already_input" });
        continue;
      }
      const { rows: inputKeys } = await client.query<{ trade_up_id: number; listing_id: string }>(
        `SELECT trade_up_id, listing_id FROM trade_up_inputs WHERE listing_id = $1`,
        [relink.oldId],
      );
      await lockTradeUpInputsInIdOrder(
        client,
        inputKeys.map(row => ({ tradeUpId: Number(row.trade_up_id), listingId: row.listing_id })),
      );
      await client.query(
        `UPDATE trade_up_inputs SET listing_id = $1 WHERE listing_id = $2`,
        [relink.newId, relink.oldId],
      );
      const priced = await applyListingPriceToInputs(
        client,
        relink.newId,
        relink.priceCents,
        "dmarket",
        refLookup,
        { deferTradeUpWrites: true, deferInputPrices: true },
      );
      const oldClaim = locked.get(relink.oldId);
      if (oldClaim?.claimed_by) {
        await client.query(
          `UPDATE listings SET claimed_by = $2, claimed_at = $3 WHERE id = $1`,
          [relink.newId, oldClaim.claimed_by, oldClaim.claimed_at],
        );
      }
      await recordDMarketRelink(client, relink.oldId, relink.newId);
      await recordDMarketRelinkRecompute(
        client,
        relink.oldId,
        priced.recomputeIds,
        priced.flaggedIds,
        relink.newId,
        relink.priceCents,
      );
      await client.query(`DELETE FROM listings WHERE id = $1`, [relink.oldId]);
      if (hooks?.onListingCommitted) hooks.onListingCommitted();
      await client.query("COMMIT");
      committed = true;
      applied++;
      client.release();
      released = true;
      let killed: unknown;
      try {
        if (hooks?.afterRelinkCommit) await hooks.afterRelinkCommit();
      } catch (err) {
        killed = err;
      }
      if (!killed && !hooks?.deferRecompute) {
        try {
          await drainDMarketRelinkRecomputes(pool, hooks?.recompute);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`DMarket relink recompute drain failed: ${reason}`);
        }
      }
      if (!killed) {
        try {
          if (hooks?.beforeStragglerSweep) await hooks.beforeStragglerSweep();
          await sweepRelinkedInputs(pool, relink.oldId, relink.newId);
        } catch (sweepErr) {
          const reason = sweepErr instanceof Error ? sweepErr.message : String(sweepErr);
          console.warn(`DMarket relink sweep failed ${relink.oldId} -> ${relink.newId}: ${reason}`);
        }
      }
      if (killed) throw killed;
    } catch (err) {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          const original = err instanceof Error ? err.message : String(err);
          const rollback = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          console.warn(`DMarket relink rollback failed after ${original}: ${rollback}`);
        }
        const code = pgErrorCode(err);
        const reason = err instanceof Error ? err.message : String(err);
        if (RELINK_DEFER_CODES.has(code)) {
          console.error(
            `DMarket relink deferred ${relink.oldId} -> ${relink.newId}: ${code} ${reason}; listing kept for the next cycle`,
          );
          deferredIds.push(relink.oldId);
          client.release();
        } else {
          console.warn(`DMarket relink failed ${relink.oldId} -> ${relink.newId}: ${reason}`);
          failedIds.push(relink.oldId);
          client.release(err instanceof Error ? err : new Error(reason));
        }
        released = true;
      } else if (!released) {
        client.release();
        released = true;
        throw err;
      } else {
        throw err;
      }
    } finally {
      if (!released) client.release();
    }
  }
  if (applied > 0) {
    try { await pruneDMarketRelinkMap(pool); } catch { /* non-critical */ }
    try { await cacheInvalidatePrefix("tu:"); } catch { /* non-critical */ }
  }
  return { applied, failedIds, deferredIds, skipped, referenceLoadFailed: false };
}
