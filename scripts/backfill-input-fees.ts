/**
 * One-time recompute of fee-inclusive input costs for active trade-ups.
 *
 * Dry-run by default. Writes nothing unless --apply is passed.
 * Do not run --apply against production without CEO approval.
 *
 *   npx tsx scripts/backfill-input-fees.ts                 # dry-run
 *   npx tsx scripts/backfill-input-fees.ts --apply         # write
 *   npx tsx scripts/backfill-input-fees.ts --from-id 1200  # resume
 *
 * A row is corrected only when its listing still exists, the stored input
 * price equals the raw listing price, and storedInputCost(raw, source) differs.
 * Inputs whose listing is gone are left alone. Batches are separate short
 * transactions (lock_timeout + statement_timeout); a killed run resumes from
 * the last committed trade-up id because healed rows drop out of the predicate.
 */

import fs from "fs";
import pg from "pg";
import { MARKETPLACE_FEES, storedInputCost } from "../server/engine/fees.js";
import { computeTradeUpCostStats, recomputeTradeUpCost } from "../server/engine/db-stats.js";

const { Pool } = pg;

const FEE_SOURCES = Object.entries(MARKETPLACE_FEES)
  .filter(([, f]) => f.buyerFeePct !== 0 || f.buyerFeeFlat !== 0)
  .map(([source]) => source);

export interface BackfillSample {
  trade_up_id: number;
  old_cost_cents: number;
  new_cost_cents: number;
  old_roi: number;
  new_roi: number;
}

export interface BackfillReport {
  dryRun: boolean;
  tradeUpsAffected: number;
  inputsAffected: number;
  avgRoiDelta: number;
  maxRoiDelta: number;
  sample: BackfillSample[];
  firstPageChanged: number;
  firstPageSize: number;
  ge50Before: number;
  ge50After: number;
  lastId: number;
}

export interface BackfillOptions {
  dryRun?: boolean;
  batchSize?: number;
  pauseMs?: number;
  fromId?: number;
  sampleSize?: number;
  csvPath?: string;
  log?: (line: string) => void;
}

interface CandidateInput {
  trade_up_id: number;
  listing_id: string;
  source: string | null;
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

function projectedScore(cost: number, profit: number, chance: number, worst: number): number {
  if (cost <= 0) return 0;
  const downside = Math.max(0, -worst) / cost;
  return Math.round((1000 * chance * (profit / cost)) / (1 + downside));
}

export async function runInputFeeBackfill(pool: pg.Pool, opts: BackfillOptions = {}): Promise<BackfillReport> {
  const dryRun = opts.dryRun !== false;
  const batchSize = opts.batchSize ?? 500;
  const pauseMs = opts.pauseMs ?? (dryRun ? 0 : 200);
  const sampleSize = opts.sampleSize ?? 8;
  const log = opts.log ?? ((line: string) => console.log(line));
  let cursor = opts.fromId ?? 0;

  const csv = !dryRun && opts.csvPath ? fs.createWriteStream(opts.csvPath, { flags: "a" }) : null;
  if (csv && opts.csvPath && !fs.existsSync(opts.csvPath)) {
    csv.write("trade_up_id,listing_id,old_price,new_price\n");
  } else if (csv && opts.csvPath && fs.statSync(opts.csvPath).size === 0) {
    csv.write("trade_up_id,listing_id,old_price,new_price\n");
  }

  const { rows: pageRows } = await pool.query<{ id: number }>(
    `SELECT id FROM trade_ups
     WHERE is_theoretical = false AND listing_status = 'active'
     ORDER BY trade_up_score DESC NULLS LAST, id DESC
     LIMIT 50`
  );
  const firstPage = new Set(pageRows.map(r => r.id));
  const { rows: geRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM trade_ups
     WHERE is_theoretical = false AND listing_status = 'active' AND trade_up_score >= 50`
  );
  const ge50Before = parseInt(geRows[0]?.n ?? "0", 10);
  let ge50Delta = 0;
  let firstPageChanged = 0;

  let tradeUpsAffected = 0;
  let inputsAffected = 0;
  let roiDeltaSum = 0;
  let maxRoiDelta = 0;
  const sample: BackfillSample[] = [];

  log(`${dryRun ? "DRY RUN" : "APPLY"} input-fee backfill from id > ${cursor}, batch ${batchSize}, sources ${FEE_SOURCES.join(",")}`);

  for (;;) {
    const { rows: idRows } = await pool.query<{ trade_up_id: number }>(
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

    const { rows: heads } = await pool.query<TradeUpHead>(
      `SELECT id, total_cost_cents, expected_value_cents, roi_percentage, trade_up_score, outcomes_json
       FROM trade_ups WHERE id = ANY($1::int[])`,
      [ids]
    );
    const headById = new Map(heads.map(h => [h.id, h]));
    const { rows: inputs } = await pool.query<CandidateInput>(
      `SELECT tui.trade_up_id, tui.listing_id, tui.source, tui.price_cents AS stored, l.price_cents AS raw
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

    const plans: { id: number; fixes: { listing_id: string; old: number; next: number }[]; sample: BackfillSample; crossesOutOfGe50: boolean }[] = [];
    for (const id of ids) {
      const head = headById.get(id);
      const group = byTradeUp.get(id);
      if (!head || !group) continue;
      const fixes: { listing_id: string; old: number; next: number }[] = [];
      for (const input of group) {
        if (input.raw === null) continue;
        if (input.stored !== input.raw) continue;
        const next = storedInputCost(input.raw, input.source);
        if (next === input.stored) continue;
        fixes.push({ listing_id: input.listing_id, old: input.stored, next });
      }
      if (fixes.length === 0) continue;
      const newCost = head.total_cost_cents + fixes.reduce((s, f) => s + (f.next - f.old), 0);
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
        crossesOutOfGe50: oldScore >= 50 && newScore < 50,
      });
    }

    if (!dryRun && plans.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        for (const plan of plans) {
          for (const fix of plan.fixes) {
            await client.query(
              "UPDATE trade_up_inputs SET price_cents = $1 WHERE trade_up_id = $2 AND listing_id = $3 AND price_cents = $4",
              [fix.next, plan.id, fix.listing_id, fix.old]
            );
            csv?.write(`${plan.id},${fix.listing_id},${fix.old},${fix.next}\n`);
          }
          await recomputeTradeUpCost(client, plan.id);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    for (const plan of plans) {
      tradeUpsAffected++;
      inputsAffected += plan.fixes.length;
      const delta = plan.sample.old_roi - plan.sample.new_roi;
      roiDeltaSum += delta;
      if (delta > maxRoiDelta) maxRoiDelta = delta;
      if (sample.length < sampleSize) sample.push(plan.sample);
      if (firstPage.has(plan.id)) firstPageChanged++;
      if (plan.crossesOutOfGe50) ge50Delta++;
    }

    log(`  batch through id ${cursor}: ${plans.length} trade-ups, running total ${tradeUpsAffected}`);
    if (idRows.length < batchSize) break;
    if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
  }

  csv?.end();
  const avgRoiDelta = tradeUpsAffected > 0 ? Math.round((roiDeltaSum / tradeUpsAffected) * 100) / 100 : 0;
  const report: BackfillReport = {
    dryRun,
    tradeUpsAffected,
    inputsAffected,
    avgRoiDelta,
    maxRoiDelta: Math.round(maxRoiDelta * 100) / 100,
    sample,
    firstPageChanged,
    firstPageSize: firstPage.size,
    ge50Before,
    ge50After: ge50Before - ge50Delta,
    lastId: cursor,
  };
  log(formatBackfillReport(report));
  return report;
}

export function formatBackfillReport(report: BackfillReport): string {
  const lines = [
    `${report.dryRun ? "DRY RUN" : "APPLIED"}: ${report.inputsAffected} inputs on ${report.tradeUpsAffected} trade-ups`,
    `ROI delta (old - new), pts: avg ${report.avgRoiDelta}, max ${report.maxRoiDelta}`,
    `first page: ${report.firstPageChanged}/${report.firstPageSize} would change`,
    `ge50: ${report.ge50Before} -> ${report.ge50After}`,
    "sample (trade_up_id old_cost -> new_cost, old_roi -> new_roi):",
    ...report.sample.map(s =>
      `  ${s.trade_up_id}  cost ${s.old_cost_cents} -> ${s.new_cost_cents}  roi ${s.old_roi} -> ${s.new_roi}`
    ),
  ];
  return lines.join("\n");
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isCli = process.argv[1]?.endsWith("backfill-input-fees.ts") || process.argv[1]?.endsWith("backfill-input-fees.js");

async function main() {
  const apply = process.argv.includes("--apply");
  const fromArg = argValue("--from-id");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runInputFeeBackfill(pool, {
      dryRun: !apply,
      fromId: fromArg ? parseInt(fromArg, 10) : 0,
      csvPath: apply ? (argValue("--csv") ?? `backfill-input-fees-${Date.now()}.csv`) : undefined,
    });
  } finally {
    await pool.end();
  }
}

if (isCli) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
