/**
 * One-time revive for DMarket relists that the fetcher deleted and cascaded to
 * `partial` (cycle 4193, ~05:34 PT 2026-09-25, and the 06:19 follow-up).
 *
 * MUST run --apply before purgeExpiredPreserved deletes those rows. Partials
 * are removed 24h after preserved_at, so the 05:34 PT batch is deleted around
 * 05:34 PT on 2026-09-26. This script does not wait on the 1000/cycle revive cap.
 *
 * Dry-run is the default and writes nothing. --hold inserts revivable ids into
 * trade_up_relist_hold so purgeExpiredPreserved skips them for 48 hours, but
 * only after this build is deployed and the daemon is restarted. Until then,
 * --apply is the protection. --apply drops holds for plans it does not restore.
 *
 *   npx tsx scripts/revive-dmarket-relists.ts
 *   npx tsx scripts/revive-dmarket-relists.ts --hours 36
 *   npx tsx scripts/revive-dmarket-relists.ts --hold
 *   npx tsx scripts/revive-dmarket-relists.ts --apply
 *
 * --apply writes trade_ups_bak_relist_YYYYMMDD and trade_up_inputs_bak_relist_YYYYMMDD
 * before it changes anything. Cost, profit, and trade_up_score go through
 * repricedInputCost + recomputeTradeUpCost (the reprice path; the score trigger
 * fires on that update). Status returns to active only when every input listing
 * is live and unclaimed.
 *
 * Paint seed is not compared: trade_up_inputs has no seed column and the deleted
 * listing row is gone, so the match is exact float plus skin name. Phased
 * (Doppler) listings are not candidates. A post-repoint input set that matches
 * another non-theoretical trade-up, or an earlier plan in this run, is skipped
 * (left partial, not held). Within-run collisions keep the highest score.
 *
 * Revert an apply (replace YYYYMMDD and RUN_ID). Only ids this run recorded in
 * trade_up_relist_applied for that run_id, and only rows that still exist in trade_ups.
 * relistRevertSql(day, runId) builds the same statements.
 *   BEGIN;
 *   DELETE FROM trade_up_inputs tui
 *   WHERE tui.trade_up_id IN (
 *     SELECT a.trade_up_id
 *     FROM trade_up_relist_applied a
 *     JOIN trade_ups t ON t.id = a.trade_up_id
 *     JOIN trade_ups_bak_relist_YYYYMMDD b ON b.id = a.trade_up_id
 *     WHERE a.run_id = 'RUN_ID'
 *   );
 *   INSERT INTO trade_up_inputs
 *   SELECT i.*
 *   FROM trade_up_inputs_bak_relist_YYYYMMDD i
 *   JOIN trade_up_relist_applied a ON a.trade_up_id = i.trade_up_id AND a.run_id = 'RUN_ID'
 *   JOIN trade_ups t ON t.id = i.trade_up_id;
 *   UPDATE trade_ups t SET
 *     total_cost_cents = b.total_cost_cents,
 *     expected_value_cents = b.expected_value_cents,
 *     profit_cents = b.profit_cents,
 *     roi_percentage = b.roi_percentage,
 *     chance_to_profit = b.chance_to_profit,
 *     best_case_cents = b.best_case_cents,
 *     worst_case_cents = b.worst_case_cents,
 *     listing_status = b.listing_status,
 *     preserved_at = b.preserved_at,
 *     input_sources = b.input_sources,
 *     outcomes_json = b.outcomes_json,
 *     output_repriced_at = b.output_repriced_at,
 *     trade_up_score = b.trade_up_score
 *   FROM trade_ups_bak_relist_YYYYMMDD b
 *   JOIN trade_up_relist_applied a ON a.trade_up_id = b.id AND a.run_id = 'RUN_ID'
 *   WHERE t.id = b.id;
 *   COMMIT;
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { pickDMarketRelist, type RelistCandidate } from "../server/dmarket-relist.js";
import { listingSig, parseSig, recomputeTradeUpCost, repricedInputCost } from "../server/engine.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && process.env[match[1].trim()] === undefined) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const BATCH = 50;
const LOCK_RETRIES = 3;
const LOCK_CODES = new Set(["40P01", "55P03", "57014"]);
const KNOWN_FLAGS = new Set(["--apply", "--dry-run", "--hold", "--hours"]);

export interface ReviveArgs {
  dryRun: boolean;
  hold: boolean;
  hours: number;
}

export function parseReviveArgs(argv: string[]): ReviveArgs {
  let apply = false;
  let dryRun = false;
  let hold = false;
  let hours = 36;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument ${flag}`);
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`unknown flag ${flag}`);
    if (flag === "--apply") apply = true;
    else if (flag === "--dry-run") dryRun = true;
    else if (flag === "--hold") hold = true;
    else if (flag === "--hours") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error("--hours needs a value");
      hours = Number(value);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number");
    }
  }
  if (apply && dryRun) throw new Error("pass either --dry-run or --apply, not both");
  if (apply && hold) throw new Error("pass either --hold or --apply, not both");
  return { dryRun: !apply && !hold, hold, hours };
}

interface MissingInput {
  tradeUpId: number;
  type: string;
  score: number;
  listingId: string;
  skinName: string;
  floatValue: number;
  priceCents: number;
  source: string;
}

interface LiveInput {
  tradeUpId: number;
  listingId: string;
  live: boolean;
}

interface ListingRow {
  id: string;
  skinName: string;
  floatValue: number;
  paintSeed: number | null;
  priceCents: number;
}

export interface RelistPlan {
  tradeUpId: number;
  type: string;
  score: number;
  repoints: { oldListingId: string; newListingId: string; rawPriceCents: number; source: string }[];
}

export interface ReviveReport {
  candidates: number;
  revivable: number;
  restored: number;
  scoreGe10: number;
  byType: Record<string, number>;
  skipped: Record<string, number>;
}

/** Statements that restore only the backup rows recorded for one run_id. */
export function relistRevertSql(backupDay: string, runId: string): string {
  if (!/^\d{8}$/.test(backupDay)) throw new Error("backup day must be YYYYMMDD");
  if (runId.length === 0 || runId.includes("'")) throw new Error("run id must be a non-empty string without quotes");
  const tradeUps = `trade_ups_bak_relist_${backupDay}`;
  const inputs = `trade_up_inputs_bak_relist_${backupDay}`;
  return [
    "BEGIN;",
    `DELETE FROM trade_up_inputs tui
   WHERE tui.trade_up_id IN (
     SELECT a.trade_up_id
     FROM trade_up_relist_applied a
     JOIN trade_ups t ON t.id = a.trade_up_id
     JOIN ${tradeUps} b ON b.id = a.trade_up_id
     WHERE a.run_id = '${runId}'
   );`,
    `INSERT INTO trade_up_inputs
   SELECT i.*
   FROM ${inputs} i
   JOIN trade_up_relist_applied a ON a.trade_up_id = i.trade_up_id AND a.run_id = '${runId}'
   JOIN trade_ups t ON t.id = i.trade_up_id;`,
    `UPDATE trade_ups t SET
     total_cost_cents = b.total_cost_cents,
     expected_value_cents = b.expected_value_cents,
     profit_cents = b.profit_cents,
     roi_percentage = b.roi_percentage,
     chance_to_profit = b.chance_to_profit,
     best_case_cents = b.best_case_cents,
     worst_case_cents = b.worst_case_cents,
     listing_status = b.listing_status,
     preserved_at = b.preserved_at,
     input_sources = b.input_sources,
     outcomes_json = b.outcomes_json,
     output_repriced_at = b.output_repriced_at,
     trade_up_score = b.trade_up_score
   FROM ${tradeUps} b
   JOIN trade_up_relist_applied a ON a.trade_up_id = b.id AND a.run_id = '${runId}'
   WHERE t.id = b.id;`,
    "COMMIT;",
  ].join("\n");
}

export function emptyReport(): ReviveReport {
  return { candidates: 0, revivable: 0, restored: 0, scoreGe10: 0, byType: {}, skipped: {} };
}

function bump(map: Record<string, number>, key: string, n = 1) {
  map[key] = (map[key] ?? 0) + n;
}

export function formatReviveReport(report: ReviveReport, mode: string): string {
  const types = Object.entries(report.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";
  const skipped = Object.entries(report.skipped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)";
  return [
    `mode: ${mode}`,
    `candidates: ${report.candidates}`,
    `revivable: ${report.revivable}`,
    `would_restore_active: ${report.restored}`,
    `score>=10: ${report.scoreGe10}`,
    `by type: ${types}`,
    `dup-existing: ${report.skipped["dup-existing"] ?? 0}`,
    `skipped: ${skipped}`,
  ].join("\n");
}

/** Same identity discovery stores: sorted listing ids (`listingSig` / db-save). */
export function postRepointListingSig(
  listingIds: readonly string[],
  repoints: readonly { oldListingId: string; newListingId: string }[],
): string {
  const next = new Map(repoints.map(repoint => [repoint.oldListingId, repoint.newListingId]));
  return listingSig(listingIds.map(id => next.get(id) ?? id));
}

export interface SigPlan {
  plan: RelistPlan;
  sig: string;
  allLive: boolean;
}

/** Drop sets that already exist. Within this run, keep the highest score. */
export function dedupeRelistPlans(plans: readonly SigPlan[], existingSigs: ReadonlySet<string>): {
  kept: SigPlan[];
  dupExisting: number;
  dupWithinRun: number;
} {
  let dupExisting = 0;
  const fresh: SigPlan[] = [];
  for (const plan of plans) {
    if (existingSigs.has(plan.sig)) dupExisting++;
    else fresh.push(plan);
  }
  fresh.sort((a, b) => b.plan.score - a.plan.score || a.plan.tradeUpId - b.plan.tradeUpId);
  const seen = new Set<string>();
  const kept: SigPlan[] = [];
  let dupWithinRun = 0;
  for (const plan of fresh) {
    if (seen.has(plan.sig)) {
      dupWithinRun++;
      continue;
    }
    seen.add(plan.sig);
    kept.push(plan);
  }
  return { kept, dupExisting, dupWithinRun };
}

function pgCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}

/** One input row must move. Anything else means the row changed since planning. */
export function inputUpdateOk(rowCount: number | null | undefined): boolean {
  return rowCount === 1;
}

export type RetryDecision = "retry" | "skip" | "throw";

/** Deadlock, lock timeout, and statement timeout are retried, then the batch is skipped. */
export function retryDecision(code: string, attempt: number): RetryDecision {
  if (!LOCK_CODES.has(code)) return "throw";
  if (attempt >= LOCK_RETRIES) return "skip";
  return "retry";
}

async function withLockRetry(label: string, fn: () => Promise<void>): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      const code = pgCode(err);
      const decision = retryDecision(code, attempt);
      if (decision === "throw") throw err;
      if (decision === "skip") {
        console.warn(`${label}: ${code} after ${LOCK_RETRIES} retries, skipping batch`);
        return false;
      }
      const wait = 50 * 2 ** attempt;
      console.warn(`${label}: ${code}, retry ${attempt + 1} in ${wait}ms`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

const PRIOR_STATUS = "active";

export async function planDMarketRelistRevive(pool: pg.Pool, hours: number): Promise<{ plans: RelistPlan[]; report: ReviveReport }> {
  const report = emptyReport();
  const { rows: missing } = await pool.query<MissingInput>(`
    SELECT tu.id AS "tradeUpId", tu.type, COALESCE(tu.trade_up_score, 0)::int AS score,
           tui.listing_id AS "listingId", tui.skin_name AS "skinName",
           tui.float_value AS "floatValue", tui.price_cents AS "priceCents", tui.source
    FROM trade_ups tu
    JOIN trade_up_inputs tui ON tui.trade_up_id = tu.id
    LEFT JOIN listings l ON l.id = tui.listing_id
    WHERE tu.listing_status = 'partial'
      AND tu.is_theoretical = false
      AND tu.preserved_at >= NOW() - ($1 * INTERVAL '1 hour')
      AND l.id IS NULL
      AND tui.listing_id LIKE 'dmarket:%'
  `, [hours]);

  const { rows: others } = await pool.query<{ tradeUpId: number }>(`
    SELECT DISTINCT tu.id AS "tradeUpId"
    FROM trade_ups tu
    JOIN trade_up_inputs tui ON tui.trade_up_id = tu.id
    LEFT JOIN listings l ON l.id = tui.listing_id
    WHERE tu.listing_status = 'partial'
      AND tu.is_theoretical = false
      AND tu.preserved_at >= NOW() - ($1 * INTERVAL '1 hour')
      AND l.id IS NULL
      AND tui.listing_id NOT LIKE 'dmarket:%'
      AND tui.listing_id NOT LIKE 'theor%'
  `, [hours]);
  const nonDMarketMissing = new Set(others.map(r => r.tradeUpId));

  const byTradeUp = new Map<number, MissingInput[]>();
  for (const row of missing) {
    const list = byTradeUp.get(row.tradeUpId) ?? [];
    list.push(row);
    byTradeUp.set(row.tradeUpId, list);
  }
  report.candidates = byTradeUp.size;

  const distinct = new Map<string, MissingInput>();
  for (const row of missing) {
    if (!distinct.has(row.listingId)) distinct.set(row.listingId, row);
  }

  const relistByOldId = new Map<string, { id: string; priceCents: number } | "no_relist" | "ambiguous">();
  const listingsBySkin = new Map<string, ListingRow[]>();
  for (const row of distinct.values()) {
    let listings = listingsBySkin.get(row.skinName);
    if (!listings) {
      const stattrak = row.skinName.startsWith("StatTrak™");
      const { rows } = await pool.query<ListingRow>(`
        SELECT l.id, s.name AS "skinName", l.float_value AS "floatValue",
               l.paint_seed AS "paintSeed", l.price_cents AS "priceCents"
        FROM listings l
        JOIN skins s ON s.id = l.skin_id
        WHERE s.name = $1 AND l.source = 'dmarket' AND l.id LIKE 'dmarket:%'
          AND l.stattrak = $2
          AND (l.phase IS NULL OR l.phase = '')
      `, [row.skinName, stattrak]);
      listings = rows;
      listingsBySkin.set(row.skinName, listings);
    }
    const candidates: RelistCandidate[] = listings
      .filter(l => l.id !== row.listingId)
      .map(l => ({
        id: l.id,
        skinName: l.skinName,
        floatValue: l.floatValue,
        paintSeed: l.paintSeed,
        assetId: null,
      }));
    const picked = pickDMarketRelist({
      skinName: row.skinName,
      floatValue: row.floatValue,
      paintSeed: null,
      assetId: null,
    }, candidates);
    if (!picked.ok) {
      relistByOldId.set(row.listingId, picked.reason);
      continue;
    }
    const listing = listings.find(l => l.id === picked.match.id);
    relistByOldId.set(row.listingId, {
      id: picked.match.id,
      priceCents: listing?.priceCents ?? 0,
    });
  }

  const rawPlans: SigPlan[] = [];
  const tradeUpIds = [...byTradeUp.keys()];
  const liveByTradeUp = new Map<number, LiveInput[]>();
  for (let i = 0; i < tradeUpIds.length; i += 500) {
    const chunk = tradeUpIds.slice(i, i + 500);
    const { rows } = await pool.query<LiveInput>(`
      SELECT tui.trade_up_id AS "tradeUpId", tui.listing_id AS "listingId",
             (l.id IS NOT NULL AND l.claimed_by IS NULL) AS live
      FROM trade_up_inputs tui
      LEFT JOIN listings l ON l.id = tui.listing_id
      WHERE tui.trade_up_id = ANY($1) AND tui.listing_id NOT LIKE 'theor%'
    `, [chunk]);
    for (const row of rows) {
      const list = liveByTradeUp.get(row.tradeUpId) ?? [];
      list.push(row);
      liveByTradeUp.set(row.tradeUpId, list);
    }
  }

  for (const [tradeUpId, inputs] of byTradeUp) {
    const sample = inputs[0];
    if (nonDMarketMissing.has(tradeUpId)) {
      bump(report.skipped, "non_dmarket_missing");
      continue;
    }
    const repoints: RelistPlan["repoints"] = [];
    let skip: string | null = null;
    const newIds = new Set<string>();
    for (const input of inputs) {
      const relist = relistByOldId.get(input.listingId);
      if (relist === "no_relist" || relist === undefined) { skip = "no_relist"; break; }
      if (relist === "ambiguous") { skip = "ambiguous"; break; }
      if (newIds.has(relist.id)) { skip = "duplicate_relist"; break; }
      newIds.add(relist.id);
      repoints.push({
        oldListingId: input.listingId,
        newListingId: relist.id,
        rawPriceCents: relist.priceCents,
        source: "dmarket",
      });
    }
    if (skip) {
      bump(report.skipped, skip);
      continue;
    }
    const currentIds = new Set((liveByTradeUp.get(tradeUpId) ?? []).map(r => r.listingId));
    if (repoints.some(r => currentIds.has(r.newListingId))) {
      bump(report.skipped, "new_id_already_input");
      continue;
    }
    const listingIds = (liveByTradeUp.get(tradeUpId) ?? []).map(row => row.listingId);
    const replaced = new Set(repoints.map(r => r.oldListingId));
    const allLive = (liveByTradeUp.get(tradeUpId) ?? []).every(row => replaced.has(row.listingId) || row.live);
    rawPlans.push({
      plan: { tradeUpId, type: sample.type, score: sample.score, repoints },
      sig: postRepointListingSig(listingIds, repoints),
      allLive,
    });
  }

  const newIds = [...new Set(rawPlans.flatMap(item => item.plan.repoints.map(repoint => repoint.newListingId)))];
  const existingSigs = new Set<string>();
  for (let i = 0; i < newIds.length; i += 500) {
    const chunk = newIds.slice(i, i + 500);
    const { rows } = await pool.query<{ ids: string }>(`
      SELECT STRING_AGG(tui.listing_id::text, ',') AS ids
      FROM trade_ups t
      JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
      WHERE t.is_theoretical = false
        AND t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE listing_id = ANY($1))
      GROUP BY t.id
    `, [chunk]);
    for (const row of rows) if (row.ids) existingSigs.add(parseSig(row.ids));
  }
  const deduped = dedupeRelistPlans(rawPlans, existingSigs);
  if (deduped.dupExisting > 0) bump(report.skipped, "dup-existing", deduped.dupExisting);
  if (deduped.dupWithinRun > 0) bump(report.skipped, "dup-within-run", deduped.dupWithinRun);
  const plans: RelistPlan[] = [];
  for (const item of deduped.kept) {
    plans.push(item.plan);
    bump(report.byType, item.plan.type);
    report.revivable++;
    if (item.plan.score >= 10) report.scoreGe10++;
    if (item.allLive) report.restored++;
  }

  return { plans, report };
}

function backupName(table: string, day: string): string {
  if (!/^\d{8}$/.test(day)) throw new Error(`bad backup day ${day}`);
  return `${table}_bak_relist_${day}`;
}

export function backupDay(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

async function backupTouched(pool: pg.Pool, plans: RelistPlan[], day: string): Promise<boolean> {
  const tuName = backupName("trade_ups", day);
  const inName = backupName("trade_up_inputs", day);
  const ids = plans.map(p => p.tradeUpId);
  return withLockRetry("backup", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query(`CREATE TABLE IF NOT EXISTS ${tuName} (LIKE trade_ups INCLUDING DEFAULTS)`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${inName} (LIKE trade_up_inputs INCLUDING DEFAULTS)`);
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        await client.query(
          `INSERT INTO ${tuName} SELECT * FROM trade_ups tu WHERE tu.id = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM ${tuName} b WHERE b.id = tu.id)`,
          [chunk],
        );
        await client.query(
          `INSERT INTO ${inName} SELECT * FROM trade_up_inputs tui WHERE tui.trade_up_id = ANY($1)
           AND NOT EXISTS (
             SELECT 1 FROM ${inName} b WHERE b.trade_up_id = tui.trade_up_id AND b.listing_id = tui.listing_id
           )`,
          [chunk],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}

async function ensureHoldTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_up_relist_hold (
      trade_up_id INTEGER PRIMARY KEY,
      flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function holdPlans(pool: pg.Pool, plans: RelistPlan[]): Promise<void> {
  await ensureHoldTable(pool);
  for (let i = 0; i < plans.length; i += BATCH) {
    const chunk = plans.slice(i, i + BATCH).map(p => p.tradeUpId);
    await pool.query(
      `INSERT INTO trade_up_relist_hold (trade_up_id)
       SELECT UNNEST($1::int[])
       ON CONFLICT (trade_up_id) DO NOTHING`,
      [chunk],
    );
  }
}

const APPLIED_PK_OLD = "trade_up_id";

/**
 * Fresh tables are created with PRIMARY KEY (trade_up_id, run_id).
 * A table that still has the old PRIMARY KEY (trade_up_id) is migrated once,
 * and only when (trade_up_id, run_id) is already unique. Any other key is left alone.
 */
export async function ensureAppliedTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_up_relist_applied (
      trade_up_id INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      run_id TEXT NOT NULL,
      PRIMARY KEY (trade_up_id, run_id)
    )
  `);
  const { rows } = await pool.query<{ name: string; cols: string | null }>(`
    SELECT c.conname AS name, string_agg(a.attname, ',' ORDER BY k.ord) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE t.relname = 'trade_up_relist_applied' AND c.contype = 'p'
      AND t.relnamespace = current_schema()::regnamespace
    GROUP BY c.conname
  `);
  const pk = rows[0];
  if (!pk || pk.cols !== APPLIED_PK_OLD) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pk.name)) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: dupes } = await client.query(
      `SELECT 1 FROM trade_up_relist_applied
       GROUP BY trade_up_id, run_id
       HAVING COUNT(*) > 1
       LIMIT 1`,
    );
    if (dupes.length > 0) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(`ALTER TABLE trade_up_relist_applied DROP CONSTRAINT ${client.escapeIdentifier(pk.name)}`);
    await client.query(`ALTER TABLE trade_up_relist_applied ADD PRIMARY KEY (trade_up_id, run_id)`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function applyPlans(pool: pg.Pool, plans: RelistPlan[], runId: string): Promise<{ applied: number; restoredIds: number[]; scoreGe10: number }> {
  await ensureAppliedTable(pool);
  let applied = 0;
  const restoredIds: number[] = [];
  let scoreGe10 = 0;
  for (let i = 0; i < plans.length; i += BATCH) {
    const chunk = plans.slice(i, i + BATCH);
    const batch = { applied: 0, restoredIds: [] as number[], scoreGe10: 0 };
    const ok = await withLockRetry(`apply offset ${i}`, async () => {
      batch.applied = 0;
      batch.restoredIds = [];
      batch.scoreGe10 = 0;
      const client = await pool.connect();
      try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      let savepoint = 0;
      for (const plan of chunk) {
        const sp = `relist_sp_${savepoint++}`;
        await client.query(`SAVEPOINT ${sp}`);
        let mismatch = false;
        for (const repoint of plan.repoints) {
          const price = repricedInputCost(repoint.rawPriceCents, repoint.source);
          const updated = await client.query(
            `UPDATE trade_up_inputs
             SET listing_id = $1, price_cents = $2, source = $3
             WHERE trade_up_id = $4 AND listing_id = $5`,
            [repoint.newListingId, price, repoint.source, plan.tradeUpId, repoint.oldListingId],
          );
          if (!inputUpdateOk(updated.rowCount)) {
            mismatch = true;
            break;
          }
        }
        if (mismatch) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          console.warn(`skip trade-up ${plan.tradeUpId}: input update rowCount was not 1`);
          continue;
        }
        await recomputeTradeUpCost(client, plan.tradeUpId);
        const { rows } = await client.query<{ live: number; total: number; score: number }>(`
          SELECT
            COUNT(*) FILTER (WHERE l.id IS NOT NULL AND l.claimed_by IS NULL)::int AS live,
            COUNT(*)::int AS total,
            COALESCE(tu.trade_up_score, 0)::int AS score
          FROM trade_up_inputs tui
          JOIN trade_ups tu ON tu.id = tui.trade_up_id
          LEFT JOIN listings l ON l.id = tui.listing_id
          WHERE tui.trade_up_id = $1 AND tui.listing_id NOT LIKE 'theor%'
          GROUP BY tu.trade_up_score
        `, [plan.tradeUpId]);
        const row = rows[0];
        const allLive = row != null && row.total > 0 && row.live === row.total;
        if (allLive) {
          await client.query(
            `UPDATE trade_ups
             SET listing_status = $2, preserved_at = NULL
             WHERE id = $1 AND listing_status = 'partial'`,
            [plan.tradeUpId, PRIOR_STATUS],
          );
          batch.restoredIds.push(plan.tradeUpId);
        }
        if ((row?.score ?? plan.score) >= 10) batch.scoreGe10++;
        await client.query(
          `INSERT INTO trade_up_relist_applied (trade_up_id, run_id) VALUES ($1, $2)
           ON CONFLICT (trade_up_id, run_id) DO NOTHING`,
          [plan.tradeUpId, runId],
        );
        batch.applied++;
      }
      await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
    if (!ok) continue;
    applied += batch.applied;
    restoredIds.push(...batch.restoredIds);
    scoreGe10 += batch.scoreGe10;
  }
  return { applied, restoredIds, scoreGe10 };
}

export async function runReviveDMarketRelists(pool: pg.Pool, args: ReviveArgs, now = new Date()): Promise<ReviveReport> {
  const { plans, report } = await planDMarketRelistRevive(pool, args.hours);
  if (args.dryRun) return report;
  if (plans.length === 0) return report;
  if (args.hold) {
    await holdPlans(pool, plans);
    return report;
  }
  const backedUp = await backupTouched(pool, plans, backupDay(now));
  if (!backedUp) {
    console.warn("backup did not commit; apply skipped");
    return report;
  }
  await holdPlans(pool, plans);
  const applied = await applyPlans(pool, plans, now.toISOString());
  report.revivable = applied.applied;
  report.restored = applied.restoredIds.length;
  report.scoreGe10 = applied.scoreGe10;
  const restored = new Set(applied.restoredIds);
  const unrestored = plans.map(plan => plan.tradeUpId).filter(id => !restored.has(id));
  if (unrestored.length > 0) {
    await pool.query(`DELETE FROM trade_up_relist_hold WHERE trade_up_id = ANY($1)`, [unrestored]);
  }
  if (applied.restoredIds.length > 0) {
    await pool.query(`DELETE FROM trade_up_relist_hold WHERE trade_up_id = ANY($1)`, [applied.restoredIds]);
  }
  return report;
}

const isCli = process.argv[1]?.endsWith("revive-dmarket-relists.ts")
  || process.argv[1]?.endsWith("revive-dmarket-relists.js");

async function main() {
  const args = parseReviveArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unset");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const mode = args.dryRun ? "dry-run" : args.hold ? "hold" : "apply";
  try {
    console.log(`window: last ${args.hours}h`);
    const report = await runReviveDMarketRelists(pool, args);
    console.log(formatReviveReport(report, mode));
    if (args.dryRun) {
      console.log("no rows written. --apply backs up then repoints. --hold only flags purge skips.");
      console.log("run --apply before the 24h preserved purge (05:34 PT 2026-09-26 for the 05:34 batch).");
    }
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
