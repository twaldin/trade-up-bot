/**
 * One-time recompute of fee-inclusive input costs for active trade-ups.
 *
 * Dry-run by default. Writes nothing unless --apply is passed alone.
 * Do not run --apply against production without CEO approval.
 *
 *   npx tsx scripts/backfill-input-fees.ts
 *   npx tsx scripts/backfill-input-fees.ts --apply --csv backfill-input-fees.csv
 *   npx tsx scripts/backfill-input-fees.ts --from-id 1200
 *   npx tsx scripts/backfill-input-fees.ts --first-page-ids 1,2,3
 *
 * A row is corrected only when its listing still exists, the stored input
 * price equals the raw listing price, and storedInputCost(raw, source) differs.
 * Inputs whose listing is gone are counted as unclassifiable and left alone.
 *
 * Revert CSV (`status,trade_up_id,listing_id,old_price,new_price,old_source,new_source`):
 * each batch is appended as `pending` before COMMIT, then rewritten to `committed`
 * after COMMIT (rows whose UPDATE did not change one row are dropped). A crash in
 * that window leaves `pending` rows. Revert a `committed` row, and a `pending` row
 * whose current price and source already equal new_price/new_source (the commit
 * landed). Leave a pending row that is still at old_price (the commit did not).
 * Restoring a row sets price_cents = old_price and source = old_source, then
 * refreshes trade_ups.input_sources the same way this script does on apply.
 */

import fs from "fs";
import pg from "pg";
import { MARKETPLACE_FEES, storedInputCost } from "../server/engine/fees.js";
import { computeTradeUpCostStats, recomputeTradeUpCost } from "../server/engine/db-stats.js";
import {
  applyListDiversity,
  applyListDiversityToListSql,
  displayedTopMedianScore,
} from "../server/routes/dn-diversity.js";

const { Pool } = pg;

const FEE_SOURCES = Object.entries(MARKETPLACE_FEES)
  .filter(([, f]) => f.buyerFeePct !== 0 || f.buyerFeeFlat !== 0)
  .map(([source]) => source);

function boardWhere(tier: "free" | "pro"): string {
  const base = "WHERE t.is_theoretical = false AND t.listing_status = 'active'";
  if (tier === "free") return `${base} AND t.created_at <= NOW() - INTERVAL '10800 seconds'`;
  return base;
}
const RANK_WINDOW = 3000;
const DEFAULT_BATCH = 80;
const LOCK_RETRY_CODES = new Set(["40P01", "55P03"]);

export interface BackfillSample {
  trade_up_id: number;
  old_cost_cents: number;
  new_cost_cents: number;
  old_roi: number;
  new_roi: number;
}

export interface SummaryStats {
  mean: number;
  median: number;
  max: number;
}

export interface BackfillReport {
  dryRun: boolean;
  tradeUpsAffected: number;
  inputsAffected: number;
  avgRoiDelta: number;
  medianRoiDelta: number;
  maxRoiDelta: number;
  costDelta: SummaryStats;
  scoreDrop: SummaryStats;
  m1Before: number;
  m1After: number;
  sample: BackfillSample[];
  firstPageSize: number;
  firstPageChanged: number;
  firstPageLeave: number[];
  firstPageJoin: number[];
  ge50Before: number;
  ge50After: number;
  /** Null when the rank-window count timed out. */
  unclassifiableInputs: number | null;
  unclassifiableTradeUps: number | null;
  sourceMismatches: number | null;
  sourceMismatchTradeUps: number | null;
  sourceFixInputs: number;
  sourceFixTradeUps: number;
  m1RawBefore: number | null;
  m1RawAfter: number | null;
  projectionMismatches: number;
  perMarketplace: Record<string, number>;
  lastId: number;
}

export interface BackfillOptions {
  dryRun?: boolean;
  batchSize?: number;
  pauseMs?: number;
  fromId?: number;
  sampleSize?: number;
  csvPath?: string;
  /** Site page captured elsewhere. When set, this is the "before" page. */
  firstPageIds?: number[];
  /** Public board delay. `free` hides rows newer than 3 hours. */
  tier?: "free" | "pro";
  /** How long a batch waits for a lock before 55P03 and a retry. */
  lockTimeoutMs?: number;
  /** Called after the revert CSV pending lines are on disk and before COMMIT. */
  beforeCommit?: () => void;
  log?: (line: string) => void;
}

export interface RevertCsvRow {
  status: "pending" | "committed";
  trade_up_id: number;
  listing_id: string;
  old_price: number;
  new_price: number;
  old_source: string;
  new_source: string;
}

/** Rows a revert should restore. Pending rows count only when the commit already landed. */
export function rowsNeedingRevert(
  rows: RevertCsvRow[],
  current: (row: RevertCsvRow) => { price: number; source: string } | null,
): RevertCsvRow[] {
  return rows.filter(row => {
    const now = current(row);
    if (!now) return false;
    const applied = now.price === row.new_price && now.source === row.new_source;
    return applied && (row.status === "committed" || row.status === "pending");
  });
}

interface CandidateInput {
  trade_up_id: number;
  listing_id: string;
  source: string | null;
  listing_source: string | null;
  stored: number;
  raw: number | null;
}

interface TradeUpHead {
  id: number;
  total_cost_cents: number;
  expected_value_cents: number;
  roi_percentage: number;
  trade_up_score: number | null;
  outcomes_json: string | null;
}

interface RankRow {
  id: number;
  trade_up_score: number | null;
  collection_names: string[] | null;
}

interface CsvRow {
  trade_up_id: number;
  listing_id: string;
  old: number;
  next: number;
  oldSource: string;
  newSource: string;
}

const CSV_HEADER = "status,trade_up_id,listing_id,old_price,new_price,old_source,new_source";

function csvLine(status: "pending" | "committed", row: CsvRow): string {
  return [status, row.trade_up_id, row.listing_id, row.old, row.next, row.oldSource, row.newSource].join(",");
}

function writeCsvText(csvPath: string, text: string): void {
  const tmp = `${csvPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text.endsWith("\n") || text.length === 0 ? text : `${text}\n`);
  fs.renameSync(tmp, csvPath);
}

function appendPending(csvPath: string, rows: CsvRow[]): string[] {
  const headerNeeded = !fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0;
  const lines = rows.map(row => csvLine("pending", row));
  fs.appendFileSync(csvPath, (headerNeeded ? `${CSV_HEADER}\n` : "") + lines.join("\n") + "\n");
  return lines;
}

/** Mark this batch's pending lines committed, and drop the ones the UPDATE skipped. */
function settlePending(csvPath: string, pendingLines: string[], committedLines: Set<string>): void {
  const pending = new Set(pendingLines);
  const kept = fs.readFileSync(csvPath, "utf8").split("\n").flatMap(line => {
    if (!pending.has(line)) return line.length === 0 ? [] : [line];
    if (!committedLines.has(line)) return [];
    return ["committed" + line.slice("pending".length)];
  });
  writeCsvText(csvPath, kept.join("\n"));
}

interface FixPlan {
  id: number;
  fixes: { listing_id: string; source: string; inputSource: string | null; old: number; next: number }[];
  sample: BackfillSample;
  oldScore: number;
  newScore: number;
  crossesOutOfGe50: boolean;
  projectionMismatch: boolean;
}

/** Same formula as the compute_trade_up_score() trigger. */
export function projectedScore(cost: number, profit: number, chance: number, worst: number): number {
  if (cost <= 0) return 0;
  const downside = Math.max(0, -worst) / cost;
  return Math.round((1000 * chance * (profit / cost)) / (1 + downside));
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

function summarize(values: number[]): SummaryStats {
  return {
    mean: meanOf(values),
    median: Math.round(medianOf(values) * 100) / 100,
    max: values.length === 0 ? 0 : Math.round(Math.max(...values) * 100) / 100,
  };
}

export interface DatabaseTarget {
  host: string;
  database: string;
}

/** Host and database only. The password is never included. */
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

export interface ParsedBackfillArgs {
  dryRun: boolean;
  fromId: number;
  csvPath?: string;
  batchSize: number;
  firstPageIds?: number[];
  tier: "free" | "pro";
}

const KNOWN_FLAGS = new Set(["--apply", "--dry-run", "--from-id", "--csv", "--batch-size", "--first-page-ids", "--tier"]);

/** Strict argv parse. --dry-run and --apply together is an error, as is any unknown flag. */
export function parseBackfillArgs(argv: string[]): ParsedBackfillArgs {
  let apply = false;
  let dryRun = false;
  let fromId = 0;
  let csvPath: string | undefined;
  let batchSize = DEFAULT_BATCH;
  let firstPageIds: number[] | undefined;
  let tier: "free" | "pro" = "pro";

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
    if (flag === "--tier") {
      if (value !== "free" && value !== "pro") throw new Error("--tier must be free or pro");
      tier = value;
    }
    if (flag === "--first-page-ids") {
      firstPageIds = value!.split(",").filter(Boolean).map(part => Number(part));
      if (firstPageIds.length === 0 || firstPageIds.some(id => !Number.isInteger(id))) {
        throw new Error("--first-page-ids must be a comma-separated list of ids");
      }
    }
  }
  if (apply && dryRun) throw new Error("pass either --dry-run or --apply, not both");
  return { dryRun: !apply, fromId, csvPath, batchSize, firstPageIds, tier };
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

const STATEMENT_TIMEOUT = "30s";

/** One pool client with a session statement_timeout. Dry-run clients are also read-only. */
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

/** Hold one pool client that cannot write, so a dry-run cannot mutate the database. */
export async function withReadOnlySession<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTimedSession(pool, true, fn);
}

type Queryable = pg.Pool | pg.PoolClient;

async function loadRankWindow(db: Queryable, where: string): Promise<RankRow[]> {
  const { rows } = await db.query<RankRow>(
    `SELECT id, trade_up_score, collection_names
     FROM trade_ups t
     ${where}
     ORDER BY t.trade_up_score DESC NULLS LAST, t.id DESC
     LIMIT ${RANK_WINDOW}`
  );
  return rows;
}

/** The site's first page: diversity window, score desc, 50 rows. */
async function loadDiversifiedFirstPage(db: Queryable, where: string): Promise<number[]> {
  const diversity = applyListDiversityToListSql({
    where,
    sortCol: "t.trade_up_score",
    sortOrder: "DESC",
    apply: true,
    startParamIndex: 1,
  });
  const { rows } = await db.query<{ id: number }>(
    `SELECT t.id ${diversity.fromWhere}
     ORDER BY t.trade_up_score DESC NULLS LAST, t.id DESC
     LIMIT 50`,
    diversity.params
  );
  return rows.map(r => r.id);
}

function rawMedian(rows: { id: number; score: number | null }[]): number | null {
  const scores = rows
    .filter((row): row is { id: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || b.id - a.id)
    .slice(0, 100)
    .map(row => row.score);
  if (scores.length === 0) return null;
  return medianOf(scores);
}

async function rawM1(db: Queryable, where: string, log: (line: string) => void): Promise<number | null> {
  try {
    const { rows } = await db.query<{ m1: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY trade_up_score) AS m1
       FROM (
         SELECT t.trade_up_score FROM trade_ups t
         ${where} AND t.trade_up_score IS NOT NULL
         ORDER BY t.trade_up_score DESC
         LIMIT 100
       ) top100`
    );
    return rows[0]?.m1 === null || rows[0]?.m1 === undefined ? null : Number(rows[0].m1);
  } catch (err) {
    if (pgCode(err) !== "57014") throw err;
    log("warning: raw M1 timed out");
    return null;
  }
}

async function countRankWindow(
  db: Queryable,
  ids: number[],
  log: (line: string) => void,
): Promise<{
  unclassifiableInputs: number | null;
  unclassifiableTradeUps: number | null;
  sourceMismatches: number | null;
  sourceMismatchTradeUps: number | null;
}> {
  const na = { unclassifiableInputs: null, unclassifiableTradeUps: null, sourceMismatches: null, sourceMismatchTradeUps: null };
  if (ids.length === 0) return { unclassifiableInputs: 0, unclassifiableTradeUps: 0, sourceMismatches: 0, sourceMismatchTradeUps: 0 };
  try {
    const { rows } = await db.query<{ trade_up_id: number; source: string | null; listing_source: string | null; listing_id: string; raw: number | null }>(
      `SELECT tui.trade_up_id, tui.source, tui.listing_id, l.source AS listing_source, l.price_cents AS raw
       FROM trade_up_inputs tui
       LEFT JOIN listings l ON l.id = tui.listing_id
       WHERE tui.trade_up_id = ANY($1::int[])`,
      [ids]
    );
    const goneTradeUps = new Set<number>();
    const mismatchTradeUps = new Set<number>();
    let gone = 0;
    let mismatches = 0;
    for (const row of rows) {
      const theoretical = row.listing_id === "theoretical" || row.listing_id.startsWith("theory");
      if (row.raw === null && !theoretical) {
        gone++;
        goneTradeUps.add(row.trade_up_id);
      } else if (row.listing_source !== null && row.listing_source !== row.source) {
        mismatches++;
        mismatchTradeUps.add(row.trade_up_id);
      }
    }
    return {
      unclassifiableInputs: gone,
      unclassifiableTradeUps: goneTradeUps.size,
      sourceMismatches: mismatches,
      sourceMismatchTradeUps: mismatchTradeUps.size,
    };
  } catch (err) {
    if (pgCode(err) !== "57014") throw err;
    log("warning: rank-window input counts timed out");
    return na;
  }
}

function diversifiedTop(
  rows: RankRow[],
  scoreOf: (row: RankRow) => number,
  take: number,
): { id: number; score: number }[] {
  const ranked = [...rows]
    .map(row => ({
      id: row.id,
      collection_names: row.collection_names ?? [],
      score: scoreOf(row),
    }))
    .sort((a, b) => b.score - a.score || b.id - a.id);
  return applyListDiversity(ranked).slice(0, take);
}

async function refreshInputSources(client: pg.PoolClient, tradeUpId: number): Promise<void> {
  await client.query(
    `UPDATE trade_ups SET input_sources = COALESCE((
       SELECT ARRAY_AGG(DISTINCT source ORDER BY source) FROM trade_up_inputs WHERE trade_up_id = $1
     ), '{}') WHERE id = $1`,
    [tradeUpId]
  );
}

async function applyPlans(
  pool: pg.Pool,
  plans: FixPlan[],
  pauseMs: number,
  lockTimeoutMs: number,
  csvPath: string | undefined,
  beforeCommit: (() => void) | undefined,
): Promise<void> {
  const planned: CsvRow[] = plans.flatMap(plan => plan.fixes.map(fix => ({
    trade_up_id: plan.id,
    listing_id: fix.listing_id,
    old: fix.old,
    next: fix.next,
    oldSource: fix.inputSource ?? "csfloat",
    newSource: fix.source,
  })));
  await withLockRetry(async () => {
    const pendingLines = csvPath ? appendPending(csvPath, planned) : [];
    const client = await pool.connect();
    const wrote = new Set<string>();
    const touched = new Set<number>();
    let landed = false;
    try {
      await client.query(`SET SESSION statement_timeout = '${STATEMENT_TIMEOUT}'`);
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      for (const plan of plans) {
        for (const fix of plan.fixes) {
          const updated = await client.query(
            "UPDATE trade_up_inputs SET price_cents = $1, source = $2 WHERE trade_up_id = $3 AND listing_id = $4 AND price_cents = $5",
            [fix.next, fix.source, plan.id, fix.listing_id, fix.old]
          );
          if (updated.rowCount === 1) {
            touched.add(plan.id);
            const line = csvLine("pending", {
              trade_up_id: plan.id,
              listing_id: fix.listing_id,
              old: fix.old,
              next: fix.next,
              oldSource: fix.inputSource ?? "csfloat",
              newSource: fix.source,
            });
            wrote.add(line);
          }
        }
        if (touched.has(plan.id)) await refreshInputSources(client, plan.id);
        await recomputeTradeUpCost(client, plan.id);
      }
      beforeCommit?.();
      await client.query("COMMIT");
      landed = true;
      if (csvPath) settlePending(csvPath, pendingLines, wrote);
    } catch (err) {
      if (!landed) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (csvPath && pendingLines.length > 0) settlePending(csvPath, pendingLines, new Set());
      }
      throw err;
    } finally {
      await client.query("SET SESSION statement_timeout = DEFAULT").catch(() => undefined);
      client.release();
    }
  }, pauseMs);
}

export async function runInputFeeBackfill(pool: pg.Pool, opts: BackfillOptions = {}): Promise<BackfillReport> {
  const dryRun = opts.dryRun !== false;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? (dryRun ? 0 : 200);
  const sampleSize = opts.sampleSize ?? 8;
  const log = opts.log ?? ((line: string) => console.log(line));
  let cursor = opts.fromId ?? 0;

  const tier = opts.tier ?? "pro";
  const where = boardWhere(tier);

  const run = async (db: Queryable): Promise<BackfillReport> => {
    const rankWindow = await loadRankWindow(db, where);
    const scoreUpdates = new Map<number, number>();
    const windowPage = diversifiedTop(rankWindow, row => row.trade_up_score ?? 0, 50).map(row => row.id);
    let sqlPage: number[] = [];
    if (!opts.firstPageIds) {
      try {
        sqlPage = await loadDiversifiedFirstPage(db, where);
      } catch (err) {
        if (pgCode(err) !== "57014") throw err;
        log("warning: SQL first page timed out");
      }
      if (sqlPage.length > 0 && (sqlPage.length !== windowPage.length || sqlPage.some((id, i) => id !== windowPage[i]))) {
        log("warning: rank-window first page differs from the SQL page");
      }
    }
    const firstPageBefore = opts.firstPageIds ?? windowPage;
    const beforePage = new Set(firstPageBefore);

    const { rows: geRows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM trade_ups t ${where} AND t.trade_up_score >= 50`
    );
    const ge50Before = parseInt(geRows[0]?.n ?? "0", 10);
    const windowCounts = await countRankWindow(db, rankWindow.map(row => row.id), log);

    let tradeUpsAffected = 0;
    let inputsAffected = 0;
    let sourceFixInputs = 0;
    const sourceFixTradeUps = new Set<number>();
    let projectionMismatches = 0;
    let ge50Delta = 0;
    let firstPageChanged = 0;
    const roiDeltas: number[] = [];
    const costDeltas: number[] = [];
    const scoreDrops: number[] = [];
    const perMarketplace: Record<string, number> = {};
    const sample: BackfillSample[] = [];

    log(`${dryRun ? "DRY RUN" : "APPLY"} input-fee backfill from id > ${cursor}, batch ${batchSize}, sources ${FEE_SOURCES.join(",")}`);

    for (;;) {
      const { rows: idRows } = await db.query<{ trade_up_id: number }>(
        `SELECT DISTINCT tui.trade_up_id
         FROM trade_up_inputs tui
         JOIN listings l ON l.id = tui.listing_id
         JOIN trade_ups tu ON tu.id = tui.trade_up_id
         WHERE tu.is_theoretical = false
           AND tu.listing_status = 'active'
           AND ($4::boolean = false OR tu.created_at <= NOW() - INTERVAL '10800 seconds')
           AND tui.trade_up_id > $1
           AND tui.price_cents = l.price_cents
           AND COALESCE(l.source, tui.source) = ANY($2::text[])
         ORDER BY tui.trade_up_id
         LIMIT $3`,
        [cursor, FEE_SOURCES, batchSize, tier === "free"]
      );
      if (idRows.length === 0) break;
      const ids = idRows.map(r => r.trade_up_id);
      cursor = ids[ids.length - 1];

      const { rows: heads } = await db.query<TradeUpHead>(
        `SELECT id, total_cost_cents, expected_value_cents, roi_percentage, trade_up_score, outcomes_json
         FROM trade_ups WHERE id = ANY($1::int[])`,
        [ids]
      );
      const headById = new Map(heads.map(h => [h.id, h]));
      const { rows: inputs } = await db.query<CandidateInput>(
        `SELECT tui.trade_up_id, tui.listing_id, tui.source, l.source AS listing_source,
                tui.price_cents AS stored, l.price_cents AS raw
         FROM trade_up_inputs tui
         LEFT JOIN listings l ON l.id = tui.listing_id
         WHERE tui.trade_up_id = ANY($1::int[])`,
        [ids]
      );
      const byTradeUp = new Map<number, CandidateInput[]>();
      for (const input of inputs) {
        const list = byTradeUp.get(input.trade_up_id) ?? [];
        list.push(input);
        byTradeUp.set(input.trade_up_id, list);
      }

      const plans: FixPlan[] = [];
      for (const id of ids) {
        const head = headById.get(id);
        const group = byTradeUp.get(id);
        if (!head || !group) continue;
        const fixes: FixPlan["fixes"] = [];
        let inputSum = 0;
        for (const input of group) {
          if (input.raw === null) {
            inputSum += input.stored;
            continue;
          }
          const feeSource = input.listing_source ?? input.source;
          const next = input.stored === input.raw ? storedInputCost(input.raw, feeSource) : input.stored;
          if (next !== input.stored) {
            const source = feeSource ?? "unknown";
            fixes.push({ listing_id: input.listing_id, source, old: input.stored, next, inputSource: input.source });
          }
          inputSum += next;
        }
        if (fixes.length === 0) continue;
        const delta = fixes.reduce((sum, fix) => sum + (fix.next - fix.old), 0);
        const projected = head.total_cost_cents + delta;
        const projectionMismatch = projected !== inputSum;
        const newCost = inputSum;
        const outcomes = JSON.parse(head.outcomes_json || "[]") as { estimated_price_cents: number; probability: number }[];
        const stats = computeTradeUpCostStats(newCost, head.expected_value_cents, outcomes);
        const oldScore = head.trade_up_score ?? 0;
        const newScore = projectedScore(newCost, stats.profit_cents, stats.chance_to_profit, stats.worst_case_cents);
        plans.push({
          id,
          fixes,
          sample: {
            trade_up_id: id,
            old_cost_cents: head.total_cost_cents,
            new_cost_cents: newCost,
            old_roi: head.roi_percentage,
            new_roi: stats.roi_percentage,
          },
          oldScore,
          newScore,
          crossesOutOfGe50: oldScore >= 50 && newScore < 50,
          projectionMismatch,
        });
      }

      if (!dryRun && plans.length > 0) {
        await applyPlans(pool, plans, pauseMs, opts.lockTimeoutMs ?? 5000, opts.csvPath, opts.beforeCommit);
      }

      for (const plan of plans) {
        tradeUpsAffected++;
        inputsAffected += plan.fixes.length;
        if (plan.projectionMismatch) projectionMismatches++;
        roiDeltas.push(plan.sample.old_roi - plan.sample.new_roi);
        costDeltas.push(plan.sample.new_cost_cents - plan.sample.old_cost_cents);
        scoreDrops.push(plan.oldScore - plan.newScore);
        scoreUpdates.set(plan.id, plan.newScore);
        for (const fix of plan.fixes) {
          perMarketplace[fix.source] = (perMarketplace[fix.source] ?? 0) + 1;
          if (fix.source !== (fix.inputSource ?? "csfloat")) {
            sourceFixInputs++;
            sourceFixTradeUps.add(plan.id);
          }
        }
        if (sample.length < sampleSize) sample.push(plan.sample);
        if (beforePage.has(plan.id)) firstPageChanged++;
        if (plan.crossesOutOfGe50) ge50Delta++;
      }

      log(`  batch through id ${cursor}: ${plans.length} trade-ups, running total ${tradeUpsAffected}`);
      if (idRows.length < batchSize) break;
      if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
    }

    const m1Before = displayedTopMedianScore(diversifiedTop(rankWindow, row => row.trade_up_score ?? 0, 100));
    const afterTop = diversifiedTop(rankWindow, row => scoreUpdates.get(row.id) ?? row.trade_up_score ?? 0, 100);
    const m1After = displayedTopMedianScore(afterTop);
    const m1RawBefore = await rawM1(db, where, log);
    const m1RawAfter = rawMedian(rankWindow.map(row => ({
      id: row.id,
      score: scoreUpdates.has(row.id) ? scoreUpdates.get(row.id)! : row.trade_up_score,
    })));
    const afterPage = new Set(afterTop.slice(0, 50).map(row => row.id));
    const firstPageLeave = firstPageBefore.filter(id => !afterPage.has(id));
    const firstPageJoin = [...afterPage].filter(id => !beforePage.has(id));
    const roi = summarize(roiDeltas);
    const report: BackfillReport = {
      dryRun,
      tradeUpsAffected,
      inputsAffected,
      avgRoiDelta: roi.mean,
      medianRoiDelta: roi.median,
      maxRoiDelta: roi.max,
      costDelta: summarize(costDeltas),
      scoreDrop: summarize(scoreDrops),
      m1Before,
      m1After,
      sample,
      firstPageSize: firstPageBefore.length,
      firstPageChanged,
      firstPageLeave,
      firstPageJoin,
      ge50Before,
      ge50After: ge50Before - ge50Delta,
      unclassifiableInputs: windowCounts.unclassifiableInputs,
      unclassifiableTradeUps: windowCounts.unclassifiableTradeUps,
      sourceMismatches: windowCounts.sourceMismatches,
      sourceMismatchTradeUps: windowCounts.sourceMismatchTradeUps,
      sourceFixInputs,
      sourceFixTradeUps: sourceFixTradeUps.size,
      m1RawBefore,
      m1RawAfter,
      projectionMismatches,
      perMarketplace,
      lastId: cursor,
    };
    log(formatBackfillReport(report));
    return report;
  };

  return withTimedSession(pool, dryRun, run);
}

function na(value: number | null): string {
  return value === null ? "NA" : String(value);
}

export function formatBackfillReport(report: BackfillReport): string {
  const markets = Object.entries(report.perMarketplace).map(([source, n]) => `${source} ${n}`).join(", ") || "none";
  const lines = [
    `${report.dryRun ? "DRY RUN" : "APPLIED"}: ${report.inputsAffected} inputs on ${report.tradeUpsAffected} trade-ups`,
    `per marketplace: ${markets}`,
    `unclassifiable in rank window (listing gone): ${na(report.unclassifiableInputs)} inputs on ${na(report.unclassifiableTradeUps)} trade-ups`,
    `source mismatches in rank window: ${na(report.sourceMismatches)} inputs on ${na(report.sourceMismatchTradeUps)} trade-ups`,
    `source fixes (fee source != stored source): ${report.sourceFixInputs} inputs on ${report.sourceFixTradeUps} trade-ups`,
    `projection mismatches (stored total + delta vs input sum): ${report.projectionMismatches}`,
    `ROI delta (old - new), pts: mean ${report.avgRoiDelta}, median ${report.medianRoiDelta}, max ${report.maxRoiDelta}`,
    `cost delta (new - old), cents: mean ${report.costDelta.mean}, median ${report.costDelta.median}, max ${report.costDelta.max}`,
    `score drop: mean ${report.scoreDrop.mean}, median ${report.scoreDrop.median}, max ${report.scoreDrop.max}`,
    `M1 diversified (median of diversified top 100): ${report.m1Before} -> ${report.m1After}`,
    `M1 raw (percentile_cont of plain top 100, non-NULL): ${na(report.m1RawBefore)} -> ${na(report.m1RawAfter)}`,
    `first page: ${report.firstPageChanged}/${report.firstPageSize} change cost; leave [${report.firstPageLeave.join(", ")}]; join [${report.firstPageJoin.join(", ")}]`,
    `ge50: ${report.ge50Before} -> ${report.ge50After}`,
    "sample (trade_up_id old_cost -> new_cost, old_roi -> new_roi):",
    ...report.sample.map(s =>
      `  ${s.trade_up_id}  cost ${s.old_cost_cents} -> ${s.new_cost_cents}  roi ${s.old_roi} -> ${s.new_roi}`
    ),
  ];
  return lines.join("\n");
}

const isCli = process.argv[1]?.endsWith("backfill-input-fees.ts") || process.argv[1]?.endsWith("backfill-input-fees.js");

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2));
  const databaseUrl = requireDatabaseUrl();
  const target = describeDatabaseTarget(databaseUrl);
  console.log(`target ${target.host}/${target.database}`);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runInputFeeBackfill(pool, {
      dryRun: args.dryRun,
      fromId: args.fromId,
      batchSize: args.batchSize,
      firstPageIds: args.firstPageIds,
      tier: args.tier,
      csvPath: args.dryRun ? undefined : (args.csvPath ?? `backfill-input-fees-${Date.now()}.csv`),
    });
  } finally {
    await pool.end();
  }
}

if (isCli) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
