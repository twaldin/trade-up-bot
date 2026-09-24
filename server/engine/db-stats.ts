/**
 * Collection scoring and trade-up cost recalculation.
 */

import pg from "pg";
import { withRetry, isTransientDbError, computeChanceToProfit, computeBestWorstCase } from "./utils.js";
import { lookupOutputPrice, buildPriceCache, warmOutputPriceCaches, type OutputPriceResult } from "./pricing.js";
import { repricedInputCost } from "./fees.js";
import { floatToCondition, type TradeUpOutcome } from "../../shared/types.js";
import {
  ensureInputReferences, isInputPriceOutlier, markTradeUpsOutlierStale,
  type InputRefLookup,
} from "./input-outlier.js";

type Queryable = pg.Pool | pg.PoolClient;

export interface RecomputedTradeUpCost {
  total_cost_cents: number;
  expected_value_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
}

/** Cost-side stats for a trade-up from its (fee-inclusive) input cost and stored EV/outcomes. */
export function computeTradeUpCostStats(
  cost: number,
  ev: number,
  outcomes: { estimated_price_cents: number; probability: number }[],
): Omit<RecomputedTradeUpCost, "expected_value_cents" | "total_cost_cents"> {
  const profit = ev - cost;
  const roi = cost > 0 ? Math.round((profit / cost) * 10000) / 100 : 0;
  const chance = computeChanceToProfit(outcomes, cost);
  const { bestCase, worstCase } = computeBestWorstCase(outcomes, cost);
  return { profit_cents: profit, roi_percentage: roi, chance_to_profit: chance, best_case_cents: bestCase, worst_case_cents: worstCase };
}

/**
 * Recompute total_cost = Σ trade_up_inputs.price_cents and every cost-derived
 * column (profit, roi, chance, best, worst) from the stored EV/outcomes, so the
 * score trigger always sees consistent inputs. Returns null if the trade-up is gone.
 */
export async function recomputeTradeUpCost(db: Queryable, tradeUpId: number): Promise<RecomputedTradeUpCost | null> {
  const { rows } = await db.query(
    `SELECT tu.expected_value_cents, tu.outcomes_json,
            (SELECT SUM(price_cents) FROM trade_up_inputs WHERE trade_up_id = tu.id) AS total
     FROM trade_ups tu WHERE tu.id = $1`,
    [tradeUpId]
  );
  const tu = rows[0] as { expected_value_cents: number; outcomes_json: string | null; total: string | null } | undefined;
  if (!tu || tu.total === null) return null;

  const cost = parseInt(tu.total, 10);
  const ev = tu.expected_value_cents;
  const outcomes = JSON.parse(tu.outcomes_json || "[]") as { estimated_price_cents: number; probability: number }[];
  const stats = computeTradeUpCostStats(cost, ev, outcomes);

  await db.query(
    `UPDATE trade_ups SET total_cost_cents = $1, profit_cents = $2, roi_percentage = $3,
       chance_to_profit = $4, best_case_cents = $5, worst_case_cents = $6,
       input_sources = COALESCE((
         SELECT ARRAY_AGG(DISTINCT source ORDER BY source) FROM trade_up_inputs WHERE trade_up_id = $7
       ), '{}')
     WHERE id = $7`,
    [cost, stats.profit_cents, stats.roi_percentage, stats.chance_to_profit, stats.best_case_cents, stats.worst_case_cents, tradeUpId]
  );
  return { total_cost_cents: cost, expected_value_cents: ev, ...stats };
}

/**
 * Re-derive stored input costs for every trade-up using `listingId` from its
 * current raw listing price. Only inputs whose stored cost differs from
 * storedInputCost(raw, input source) are written; only those trade-ups are recomputed.
 */
export async function applyListingPriceToInputs(
  db: Queryable,
  listingId: string,
  rawPriceCents: number,
  listingSource?: string | null,
  refLookup?: InputRefLookup,
): Promise<{ inputsUpdated: number; tradeUpsUpdated: number; tradeUpsFlagged: number }> {
  const { rows } = await db.query(
    `SELECT tui.trade_up_id, tui.source, tui.price_cents, tui.skin_name, tui.float_value, l.source AS listing_source
     FROM trade_up_inputs tui
     LEFT JOIN listings l ON l.id = tui.listing_id
     WHERE tui.listing_id = $1`,
    [listingId]
  );
  let inputsUpdated = 0;
  const tradeUpIds = new Set<number>();
  const flagged = new Set<number>();
  for (const r of rows as {
    trade_up_id: number; source: string | null; price_cents: number; listing_source: string | null;
    skin_name: string; float_value: number;
  }[]) {
    const feeSource = listingSource ?? r.listing_source ?? r.source ?? "csfloat";
    const expected = repricedInputCost(rawPriceCents, feeSource);
    if (refLookup) {
      const condition = floatToCondition(Number(r.float_value));
      if (isInputPriceOutlier({
        skinName: r.skin_name,
        condition,
        newPriceCents: rawPriceCents,
        oldPriceCents: r.price_cents,
        feeSource,
        refCents: refLookup(r.skin_name, condition),
      })) {
        flagged.add(r.trade_up_id);
        continue;
      }
    }
    if (expected === r.price_cents && feeSource === r.source) continue;
    await db.query(
      "UPDATE trade_up_inputs SET price_cents = $1, source = $2 WHERE trade_up_id = $3 AND listing_id = $4",
      [expected, feeSource, r.trade_up_id, listingId]
    );
    inputsUpdated++;
    tradeUpIds.add(r.trade_up_id);
  }
  for (const id of tradeUpIds) {
    if (!flagged.has(id)) await recomputeTradeUpCost(db, id);
  }
  await markTradeUpsOutlierStale(db, [...flagged]);
  return { inputsUpdated, tradeUpsUpdated: tradeUpIds.size, tradeUpsFlagged: flagged.size };
}

export async function updateCollectionScores(pool: pg.Pool) {
  const { rows: scores } = await pool.query(`
    SELECT
      tui.collection_name,
      COUNT(DISTINCT tu.id) as total_tradeups,
      SUM(CASE WHEN tu.profit_cents > 500 THEN 1 ELSE 0 END) as profitable_count,
      AVG(CASE WHEN tu.profit_cents > 0 THEN tu.profit_cents ELSE NULL END) as avg_profit,
      MAX(tu.profit_cents) as max_profit,
      AVG(CASE WHEN tu.profit_cents > 0 THEN tu.roi_percentage ELSE NULL END) as avg_roi
    FROM trade_ups tu
    JOIN trade_up_inputs tui ON tu.id = tui.trade_up_id
    GROUP BY tui.collection_name
  `);

  const colIdLookup = new Map<string, string>();
  const { rows: colRows } = await pool.query("SELECT id, name FROM collections");
  for (const r of colRows) colIdLookup.set(r.name, r.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM collection_scores");

    for (const s of scores) {
      const colId = colIdLookup.get(s.collection_name);
      if (!colId) continue;

      const profitableWeight = Math.min(parseInt(s.profitable_count, 10), 50);
      const avgProfitWeight = Math.min((s.avg_profit ?? 0) / 100, 50);
      const roiWeight = Math.min((s.avg_roi ?? 0) / 5, 20);
      const priorityScore = profitableWeight * 2 + avgProfitWeight + roiWeight;

      await client.query(`
        INSERT INTO collection_scores
          (collection_id, collection_name, profitable_count, avg_profit_cents, max_profit_cents, avg_roi, total_tradeups, priority_score, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (collection_id) DO UPDATE SET
          collection_name = $2, profitable_count = $3, avg_profit_cents = $4, max_profit_cents = $5,
          avg_roi = $6, total_tradeups = $7, priority_score = $8, updated_at = NOW()
      `, [
        colId,
        s.collection_name,
        parseInt(s.profitable_count, 10),
        Math.round(s.avg_profit ?? 0),
        s.max_profit,
        Math.round((s.avg_roi ?? 0) * 100) / 100,
        parseInt(s.total_tradeups, 10),
        Math.round(priorityScore * 100) / 100
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(`  Updated ${scores.length} collection scores`);
}

/**
 * Batch recalc trade-up stats when input listing prices have changed.
 * Finds inputs whose stored (fee-inclusive) price differs from
 * storedInputCost(listings.price_cents, input source), writes that fee-inclusive
 * price, and recalculates profit/roi/chance/best/worst from the stored outcomes_json.
 * Stripped inputs (stored = raw) therefore heal the next time their listing is flagged.
 * Lightweight — no float calculations or outcome re-evaluation needed.
 *
 * Optimization: when `sinceTimestamp` is provided, only checks listings whose
 * price_updated_at is after that timestamp (avoids scanning all 10M+ input rows).
 * Falls back to full scan if no timestamp is provided.
 */
export async function recalcTradeUpCosts(pool: pg.Pool, sinceTimestamp?: string): Promise<{ updated: number; flagged: number }> {
  // Find trade-ups with at least one input whose price differs from the listing.
  // Only check listings with price_updated_at set (avoids full 12M row scan).
  // If no sinceTimestamp, skip entirely — full scan is too expensive on 12M rows.
  if (!sinceTimestamp) return { updated: 0, flagged: 0 };

  // Cap to 500 listings per cycle to keep the JOIN through trade_up_inputs fast.
  // Remaining listings keep their price_updated_at and get picked up next cycle.
  const { rows: changedListings } = await pool.query(
    "SELECT id FROM listings WHERE price_updated_at > $1 LIMIT 500",
    [sinceTimestamp]
  );
  if (changedListings.length === 0) return { updated: 0, flagged: 0 };
  const refLookup = await ensureInputReferences(pool);
  const changedIds = changedListings.map((r: { id: string }) => r.id);
  const ph = changedIds.map((_: string, i: number) => `$${i + 1}`).join(",");
  const { rows: inputRows } = await pool.query(`
    SELECT tui.trade_up_id, tui.listing_id, tui.source, tui.skin_name, tui.float_value,
           l.source AS listing_source, tui.price_cents AS stored, l.price_cents AS raw
    FROM trade_up_inputs tui
    JOIN listings l ON tui.listing_id = l.id
    WHERE tui.listing_id IN (${ph})
  `, changedIds);

  // Fee-to-fee comparison against the listing's source (discovery's rule).
  // A flagged listing whose raw price is unchanged must be a no-op.
  const driftByTradeUp = new Map<number, { listing_id: string; price_cents: number; source: string }[]>();
  const flagged = new Set<number>();
  for (const r of inputRows as {
    trade_up_id: number; listing_id: string; source: string | null; listing_source: string | null;
    skin_name: string; float_value: number; stored: number; raw: number;
  }[]) {
    const feeSource = r.listing_source ?? r.source ?? "csfloat";
    const expected = repricedInputCost(r.raw, feeSource);
    const condition = floatToCondition(Number(r.float_value));
    if (isInputPriceOutlier({
      skinName: r.skin_name,
      condition,
      newPriceCents: r.raw,
      oldPriceCents: r.stored,
      feeSource,
      refCents: refLookup(r.skin_name, condition),
    })) {
      flagged.add(r.trade_up_id);
      continue;
    }
    if (expected === r.stored && feeSource === r.source) continue;
    const list = driftByTradeUp.get(r.trade_up_id) ?? [];
    list.push({ listing_id: r.listing_id, price_cents: expected, source: feeSource });
    driftByTradeUp.set(r.trade_up_id, list);
  }
  for (const id of flagged) driftByTradeUp.delete(id);
  if (flagged.size > 0) {
    await markTradeUpsOutlierStale(pool, [...flagged]);
    const { cacheInvalidatePrefix } = await import("../redis.js");
    await cacheInvalidatePrefix("tu:");
  }
  if (driftByTradeUp.size === 0) {
    // No actual price mismatches in this batch — clear their flags
    const clearPh = changedIds.map((_: string, i: number) => `$${i + 1}`).join(",");
    await pool.query(`UPDATE listings SET price_updated_at = NULL WHERE id IN (${clearPh})`, changedIds);
    return { updated: 0, flagged: flagged.size };
  }

  const tuIds = [...driftByTradeUp.keys()];

  let updated = 0;
  const BATCH = 500;
  for (let i = 0; i < tuIds.length; i += BATCH) {
    const batch = tuIds.slice(i, i + BATCH);
    await withRetry(async () => {
      const client = await pool.connect();
      let batchUpdated = 0;
      try {
        await client.query('BEGIN');
        for (const tuId of batch) {
          for (const d of driftByTradeUp.get(tuId) ?? []) {
            await client.query(
              "UPDATE trade_up_inputs SET price_cents = $1, source = $2 WHERE trade_up_id = $3 AND listing_id = $4",
              [d.price_cents, d.source, tuId, d.listing_id]
            );
          }
          if (await recomputeTradeUpCost(client, tuId)) batchUpdated++;
        }
        await client.query('COMMIT');
        updated += batchUpdated;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }, 3, "recalcTradeUpCosts");
  }

  // Clear price_updated_at only on the listings we actually processed (not all changed ones).
  // Remaining listings keep their flag and get picked up next cycle.
  if (changedIds.length > 0) {
    const clearPh = changedIds.map((_: string, i: number) => `$${i + 1}`).join(",");
    await pool.query(`UPDATE listings SET price_updated_at = NULL WHERE id IN (${clearPh})`, changedIds);
  }

  return { updated, flagged: flagged.size };
}

/** Concurrent reprice workers. 8-wide plus Skinport WS flush starved the
 *  20-connection pool (5s checkout) and crashed the daemon. Leave headroom. */
const REPRICE_COMPUTE_CONCURRENCY = 4;

/** A trade-up row eligible for repricing. */
export interface RepriceRow {
  id: number;
  total_cost_cents: number;
  expected_value_cents: number;
  outcomes_json: string;
}

/** Outcome of repricing one trade-up: either a no-op freshness touch or a full update. */
export type RepriceDecision =
  | { kind: "touch"; id: number }
  | {
      kind: "update";
      id: number;
      expected_value_cents: number;
      profit_cents: number;
      roi_percentage: number;
      chance_to_profit: number;
      best_case_cents: number;
      worst_case_cents: number;
      outcomes_json: string;
    };

/** Injectable output-price lookup (production: lookupOutputPrice bound to a pool). */
export type OutputLookup = (skinName: string, predictedFloat: number) => Promise<OutputPriceResult>;

/** Retry / isolation knobs for a single reprice row. Tests pass backoffMs: 0. */
export interface RepriceRetryOpts {
  maxRetries?: number;
  backoffMs?: number;
}

export interface MapRepriceOpts extends RepriceRetryOpts {
  concurrency?: number;
}

/**
 * Pure repricing decision for a single trade-up. No DB writes, no shared state
 * beyond whatever `lookup` reads — so it is safe to run concurrently and is
 * deterministic over a fixed price cache. Mirrors the prior serial semantics
 * exactly: any unpriceable outcome → touch; EV moved ≤1% → touch; else update.
 */
export async function computeRepriceDecision(row: RepriceRow, lookup: OutputLookup): Promise<RepriceDecision> {
  const outcomes: TradeUpOutcome[] = JSON.parse(row.outcomes_json);
  if (outcomes.length === 0) return { kind: "touch", id: row.id };

  let newEv = 0;
  const newOutcomes: TradeUpOutcome[] = [];
  for (const o of outcomes) {
    const output = await lookup(o.skin_name, o.predicted_float);
    if (output.priceCents <= 0) return { kind: "touch", id: row.id };
    newEv += o.probability * output.priceCents;
    newOutcomes.push({ ...o, estimated_price_cents: output.priceCents, sell_marketplace: output.marketplace });
  }

  const newEvCents = Math.round(newEv);
  // Only persist a full update if EV moved >1% (preserves prior write guard).
  if (Math.abs(newEvCents - row.expected_value_cents) <= row.expected_value_cents * 0.01) {
    return { kind: "touch", id: row.id };
  }

  const cost = row.total_cost_cents;
  const profit = newEvCents - cost;
  const roi = cost > 0 ? Math.round((profit / cost) * 10000) / 100 : 0;
  const chance = computeChanceToProfit(newOutcomes, cost);
  const { bestCase, worstCase } = computeBestWorstCase(newOutcomes, cost);

  return {
    kind: "update",
    id: row.id,
    expected_value_cents: newEvCents,
    profit_cents: profit,
    roi_percentage: roi,
    chance_to_profit: chance,
    best_case_cents: bestCase,
    worst_case_cents: worstCase,
    outcomes_json: JSON.stringify(newOutcomes),
  };
}

/**
 * Reprice one row. Transient pool/connect failures are retried with backoff;
 * if they persist the item is failed as a freshness touch so the batch
 * advances and the daemon stays alive. Non-transient errors still throw.
 */
export async function repriceRowOrTouch(
  row: RepriceRow,
  lookup: OutputLookup,
  opts: RepriceRetryOpts = {},
): Promise<RepriceDecision> {
  const maxRetries = opts.maxRetries ?? 3;
  const backoffMs = opts.backoffMs ?? 1000;
  try {
    return await withRetry(
      () => computeRepriceDecision(row, lookup),
      maxRetries,
      `reprice ${row.id}`,
      backoffMs,
    );
  } catch (err) {
    if (isTransientDbError(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  reprice ${row.id}: ${msg} — failing item, continuing`);
      return { kind: "touch", id: row.id };
    }
    throw err;
  }
}

/**
 * Concurrent reprice with per-item isolation. One connect timeout cannot
 * reject the whole Promise.all the way `mapWithConcurrency` + raw
 * `computeRepriceDecision` used to (the live crash path).
 */
export async function mapRepriceDecisions(
  rows: RepriceRow[],
  lookup: OutputLookup,
  opts: MapRepriceOpts = {},
): Promise<RepriceDecision[]> {
  const concurrency = opts.concurrency ?? REPRICE_COMPUTE_CONCURRENCY;
  return mapWithConcurrency(rows, concurrency, (r) => repriceRowOrTouch(r, lookup, opts));
}

/**
 * Build a single coalesced UPDATE for a chunk of reprice updates, replacing N
 * per-row round-trips with one statement. Returns null for an empty chunk.
 */
export function buildBulkRepriceUpdate(
  updates: Extract<RepriceDecision, { kind: "update" }>[]
): { text: string; values: unknown[] } | null {
  if (updates.length === 0) return null;

  const values: unknown[] = [];
  const tuples: string[] = [];
  updates.forEach((u, i) => {
    const b = i * 8;
    // First tuple carries casts so Postgres infers the VALUES column types.
    const c = i === 0
      ? ["::int", "::int", "::int", "::double precision", "::double precision", "::int", "::int", "::text"]
      : ["", "", "", "", "", "", "", ""];
    tuples.push(
      `($${b + 1}${c[0]}, $${b + 2}${c[1]}, $${b + 3}${c[2]}, $${b + 4}${c[3]}, $${b + 5}${c[4]}, $${b + 6}${c[5]}, $${b + 7}${c[6]}, $${b + 8}${c[7]})`
    );
    values.push(
      u.id, u.expected_value_cents, u.profit_cents, u.roi_percentage,
      u.chance_to_profit, u.best_case_cents, u.worst_case_cents, u.outcomes_json
    );
  });

  const text = `
    UPDATE trade_ups AS t SET
      expected_value_cents = v.ev,
      profit_cents = v.profit,
      roi_percentage = v.roi,
      chance_to_profit = v.chance,
      best_case_cents = v.best,
      worst_case_cents = v.worst,
      outcomes_json = v.outcomes,
      output_repriced_at = NOW()
    FROM (VALUES ${tuples.join(", ")}) AS v(id, ev, profit, roi, chance, best, worst, outcomes)
    WHERE t.id = v.id
  `;

  return { text, values };
}

/** Run `fn` over `items` with at most `concurrency` in flight; results keep input order. */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * Batch re-evaluate output pricing for trade-ups using current price cache + KNN.
 * Picks the oldest-repriced active trade-ups, re-lookups each outcome's price
 * at its predicted float, and updates EV/profit/ROI if changed.
 *
 * Rows are fetched in chunks of `fetchChunkSize` so the main process never
 * holds `limit` outcomes_json payloads in memory at once (batch-start
 * MemAvailable sits near the 3-wide worker gate). Processed rows get
 * output_repriced_at = NOW() (update or touch), which removes them from the
 * eligibility predicate — so each re-query naturally continues where the
 * previous chunk left off, with no double-processing.
 *
 * Compute runs with bounded concurrency over read-only price caches; writes are
 * coalesced into bulk statements (one UPDATE per ~200 changed rows, one touch
 * UPDATE per ~2000 unchanged rows) instead of one round-trip per trade-up.
 */
export async function repriceTradeUpOutputs(
  pool: pg.Pool,
  limit: number = 500,
  fetchChunkSize: number = 10_000
): Promise<{ updated: number; checked: number; cacheMs: number; computeMs: number; writeMs: number }> {
  const tCache = Date.now();
  await buildPriceCache(pool);
  // Pre-warm lazily-built caches before concurrent repricing so every concurrent
  // worker reads a fully-built float-ceiling cache (matches the old serial path).
  await warmOutputPriceCaches(pool);
  const cacheMs = Date.now() - tCache;

  let updated = 0;
  let checked = 0;
  let computeMs = 0;
  let writeMs = 0;

  while (checked < limit) {
    const take = Math.min(fetchChunkSize, limit - checked);
    const { rows } = await pool.query(`
      SELECT id, type, total_cost_cents, expected_value_cents, outcomes_json, output_repriced_at
      FROM trade_ups
      WHERE is_theoretical = false AND listing_status = 'active'
        AND outcomes_json IS NOT NULL
        AND (output_repriced_at IS NULL OR output_repriced_at < NOW() - INTERVAL '2 hours')
      ORDER BY
        CASE WHEN profit_cents > 500 THEN 0 ELSE 1 END,
        output_repriced_at ASC NULLS FIRST
      LIMIT $1
    `, [take]);

    if (rows.length === 0) break;
    checked += rows.length;

    // Compute decisions with bounded concurrency. The price compute reads only
    // module-global caches (built above), so concurrent calls are lock-free and
    // deterministic; the only DB I/O on this path is vanilla-knife pricing.
    // Per-item isolation: a pool connect timeout fails that row, not the process.
    const tCompute = Date.now();
    const lookup: OutputLookup = (skinName, predictedFloat) => lookupOutputPrice(pool, skinName, predictedFloat);
    const decisions = await mapRepriceDecisions(
      rows.map((r: RepriceRow) => ({
        id: r.id,
        total_cost_cents: r.total_cost_cents,
        expected_value_cents: r.expected_value_cents,
        outcomes_json: r.outcomes_json,
      })),
      lookup,
      { concurrency: REPRICE_COMPUTE_CONCURRENCY },
    );
    computeMs += Date.now() - tCompute;

    // Coalesce writes: one bulk UPDATE per chunk of changed rows, one bulk touch
    // for the rest — replaces ~one round-trip per trade-up with a handful.
    const tWrite = Date.now();
    const updates = decisions.filter(
      (d): d is Extract<RepriceDecision, { kind: "update" }> => d.kind === "update"
    );
    const touchIds = decisions.filter(d => d.kind === "touch").map(d => d.id);

    const WRITE_CHUNK = 200;
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
      const sql = buildBulkRepriceUpdate(updates.slice(i, i + WRITE_CHUNK));
      if (!sql) continue;
      await withRetry(async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql.text, sql.values);
          await client.query("COMMIT");
          updated += Math.min(WRITE_CHUNK, updates.length - i);
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      }, 3, "reprice write");
    }

    const TOUCH_CHUNK = 2000;
    for (let i = 0; i < touchIds.length; i += TOUCH_CHUNK) {
      const ids = touchIds.slice(i, i + TOUCH_CHUNK);
      await withRetry(
        () => pool.query("UPDATE trade_ups SET output_repriced_at = NOW() WHERE id = ANY($1::int[])", [ids]),
        3,
        "reprice touch",
      );
    }
    writeMs += Date.now() - tWrite;

    // Short chunk = eligible pool exhausted; a full chunk may have more behind it.
    if (rows.length < take) break;
  }

  return { updated, checked, cacheMs, computeMs, writeMs };
}
