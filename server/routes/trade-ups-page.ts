/**
 * Page assembly helpers for GET /api/trade-ups.
 *
 * Two read-side speedups live here; neither touches scoring or ordering:
 *  - `include=outcomes,inputs` embeds what the console board otherwise
 *    fetched with two extra requests per row, which burned the per-IP limiter.
 *  - A rank snapshot: the diversified board's window query sorts every active
 *    row, and each page used to repeat it only to take a different OFFSET.
 *    The ordered ids are computed once per (filters, sort) and cached under
 *    `tu:` so every existing `tu:` invalidation also drops them.
 */
import { createHash } from "node:crypto";
import type { InputSummary, TradeUpOutcome } from "../../shared/types.js";

/** Embedding is for board-sized pages; bulk callers keep the lean payload. */
export const LIST_INCLUDE_MAX_PER_PAGE = 100;

/** Ids kept per snapshot: ~83 board pages of 12. Deeper pages use the live query. */
export const RANK_SNAPSHOT_SIZE = 1000;

/** Matches the list route's cache TTL; daemon cycles invalidate `tu:` sooner. */
export const RANK_SNAPSHOT_TTL_SECONDS = 1800;

export interface ListIncludes {
  outcomes: boolean;
  inputs: boolean;
}

export function parseListIncludes(raw: unknown, perPage: number): ListIncludes {
  const none = { outcomes: false, inputs: false };
  if (typeof raw !== "string" || perPage > LIST_INCLUDE_MAX_PER_PAGE) return none;
  const parts = new Set(raw.split(",").map((part) => part.trim()));
  return { outcomes: parts.has("outcomes"), inputs: parts.has("inputs") };
}

/** One `trade_up_inputs` row LEFT JOINed to its live listing. */
export interface InputJoinRow {
  trade_up_id: number;
  listing_id: string;
  skin_id: string;
  skin_name: string;
  collection_name: string;
  price_cents: number;
  float_value: number;
  condition: string;
  source: string;
  marketplace_id: string | null;
  live_listing_id: string | null;
  listing_claimed_by: string | null;
}

/** Same shape as a row from GET /api/trade-up/:id/inputs (`tui.*`, marketplace_id, flags). */
export type EmbeddedInput = Omit<InputJoinRow, "live_listing_id" | "listing_claimed_by"> & {
  missing?: true;
  claimed_by_other?: true;
};

export interface PageInputs {
  summary: InputSummary;
  realInputCount: number;
  missingCount: number;
  inputs: EmbeddedInput[];
}

/**
 * Everything the list needs per trade-up from one joined input query:
 * canonical counts (same predicates as the old COUNT FILTER query), the
 * compact summary, and `/api/trade-up/:id/inputs`-shaped rows.
 */
export function groupInputRows(rows: readonly InputJoinRow[]): Map<number, PageInputs> {
  const byId = new Map<number, InputJoinRow[]>();
  for (const row of rows) {
    const id = Number(row.trade_up_id);
    const list = byId.get(id) ?? [];
    list.push(row);
    byId.set(id, list);
  }

  const result = new Map<number, PageInputs>();
  for (const [id, list] of byId) {
    const skinCounts = new Map<string, { count: number; condition: string }>();
    const collections = new Set<string>();
    let realInputCount = 0;
    let missingCount = 0;
    const inputs: EmbeddedInput[] = [];

    for (const row of list) {
      const existing = skinCounts.get(row.skin_name);
      if (existing) existing.count++;
      else skinCounts.set(row.skin_name, { count: 1, condition: row.condition });
      collections.add(row.collection_name);

      const listingGone = row.live_listing_id === null;
      if (!row.listing_id.startsWith("theor")) {
        realInputCount++;
        if (listingGone) missingCount++;
      }

      const { live_listing_id: _live, listing_claimed_by: claimedBy, ...input } = row;
      inputs.push({
        ...input,
        trade_up_id: id,
        ...(listingGone ? { missing: true as const } : {}),
        ...(!listingGone && claimedBy !== null ? { claimed_by_other: true as const } : {}),
      });
    }

    result.set(id, {
      summary: {
        skins: [...skinCounts.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([name, info]) => ({ name, count: info.count, condition: info.condition })),
        collections: [...collections],
        input_count: list.length,
      },
      realInputCount,
      missingCount,
      inputs,
    });
  }
  return result;
}

export function parseOutcomesJson(raw: string | null | undefined): TradeUpOutcome[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface RankSnapshot {
  ids: number[];
  total: number;
}

export interface RankSnapshotStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: RankSnapshot, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function rankSnapshotKey(query: {
  fromWhere: string;
  sortCol: string;
  sortOrder: string;
  params: readonly unknown[];
}): string {
  const digest = createHash("sha1")
    .update(JSON.stringify([query.fromWhere, query.sortCol, query.sortOrder, query.params]))
    .digest("hex");
  return `tu:rank:${digest}`;
}

export function snapshotCoversPage(offset: number, perPage: number): boolean {
  return offset >= 0 && offset + perPage <= RANK_SNAPSHOT_SIZE;
}

/** Rows in snapshot order, or null if any id no longer resolves. */
export function orderByIds<T extends { id: number }>(rows: readonly T[], ids: readonly number[]): T[] | null {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const ordered: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return null;
    ordered.push(row);
  }
  return ordered;
}

function isRankSnapshot(value: unknown): value is RankSnapshot {
  if (!value || typeof value !== "object") return false;
  const ids: unknown = Reflect.get(value, "ids");
  const total: unknown = Reflect.get(value, "total");
  return Array.isArray(ids) && ids.every((id) => typeof id === "number") && typeof total === "number";
}

const inflightSnapshots = new Map<string, Promise<RankSnapshot>>();

/** Stored snapshot, else one shared computation per key (concurrent misses coalesce). */
export async function loadRankSnapshot(
  key: string,
  store: RankSnapshotStore,
  compute: () => Promise<RankSnapshot>,
): Promise<RankSnapshot> {
  const stored = await store.get(key).catch(() => null);
  if (isRankSnapshot(stored)) return stored;

  const pending = inflightSnapshots.get(key);
  if (pending) return pending;

  const run = (async () => {
    const snapshot = await compute();
    await store.set(key, snapshot, RANK_SNAPSHOT_TTL_SECONDS).catch(() => {});
    return snapshot;
  })();
  inflightSnapshots.set(key, run);
  try {
    return await run;
  } finally {
    inflightSnapshots.delete(key);
  }
}
