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

const BOARD_WHERE = "WHERE t.is_theoretical = false AND t.listing_status = 'active'";
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
  unclassifiableInputs: number;
  sourceMismatches: number;
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
  /** How long a batch waits for a lock before 55P03 and a retry. */
  lockTimeoutMs?: number;
  log?: (line: string) => void;
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

interface FixPlan {
  id: number;
  fixes: { listing_id: string; source: string; old: number; next: number }[];
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
}

const KNOWN_FLAGS = new Set(["--apply", "--dry-run", "--from-id", "--csv", "--batch-size", "--first-page-ids"]);

/** Strict argv parse. --dry-run and --apply together is an error, as is any unknown flag. */
export function parseBackfillArgs(argv: string[]): ParsedBackfillArgs {
  let apply = false;
  let dryRun = false;
  let fromId = 0;
  let csvPath: string | undefined;
  let batchSize = DEFAULT_BATCH;
  let firstPageIds: number[] | undefined;

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
    if (flag === "--first-page-ids") {
      firstPageIds = value!.split(",").filter(Boolean).map(part => Number(part));
      if (firstPageIds.length === 0 || firstPageIds.some(id => !Number.isInteger(id))) {
        throw new Error("--first-page-ids must be a comma-separated list of ids");
      }
    }
  }
  if (apply && dryRun) throw new Error("pass either --dry-run or --apply, not both");
  return { dryRun: !apply, fromId, csvPath, batchSize, firstPageIds };
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

async function loadRankWindow(db: Queryable): Promise<RankRow[]> {
  const { rows } = await db.query<RankRow>(
    `SELECT id, trade_up_score, collection_names
     FROM trade_ups t
     ${BOARD_WHERE}
     ORDER BY t.trade_up_score DESC NULLS LAST, t.id DESC
     LIMIT ${RANK_WINDOW}`
  );
  return rows;
}

/** The site's first page: diversity window, score desc, 50 rows. */
async function loadDiversifiedFirstPage(db: Queryable): Promise<number[]> {
  const diversity = applyListDiversityToListSql({
    where: BOARD_WHERE,
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

async function applyPlans(
  pool: pg.Pool,
  plans: FixPlan[],
  pauseMs: number,
  lockTimeoutMs: number,
): Promise<{ listing_id: string; trade_up_id: number; old: number; next: number }[]> {
  let committed: { listing_id: string; trade_up_id: number; old: number; next: number }[] = [];
  await withLockRetry(async () => {
    const client = await pool.connect();
    const wrote: typeof committed = [];
    try {
      await client.query(`SET SESSION statement_timeout = '${STATEMENT_TIMEOUT}'`);
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      for (const plan of plans) {
        for (const fix of plan.fixes) {
          const updated = await client.query(
            "UPDATE trade_up_inputs SET price_cents = $1 WHERE trade_up_id = $2 AND listing_id = $3 AND price_cents = $4",
            [fix.next, plan.id, fix.listing_id, fix.old]
          );
          if (updated.rowCount === 1) {
            wrote.push({ trade_up_id: plan.id, listing_id: fix.listing_id, old: fix.old, next: fix.next });
          }
        }
        await recomputeTradeUpCost(client, plan.id);
      }
      await client.query("COMMIT");
      committed = wrote;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      await client.query("SET SESSION statement_timeout = DEFAULT").catch(() => undefined);
      client.release();
    }
  }, pauseMs);
  return committed;
}

export async function runInputFeeBackfill(pool: pg.Pool, opts: BackfillOptions = {}): Promise<BackfillReport> {
  const dryRun = opts.dryRun !== false;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const pauseMs = opts.pauseMs ?? (dryRun ? 0 : 200);
  const sampleSize = opts.sampleSize ?? 8;
  const log = opts.log ?? ((line: string) => console.log(line));
  let cursor = opts.fromId ?? 0;

  const run = async (db: Queryable): Promise<BackfillReport> => {
    const rankWindow = await loadRankWindow(db);
    const scoreUpdates = new Map<number, number>();
    const firstPageBefore = opts.firstPageIds ?? await loadDiversifiedFirstPage(db);
    const beforePage = new Set(firstPageBefore);

    const { rows: geRows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM trade_ups t ${BOARD_WHERE} AND t.trade_up_score >= 50`
    );
    const ge50Before = parseInt(geRows[0]?.n ?? "0", 10);
    const { rows: goneRows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM trade_up_inputs tui
       JOIN trade_ups tu ON tu.id = tui.trade_up_id
       LEFT JOIN listings l ON l.id = tui.listing_id
       WHERE tu.is_theoretical = false AND tu.listing_status = 'active'
         AND l.id IS NULL
         AND tui.listing_id <> 'theoretical'
         AND tui.listing_id NOT LIKE 'theory%'`
    );
    const unclassifiableInputs = parseInt(goneRows[0]?.n ?? "0", 10);
    const { rows: mismatchRows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
       FROM trade_up_inputs tui
       JOIN trade_ups tu ON tu.id = tui.trade_up_id
       JOIN listings l ON l.id = tui.listing_id
       WHERE tu.is_theoretical = false AND tu.listing_status = 'active'
         AND tui.source IS DISTINCT FROM l.source`
    );
    const sourceMismatches = parseInt(mismatchRows[0]?.n ?? "0", 10);

    let tradeUpsAffected = 0;
    let inputsAffected = 0;
    let projectionMismatches = 0;
    let ge50Delta = 0;
    let firstPageChanged = 0;
    const roiDeltas: number[] = [];
    const costDeltas: number[] = [];
    const scoreDrops: number[] = [];
    const perMarketplace: Record<string, number> = {};
    const sample: BackfillSample[] = [];
    let csvHeaderWritten = !!(opts.csvPath && fs.existsSync(opts.csvPath) && fs.statSync(opts.csvPath).size > 0);

    log(`${dryRun ? "DRY RUN" : "APPLY"} input-fee backfill from id > ${cursor}, batch ${batchSize}, sources ${FEE_SOURCES.join(",")}`);

    for (;;) {
      const { rows: idRows } = await db.query<{ trade_up_id: number }>(
        `SELECT DISTINCT tui.trade_up_id
         FROM trade_up_inputs tui
         JOIN listings l ON l.id = tui.listing_id
         JOIN trade_ups tu ON tu.id = tui.trade_up_id
         WHERE tu.is_theoretical = false
           AND tu.listing_status = 'active'
           AND tui.trade_up_id > $1
           AND tui.price_cents = l.price_cents
           AND tui.source = ANY($2::text[])
         ORDER BY tui.trade_up_id
         LIMIT $3`,
        [cursor, FEE_SOURCES, batchSize]
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
            fixes.push({ listing_id: input.listing_id, source: feeSource ?? "unknown", old: input.stored, next });
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
        const committed = await applyPlans(pool, plans, pauseMs, opts.lockTimeoutMs ?? 5000);
        if (opts.csvPath && committed.length > 0) {
          const lines = committed.map(row => `${row.trade_up_id},${row.listing_id},${row.old},${row.next}`);
          const header = csvHeaderWritten ? "" : "trade_up_id,listing_id,old_price,new_price\n";
          fs.appendFileSync(opts.csvPath, header + lines.join("\n") + "\n");
          csvHeaderWritten = true;
        }
      }

      for (const plan of plans) {
        tradeUpsAffected++;
        inputsAffected += plan.fixes.length;
        if (plan.projectionMismatch) projectionMismatches++;
        roiDeltas.push(plan.sample.old_roi - plan.sample.new_roi);
        costDeltas.push(plan.sample.new_cost_cents - plan.sample.old_cost_cents);
        scoreDrops.push(plan.oldScore - plan.newScore);
        scoreUpdates.set(plan.id, plan.newScore);
        for (const fix of plan.fixes) perMarketplace[fix.source] = (perMarketplace[fix.source] ?? 0) + 1;
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
      unclassifiableInputs,
      sourceMismatches,
      projectionMismatches,
      perMarketplace,
      lastId: cursor,
    };
    log(formatBackfillReport(report));
    return report;
  };

  return withTimedSession(pool, dryRun, run);
}

export function formatBackfillReport(report: BackfillReport): string {
  const markets = Object.entries(report.perMarketplace).map(([source, n]) => `${source} ${n}`).join(", ") || "none";
  const lines = [
    `${report.dryRun ? "DRY RUN" : "APPLIED"}: ${report.inputsAffected} inputs on ${report.tradeUpsAffected} trade-ups`,
    `per marketplace: ${markets}`,
    `unclassifiable (listing gone): ${report.unclassifiableInputs}`,
    `source mismatches (input source != listing source): ${report.sourceMismatches}`,
    `projection mismatches (stored total + delta vs input sum): ${report.projectionMismatches}`,
    `ROI delta (old - new), pts: mean ${report.avgRoiDelta}, median ${report.medianRoiDelta}, max ${report.maxRoiDelta}`,
    `cost delta (new - old), cents: mean ${report.costDelta.mean}, median ${report.costDelta.median}, max ${report.costDelta.max}`,
    `score drop: mean ${report.scoreDrop.mean}, median ${report.scoreDrop.median}, max ${report.scoreDrop.max}`,
    `M1 (median of diversified top 100): ${report.m1Before} -> ${report.m1After}`,
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
