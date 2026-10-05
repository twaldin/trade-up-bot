/**
 * One cached read for the search landing pages.
 * Each branch is a LIMIT over the type+profit index, not a full-table window.
 * Memory + Redis so a crawler walking every tier does not repeat the query.
 */
import type pg from "pg";
import { cacheGet, cacheSet } from "./redis.js";
import { getGlobalStats } from "./routes/status.js";
import {
  EMPTY_INTENT_SNAPSHOT,
  TRADE_UP_TIERS,
  type IntentRow,
  type IntentSnapshot,
} from "../src/preview/lib/intent-landings.js";

export const INTENT_SNAPSHOT_CACHE_KEY = "seo_intent_snapshot_v1";
export const INTENT_SNAPSHOT_TTL_SEC = 1800;
const FAILURE_TTL_MS = 60_000;

const TIER_TYPES = TRADE_UP_TIERS.map((tier) => tier.type);

export function buildIntentSnapshotQuery(types: readonly string[] = TIER_TYPES): { text: string; values: unknown[] } {
  const branch = (typeExpr: string, limit: number, bucketExpr: string) => `(
    SELECT ${bucketExpr} AS bucket, id, type, total_cost_cents, profit_cents, roi_percentage, chance_to_profit
    FROM trade_ups
    WHERE listing_status = 'active'
      AND is_theoretical = false
      AND profit_cents > 100
      AND (preserved_at IS NULL OR preserved_at > NOW() - INTERVAL '7 days')
      AND type = ${typeExpr}
    ORDER BY profit_cents DESC
    LIMIT ${limit}
  )`;

  const branches = [
    branch("ANY($1::text[])", 12, "'top'::text"),
    ...types.map((_, index) => branch(`$${index + 2}`, 8, `$${index + 2}`)),
  ];
  return {
    text: branches.join("\nUNION ALL\n"),
    values: [Array.from(types), ...types],
  };
}

interface SnapshotQueryRow {
  bucket: string;
  id: number;
  type: string;
  total_cost_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
}

function asRow(row: SnapshotQueryRow): IntentRow {
  return {
    id: Number(row.id),
    type: String(row.type),
    total_cost_cents: Number(row.total_cost_cents),
    profit_cents: Number(row.profit_cents),
    roi_percentage: Number(row.roi_percentage),
    chance_to_profit: Number(row.chance_to_profit),
  };
}

export async function queryIntentSnapshot(pool: pg.Pool): Promise<IntentSnapshot> {
  const query = buildIntentSnapshotQuery();
  const { rows } = await pool.query<SnapshotQueryRow>(query.text, query.values);
  const top: IntentRow[] = [];
  const byType: Record<string, IntentRow[]> = {};
  for (const type of TIER_TYPES) byType[type] = [];
  for (const row of rows) {
    const parsed = asRow(row);
    if (row.bucket === "top") top.push(parsed);
    else if (byType[row.bucket]) byType[row.bucket].push(parsed);
  }
  return { active: null, profitable: null, top, byType };
}

export async function loadIntentCounts(pool: pg.Pool): Promise<{ active: number | null; profitable: number | null }> {
  const stats = await getGlobalStats(pool);
  const active = stats.active_trade_ups;
  const profitable = stats.active_profitable_trade_ups;
  return {
    active: typeof active === "number" ? active : null,
    profitable: typeof profitable === "number" ? profitable : null,
  };
}

interface SnapshotMemory {
  expires: number;
  snapshot: IntentSnapshot;
}

let memory: SnapshotMemory | null = null;

export function clearIntentSnapshotCache(): void {
  memory = null;
}

export interface IntentSnapshotDeps {
  loadCounts?: (pool: pg.Pool) => Promise<{ active: number | null; profitable: number | null }>;
  cacheGet?: (key: string) => Promise<IntentSnapshot | null>;
  cacheSet?: (key: string, data: IntentSnapshot, ttlSeconds: number) => Promise<void>;
  now?: () => number;
}

export async function loadIntentSnapshot(pool: pg.Pool, deps: IntentSnapshotDeps = {}): Promise<IntentSnapshot> {
  const now = deps.now ?? Date.now;
  const readCache = deps.cacheGet ?? ((key: string) => cacheGet<IntentSnapshot>(key));
  const writeCache = deps.cacheSet ?? ((key: string, data: IntentSnapshot, ttl: number) => cacheSet(key, data, ttl));
  const counts = deps.loadCounts ?? loadIntentCounts;
  const at = now();
  if (memory && memory.expires > at) return memory.snapshot;

  try {
    const cached = await readCache(INTENT_SNAPSHOT_CACHE_KEY);
    if (cached && Array.isArray(cached.top) && cached.byType) {
      memory = { expires: at + INTENT_SNAPSHOT_TTL_SEC * 1000, snapshot: cached };
      return cached;
    }
  } catch { /* redis down */ }

  try {
    const queried = await queryIntentSnapshot(pool);
    let active: number | null = null;
    let profitable: number | null = null;
    try {
      const loaded = await counts(pool);
      active = loaded.active;
      profitable = loaded.profitable;
    } catch { /* counts omitted; the table still renders */ }
    const snapshot: IntentSnapshot = { ...queried, active, profitable };
    memory = { expires: at + INTENT_SNAPSHOT_TTL_SEC * 1000, snapshot };
    writeCache(INTENT_SNAPSHOT_CACHE_KEY, snapshot, INTENT_SNAPSHOT_TTL_SEC).catch(() => {});
    return snapshot;
  } catch (err) {
    console.error("Intent snapshot failed:", err instanceof Error ? err.message : err);
    memory = { expires: at + FAILURE_TTL_MS, snapshot: EMPTY_INTENT_SNAPSHOT };
    return EMPTY_INTENT_SNAPSHOT;
  }
}
