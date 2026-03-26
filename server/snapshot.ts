/**
 * Market snapshot system: captures periodic state of trade-ups for historical analysis.
 * Called by the daemon at the end of each cycle.
 */
import pg from "pg";

interface SnapshotOptions {
  cycle?: number;
  type?: string;
  topN?: number;
  apiRemaining?: { listing?: number; sale?: number; individual?: number };
}

export async function takeSnapshot(pool: pg.Pool, opts: SnapshotOptions = {}): Promise<number> {
  const type = opts.type ?? "covert_knife";
  const topN = opts.topN ?? 25;

  // Aggregate stats
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN profit_cents > 0 AND is_theoretical = false THEN 1 ELSE 0 END) as profitable,
      MAX(CASE WHEN is_theoretical = false THEN profit_cents END) as best_profit,
      AVG(CASE WHEN profit_cents > 0 AND is_theoretical = false THEN profit_cents END) as avg_profit,
      MAX(CASE WHEN is_theoretical = false THEN roi_percentage END) as best_roi,
      AVG(total_cost_cents) as avg_cost,
      AVG(chance_to_profit) as avg_chance,
      SUM(CASE WHEN is_theoretical THEN 1 ELSE 0 END) as theories,
      SUM(CASE WHEN is_theoretical AND profit_cents > 0 THEN 1 ELSE 0 END) as theory_profitable
    FROM trade_ups WHERE type = $1
  `, [type]);

  // Coverage
  const { rows: [coverage] } = await pool.query(`
    SELECT COUNT(DISTINCT s.name) as skins, COUNT(*) as listings
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE s.rarity = 'Covert' AND l.stattrak = false
  `);

  // Near-misses & cooldowns
  const { rows: [nearMiss] } = await pool.query("SELECT COUNT(*) as cnt, MIN(gap_cents) as closest FROM near_misses");
  const { rows: [cooldowns] } = await pool.query("SELECT COUNT(*) as cnt FROM theory_tracking WHERE cooldown_until > NOW()");

  // Insert snapshot
  const { rows: [insertedRow] } = await pool.query(`
    INSERT INTO market_snapshots (
      cycle, type, total_tradeups, profitable_count,
      best_profit_cents, avg_profit_cents, best_roi,
      avg_cost_cents, avg_chance,
      coverage_skins, coverage_listings,
      theory_count, theory_profitable,
      near_miss_count, closest_gap_cents, cooldowns_active,
      api_listing_remaining, api_sale_remaining, api_individual_remaining
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING id
  `, [
    opts.cycle ?? null,
    type,
    Number(stats.total) || 0,
    Number(stats.profitable) || 0,
    Number(stats.best_profit) || 0,
    Math.round(Number(stats.avg_profit) || 0),
    Number(stats.best_roi) || 0,
    Math.round(Number(stats.avg_cost) || 0),
    Number(stats.avg_chance) || 0,
    Number(coverage.skins) || 0,
    Number(coverage.listings) || 0,
    Number(stats.theories) || 0,
    Number(stats.theory_profitable) || 0,
    Number(nearMiss.cnt) || 0,
    nearMiss.closest ?? null,
    Number(cooldowns.cnt) || 0,
    opts.apiRemaining?.listing ?? null,
    opts.apiRemaining?.sale ?? null,
    opts.apiRemaining?.individual ?? null,
  ]);

  const snapshotId = insertedRow.id;

  // Capture top N trade-ups (by profit, real first, then theoretical)
  const { rows: topTradeUps } = await pool.query(`
    SELECT id, profit_cents, roi_percentage, total_cost_cents,
           chance_to_profit, best_case_cents, worst_case_cents,
           is_theoretical, source, combo_key
    FROM trade_ups
    WHERE type = $1
    ORDER BY is_theoretical ASC, profit_cents DESC
    LIMIT $2
  `, [type, topN]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < topTradeUps.length; i++) {
      const t = topTradeUps[i];
      const { rows: inputs } = await client.query(`
        SELECT DISTINCT collection_name, skin_name, condition, price_cents
        FROM trade_up_inputs WHERE trade_up_id = $1
      `, [t.id]);
      const { rows: outRows } = await client.query(`
        SELECT outcomes_json FROM trade_ups WHERE id = $1
      `, [t.id]);
      const outputs = (outRows[0]?.outcomes_json ? JSON.parse(outRows[0].outcomes_json) : []) as { skin_name: string; predicted_condition: string; estimated_price_cents: number; probability: number }[];

      const collections = [...new Set(inputs.map(inp => inp.collection_name))].join(" + ");
      const inputSkins = inputs.map(inp =>
        `${inp.skin_name} ${inp.condition} $${(inp.price_cents / 100).toFixed(2)}`
      ).join("; ");
      const outputSkins = outputs.slice(0, 5).map(out =>
        `${out.skin_name} ${out.predicted_condition} $${(out.estimated_price_cents / 100).toFixed(2)} (${(out.probability * 100).toFixed(1)}%)`
      ).join("; ");

      await client.query(`
        INSERT INTO snapshot_tradeups (
          snapshot_id, rank, trade_up_id, profit_cents, roi_percentage,
          total_cost_cents, chance_to_profit, best_case_cents, worst_case_cents,
          is_theoretical, source, combo_key, collections, input_skins, output_skins
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        snapshotId, i + 1, t.id, t.profit_cents, t.roi_percentage,
        t.total_cost_cents, t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
        t.is_theoretical, t.source ?? null, t.combo_key ?? null,
        collections, inputSkins, outputSkins,
      ]);
    }
    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  return snapshotId;
}

/** Purge snapshots older than maxDays (default 30).
 *  snapshot_tradeups has ON DELETE CASCADE, so only the parent delete is needed. */
export async function purgeOldSnapshots(pool: pg.Pool, maxDays = 30) {
  await pool.query(
    "DELETE FROM market_snapshots WHERE EXTRACT(EPOCH FROM NOW() - snapshot_at) / 86400.0 > $1",
    [maxDays]
  );
}
