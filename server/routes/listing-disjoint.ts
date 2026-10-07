/**
 * Listing-disjoint ranking for the default /api/trade-ups board.
 *
 * Discovery dedups by exact listing set, so one strong core spawns many
 * one-input variants that are each scored independently. On prod the top 50
 * shared listings in 49 rows (one listing in 48 of them): only ~1 of those
 * rows is actually buyable. This pass walks the already-ranked ids and keeps a
 * row only if none of its listings is used by a kept, higher-ranked row.
 *
 * Display only: scores, order among kept rows, and stored data are untouched.
 */
import type pg from "pg";

/** `?overlap=all` restores the raw ranking (and adds shared_with_rank). */
export type OverlapMode = "disjoint" | "all";

export function parseOverlapMode(raw: unknown): OverlapMode {
  return raw === "all" ? "all" : "disjoint";
}

/**
 * Candidates ranked per disjoint snapshot. Prod keeps ~1 in 4 of the top 200,
 * so 5x the snapshot size leaves headroom to fill RANK_SNAPSHOT_SIZE.
 */
export const DISJOINT_CANDIDATE_FACTOR = 5;

/** Greedy pass: keep a row unless a kept, higher-ranked row already uses one of its listings. */
export function keepListingDisjoint(
  rankedIds: readonly number[],
  listingsById: ReadonlyMap<number, readonly string[]>,
  limit: number,
): number[] {
  return keepListingDisjointScan(rankedIds, listingsById, limit).kept;
}

/** Same as keepListingDisjoint, plus how many ranked candidates were consumed. */
export function keepListingDisjointScan(
  rankedIds: readonly number[],
  listingsById: ReadonlyMap<number, readonly string[]>,
  limit: number,
): { kept: number[]; scanned: number } {
  const used = new Set<string>();
  const kept: number[] = [];
  let scanned = 0;
  for (const id of rankedIds) {
    if (kept.length >= limit) break;
    scanned++;
    const listings = listingsById.get(id) ?? [];
    if (listings.some((lid) => used.has(lid))) continue;
    for (const lid of listings) used.add(lid);
    kept.push(id);
  }
  return { kept, scanned };
}

/**
 * Deduped rank snapshot from ranked candidates.
 *
 * total / profitable describe the kept list, so pages and counts agree.
 * hasMore is true when that list is a lower bound: either the RANK_SNAPSHOT_SIZE
 * cap was hit with candidates left, or the candidate window (limit x
 * DISJOINT_CANDIDATE_FACTOR) was full while the raw list is longer. Rows past
 * the window are not deduped (doing so needs another full window sort), so the
 * count is intentionally reported as "at least", never inflated.
 */
export function buildDisjointSnapshot(args: {
  ranked: ReadonlyArray<{ id: number; profitCents: number }>;
  listingsById: ReadonlyMap<number, readonly string[]>;
  limit: number;
  candidateLimit: number;
  rawTotal: number;
}): { ids: number[]; total: number; profitable: number; deduped: true; rawTotal: number; hasMore: boolean } {
  const ids = args.ranked.map((r) => r.id);
  const { kept, scanned } = keepListingDisjointScan(ids, args.listingsById, args.limit);
  const profitById = new Map(args.ranked.map((r) => [r.id, r.profitCents]));
  const profitable = kept.reduce((n, id) => n + ((profitById.get(id) ?? 0) > 0 ? 1 : 0), 0);
  const capHitWithRowsLeft = kept.length >= args.limit && (scanned < ids.length || args.rawTotal > ids.length);
  const windowExhausted = ids.length >= args.candidateLimit && args.rawTotal > ids.length;
  return {
    ids: kept,
    total: kept.length,
    profitable,
    deduped: true,
    rawTotal: args.rawTotal,
    hasMore: capHitWithRowsLeft || windowExhausted,
  };
}

/**
 * For each id, the 1-based rank of the highest-ranked earlier row that shares a
 * listing with it, or null. Ranks are positions in `rankedIds`.
 */
export function sharedWithRanks(
  rankedIds: readonly number[],
  listingsById: ReadonlyMap<number, readonly string[]>,
): Array<number | null> {
  const firstRank = new Map<string, number>();
  return rankedIds.map((id, index) => {
    let shared: number | null = null;
    for (const lid of listingsById.get(id) ?? []) {
      const rank = firstRank.get(lid);
      if (rank !== undefined) {
        if (shared === null || rank < shared) shared = rank;
      } else {
        firstRank.set(lid, index + 1);
      }
    }
    return shared;
  });
}

/** One indexed read (idx_trade_up_inputs_trade) for every candidate's listing ids. */
export async function loadListingIds(
  pool: pg.Pool,
  ids: readonly number[],
): Promise<Map<number, string[]>> {
  const byId = new Map<number, string[]>();
  if (ids.length === 0) return byId;
  const { rows } = await pool.query<{ trade_up_id: number; listing_ids: string[] }>(
    `SELECT trade_up_id, array_agg(listing_id) AS listing_ids
       FROM trade_up_inputs
      WHERE trade_up_id = ANY($1::int[])
      GROUP BY trade_up_id`,
    [ids],
  );
  for (const row of rows) byId.set(Number(row.trade_up_id), row.listing_ids);
  return byId;
}
