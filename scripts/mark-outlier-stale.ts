/**
 * One-time stale mark for active trade-ups whose cost is over 20x EV.
 *
 * Dry-run by default. Writes nothing unless --apply is passed alone with --csv.
 * Do not run --apply against production without CEO approval. Keep the CSV.
 *
 *   npx tsx scripts/mark-outlier-stale.ts
 *   npx tsx scripts/mark-outlier-stale.ts --apply --csv mark-outlier-stale.csv
 *   npx tsx scripts/mark-outlier-stale.ts --from-id 1200
 *
 * Inputs over 5x their reference are reported and never marked by this script.
 * Revert CSV (`status,trade_up_id,old_listing_status,old_preserved_at,reason,listing_id`):
 * pending before COMMIT, committed after. A crash in that window leaves pending.
 */

import fs from "fs";
import pg from "pg";
import { buildInputReferenceMaps, inputReferenceCents, exceedsReferenceCap } from "../server/engine/input-outlier.js";
import { floatToCondition } from "../shared/types.js";
import { applyListDiversity, displayedTopMedianScore } from "../server/routes/dn-diversity.js";

const { Pool } = pg;

const RANK_WINDOW = 3000;
const DEFAULT_BATCH = 80;
const COST_EV_RATIO = 20;
const LOCK_RETRY_CODES = new Set(["40P01", "55P03"]);
const STATEMENT_TIMEOUT = "30s";
const BOARD_WHERE = "WHERE t.is_theoretical = false AND t.listing_status = 'active'";
const CSV_HEADER = "status,trade_up_id,old_listing_status,old_preserved_at,reason,listing_id";
const REASON = "cost_over_20x_ev";

const KNOWN_FLAGS = new Set(["--apply", "--dry-run", "--from-id", "--csv", "--batch-size"]);

export interface ParsedMarkArgs {
  dryRun: boolean;
  fromId: number;
  csvPath?: string;
  batchSize: number;
}

export function parseMarkOutlierArgs(argv: string[]): ParsedMarkArgs {
  let apply = false;
  let dryRun = false;
  let fromId = 0;
  let csvPath: string | undefined;
  let batchSize = DEFAULT_BATCH;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument ${flag}`);
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`unknown flag ${flag}`);
    const needsValue = flag !== "--apply" && flag !== "--dry-run";
    const value = needsValue ? argv[++i] : undefined;
    if (needsValue && (value === undefined || value.startsWith("--"))) throw new Error(`${flag} needs a value`);
    if (flag === "--apply") apply = true;
    if (flag === "--dry-run") dryRun = true;
    if (flag === "--from-id") {
      fromId = Number(value);
      if (!Number.isInteger(fromId) || fromId < 0) throw new Error("--from-id must be a non-negative integer");
    }
    if (flag === "--csv") csvPath = value;
    if (flag === "--batch-size") {
      batchSize = Number(value);
      if (!Number.isInteger(batchSize) || batchSize < 50 || batchSize > 100) {
        throw new Error("--batch-size must be an integer from 50 to 100");
      }
    }
  }
  if (apply && dryRun) throw new Error("pass either --dry-run or --apply, not both");
  if (apply && !csvPath) throw new Error("--csv is required with --apply");
  return { dryRun: !apply, fromId, csvPath, batchSize };
}

export interface DatabaseTarget {
  host: string;
  database: string;
}

export function describeDatabaseTarget(databaseUrl: string): DatabaseTarget {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, "");
  if (!url.hostname || !database) throw new Error("DATABASE_URL has no host or database");
  return { host: url.hostname, database };
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is unset");
  return url;
}

function pgCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}

async function withLockRetry(fn: () => Promise<void>, pauseMs: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (!LOCK_RETRY_CODES.has(pgCode(err)) || attempt >= 3) throw err;
      const wait = pauseMs > 0 ? pauseMs * 2 ** attempt : 50 * 2 ** attempt;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function withTimedSession<T>(
  pool: pg.Pool,
  readOnly: boolean,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET SESSION statement_timeout = '${STATEMENT_TIMEOUT}'`);
    if (readOnly) await client.query("SET SESSION default_transaction_read_only = on");
    return await fn(client);
  } finally {
    if (readOnly) await client.query("SET SESSION default_transaction_read_only = DEFAULT").catch(() => undefined);
    await client.query("SET SESSION statement_timeout = DEFAULT").catch(() => undefined);
    client.release();
  }
}

export async function withReadOnlySession<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTimedSession(pool, true, fn);
}

type Queryable = pg.Pool | pg.PoolClient;

export type RatioBucket = "5-10x" | "10-50x" | "50-1000x" | "1000x+";

export function ratioBucket(raw: number, ref: number): RatioBucket | null {
  if (!(ref > 0) || raw <= ref * 5) return null;
  const ratio = raw / ref;
  if (ratio <= 10) return "5-10x";
  if (ratio <= 50) return "10-50x";
  if (ratio < 1000) return "50-1000x";
  return "1000x+";
}

export interface MarkSample {
  trade_up_id: number;
  cost_cents: number;
  ev_cents: number;
  listing_id: string;
  raw_cents: number;
  ref_cents: number | null;
}

export interface MarkReport {
  dryRun: boolean;
  marked: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  refBuckets: Record<RatioBucket, number>;
  refBySource: Record<string, number>;
  refTradeUps: number;
  refInTop3000: number;
  refInGe50: number;
  refOnFirstPage: number;
  sample: MarkSample[];
  firstPageLeave: number[];
  ge50Before: number;
  ge50After: number;
  m1Before: number;
  m1After: number;
  lastId: number;
}

interface Head {
  id: number;
  total_cost_cents: number;
  expected_value_cents: number;
  type: string;
  trade_up_score: number | null;
  listing_status: string;
  preserved_at: Date | null;
}

interface InputRow {
  trade_up_id: number;
  listing_id: string;
  skin_name: string;
  float_value: number;
  source: string | null;
  listing_source: string | null;
  raw: number | null;
}

function csvLine(status: "pending" | "committed", row: {
  id: number; listingStatus: string; preservedAt: string; listingId: string;
}): string {
  return [status, row.id, row.listingStatus, row.preservedAt, REASON, row.listingId].join(",");
}

function appendPending(csvPath: string, lines: string[]): void {
  const headerNeeded = !fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0;
  fs.appendFileSync(csvPath, (headerNeeded ? `${CSV_HEADER}\n` : "") + lines.join("\n") + "\n");
}

function settlePending(csvPath: string, pendingLines: string[], committed: Set<string>): void {
  const pending = new Set(pendingLines);
  const kept = fs.readFileSync(csvPath, "utf8").split("\n").flatMap(line => {
    if (!pending.has(line)) return line.length === 0 ? [] : [line];
    if (!committed.has(line)) return [];
    return ["committed" + line.slice("pending".length)];
  });
  const text = kept.join("\n");
  const tmp = `${csvPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text.endsWith("\n") || text.length === 0 ? text : `${text}\n`);
  fs.renameSync(tmp, csvPath);
}

async function applyBatch(
  pool: pg.Pool,
  rows: { id: number; listingStatus: string; preservedAt: string; listingId: string }[],
  lockTimeoutMs: number,
  csvPath: string,
  pauseMs: number,
): Promise<void> {
  await withLockRetry(async () => {
    const client = await pool.connect();
    let landed = false;
    let committing = false;
    const pendingLines: string[] = [];
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      const lines = rows.map(row => csvLine("pending", row));
      appendPending(csvPath, lines);
      pendingLines.push(...lines);
      const { rows: updated } = await client.query<{ id: number }>(
        `UPDATE trade_ups SET listing_status = 'stale', preserved_at = COALESCE(preserved_at, NOW())
         WHERE id = ANY($1::int[]) AND listing_status = 'active'
         RETURNING id`,
        [rows.map(r => r.id)],
      );
      const updatedIds = new Set(updated.map(r => r.id));
      const committed = new Set(rows.filter(r => updatedIds.has(r.id)).map(r => csvLine("pending", r)));
      committing = true;
      await client.query("COMMIT");
      landed = true;
      settlePending(csvPath, pendingLines, committed);
    } catch (err) {
      if (!landed) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (!committing && pendingLines.length > 0) settlePending(csvPath, pendingLines, new Set());
      }
      throw err;
    } finally {
      client.release();
    }
  }, pauseMs);
}

export interface MarkOptions {
  dryRun?: boolean;
  batchSize?: number;
  fromId?: number;
  csvPath?: string;
  lockTimeoutMs?: number;
  pauseMs?: number;
  log?: (line: string) => void;
}

export async function runMarkOutlierStale(pool: pg.Pool, opts: MarkOptions = {}): Promise<MarkReport> {
  const dryRun = opts.dryRun !== false;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? (dryRun ? 0 : 200);
  const log = opts.log ?? ((line: string) => console.log(line));
  let cursor = opts.fromId ?? 0;

  const run = async (db: Queryable): Promise<MarkReport> => {
    const maps = await buildInputReferenceMaps(db);
    const { rows: rankRows } = await db.query<{ id: number; trade_up_score: number | null; collection_names: string[] | null }>(
      `SELECT id, trade_up_score, collection_names FROM trade_ups t
       ${BOARD_WHERE}
       ORDER BY t.trade_up_score DESC NULLS LAST, t.id DESC
       LIMIT ${RANK_WINDOW}`,
    );
    const top3000 = new Set(rankRows.map(r => r.id));
    const { rows: geRows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM trade_ups t ${BOARD_WHERE} AND t.trade_up_score >= 50`,
    );
    const ge50Before = parseInt(geRows[0]?.n ?? "0", 10);
    const diversified = applyListDiversity(rankRows.map(r => ({
      id: r.id,
      collection_names: r.collection_names ?? [],
      score: r.trade_up_score ?? 0,
    })));
    const firstPage = new Set(diversified.slice(0, 50).map(r => r.id));
    const m1Before = displayedTopMedianScore(diversified.slice(0, 100));

    const refBuckets: Record<RatioBucket, number> = { "5-10x": 0, "10-50x": 0, "50-1000x": 0, "1000x+": 0 };
    const refBySource: Record<string, number> = {};
    const refTradeUpIds = new Set<number>();
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const sample: MarkSample[] = [];
    const markedIds = new Set<number>();
    const firstPageLeave: number[] = [];
    let ge50Delta = 0;
    let marked = 0;

    log(`${dryRun ? "DRY RUN" : "APPLY"} mark-outlier-stale from id > ${cursor}, batch ${batchSize}`);

    for (;;) {
      const { rows: heads } = await db.query<Head>(
        `SELECT id, total_cost_cents, expected_value_cents, type, trade_up_score, listing_status, preserved_at
         FROM trade_ups
         WHERE is_theoretical = false AND listing_status = 'active' AND id > $1
         ORDER BY id
         LIMIT $2`,
        [cursor, batchSize],
      );
      if (heads.length === 0) break;
      cursor = heads[heads.length - 1].id;
      const ids = heads.map(h => h.id);
      const { rows: inputs } = await db.query<InputRow>(
        `SELECT tui.trade_up_id, tui.listing_id, tui.skin_name, tui.float_value, tui.source,
                l.source AS listing_source, l.price_cents AS raw
         FROM trade_up_inputs tui
         LEFT JOIN listings l ON l.id = tui.listing_id
         WHERE tui.trade_up_id = ANY($1::int[])`,
        [ids],
      );
      const byTradeUp = new Map<number, InputRow[]>();
      for (const input of inputs) {
        const list = byTradeUp.get(input.trade_up_id) ?? [];
        list.push(input);
        byTradeUp.set(input.trade_up_id, list);
      }

      const toMark: { id: number; listingStatus: string; preservedAt: string; listingId: string }[] = [];
      for (const head of heads) {
        const group = byTradeUp.get(head.id) ?? [];
        let worst: { listingId: string; raw: number; ref: number | undefined } | null = null;
        for (const input of group) {
          if (input.raw == null) continue;
          const condition = floatToCondition(Number(input.float_value));
          const ref = inputReferenceCents(input.skin_name, condition, {
            ref: maps.refPriceCache,
            skinport: maps.skinportMedianCache,
          });
          if (ref !== undefined && exceedsReferenceCap(input.raw, ref)) {
            const bucket = ratioBucket(input.raw, ref);
            if (bucket) refBuckets[bucket]++;
            const source = input.listing_source ?? input.source ?? "unknown";
            refBySource[source] = (refBySource[source] ?? 0) + 1;
            refTradeUpIds.add(head.id);
          }
          if (!worst || input.raw > worst.raw) {
            worst = { listingId: input.listing_id, raw: input.raw, ref };
          }
        }
        const overCost = head.total_cost_cents > COST_EV_RATIO * Math.max(head.expected_value_cents, 1);
        if (!overCost) continue;
        marked++;
        markedIds.add(head.id);
        byType[head.type] = (byType[head.type] ?? 0) + 1;
        const listingId = worst?.listingId ?? "";
        const source = group.find(i => i.listing_id === listingId);
        const src = source?.listing_source ?? source?.source ?? "unknown";
        bySource[src] = (bySource[src] ?? 0) + 1;
        if (sample.length < 20) {
          sample.push({
            trade_up_id: head.id,
            cost_cents: head.total_cost_cents,
            ev_cents: head.expected_value_cents,
            listing_id: listingId,
            raw_cents: worst?.raw ?? 0,
            ref_cents: worst?.ref ?? null,
          });
        }
        if (firstPage.has(head.id)) firstPageLeave.push(head.id);
        if ((head.trade_up_score ?? 0) >= 50) ge50Delta++;
        const preserved = head.preserved_at ? new Date(head.preserved_at).toISOString() : "";
        toMark.push({ id: head.id, listingStatus: head.listing_status, preservedAt: preserved, listingId });
      }

      if (!dryRun && toMark.length > 0 && opts.csvPath) {
        await applyBatch(pool, toMark, opts.lockTimeoutMs ?? 5000, opts.csvPath, pauseMs);
      }
      log(`  batch through id ${cursor}: ${toMark.length} to mark, running total ${marked}`);
      if (heads.length < batchSize) break;
      if (pauseMs > 0 && !dryRun) await new Promise(r => setTimeout(r, pauseMs));
    }

    let refInTop3000 = 0;
    let refInGe50 = 0;
    let refOnFirstPage = 0;
    for (const id of refTradeUpIds) {
      if (top3000.has(id)) refInTop3000++;
      if (firstPage.has(id)) refOnFirstPage++;
    }
    if (refTradeUpIds.size > 0) {
      const { rows } = await db.query<{ id: number }>(
        `SELECT id FROM trade_ups WHERE id = ANY($1::int[]) AND trade_up_score >= 50`,
        [[...refTradeUpIds]],
      );
      refInGe50 = rows.length;
    }

    const afterRows = diversified.filter(r => !markedIds.has(r.id));
    const m1After = displayedTopMedianScore(afterRows.slice(0, 100));
    const report: MarkReport = {
      dryRun,
      marked,
      byType,
      bySource,
      refBuckets,
      refBySource,
      refTradeUps: refTradeUpIds.size,
      refInTop3000,
      refInGe50,
      refOnFirstPage,
      sample,
      firstPageLeave,
      ge50Before,
      ge50After: ge50Before - ge50Delta,
      m1Before,
      m1After,
      lastId: cursor,
    };
    log(formatMarkReport(report));
    return report;
  };

  const report = await withTimedSession(pool, dryRun, run);
  if (!dryRun) {
    const { redisConnected, cacheInvalidatePrefix } = await import("../server/redis.js");
    await redisConnected();
    await cacheInvalidatePrefix("tu:");
  }
  return report;
}

export function formatMarkReport(report: MarkReport): string {
  const types = Object.entries(report.byType).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const sources = Object.entries(report.bySource).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const buckets = (Object.entries(report.refBuckets) as [RatioBucket, number][]).map(([k, n]) => `${k} ${n}`).join(", ");
  const refSources = Object.entries(report.refBySource).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const lines = [
    `${report.dryRun ? "DRY RUN" : "APPLIED"}: ${report.marked} trade-ups marked stale (cost > 20x EV)`,
    `by type: ${types}`,
    `by source: ${sources}`,
    `over 5x reference (report only): ${report.refTradeUps} trade-ups; buckets ${buckets}; sources ${refSources}`,
    `over 5x reference in top 3000: ${report.refInTop3000}; ge50: ${report.refInGe50}; first page: ${report.refOnFirstPage}`,
    `first-page leavers: [${report.firstPageLeave.join(", ")}]`,
    `ge50: ${report.ge50Before} -> ${report.ge50After}`,
    `M1: ${report.m1Before} -> ${report.m1After}`,
    "sample (id cost ev listing raw ref):",
    ...report.sample.map(s =>
      `  ${s.trade_up_id} cost ${s.cost_cents} ev ${s.ev_cents} listing ${s.listing_id} raw ${s.raw_cents} ref ${s.ref_cents ?? "none"}`,
    ),
  ];
  return lines.join("\n");
}

const isCli = process.argv[1]?.endsWith("mark-outlier-stale.ts") || process.argv[1]?.endsWith("mark-outlier-stale.js");

async function main() {
  const args = parseMarkOutlierArgs(process.argv.slice(2));
  const databaseUrl = requireDatabaseUrl();
  const target = describeDatabaseTarget(databaseUrl);
  console.log(`target ${target.host}/${target.database}`);
  const pool = new Pool({ connectionString: databaseUrl });
  if (!args.dryRun) {
    const { initRedis } = await import("../server/redis.js");
    initRedis();
  }
  try {
    await runMarkOutlierStale(pool, {
      dryRun: args.dryRun,
      fromId: args.fromId,
      batchSize: args.batchSize,
      csvPath: args.csvPath,
    });
  } finally {
    if (!args.dryRun) {
      const { closeRedis } = await import("../server/redis.js");
      await closeRedis();
    }
    await pool.end();
  }
}

if (isCli) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
