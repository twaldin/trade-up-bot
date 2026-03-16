/**
 * Market snapshot system: captures periodic state of trade-ups for historical analysis.
 * Called by the daemon at the end of each cycle.
 */
import type Database from "better-sqlite3";

interface SnapshotOptions {
  cycle?: number;
  type?: string;
  topN?: number;
  apiRemaining?: { listing?: number; sale?: number; individual?: number };
}

export function takeSnapshot(db: Database.Database, opts: SnapshotOptions = {}): number {
  const type = opts.type ?? "covert_knife";
  const topN = opts.topN ?? 25;

  // Aggregate stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN profit_cents > 0 AND is_theoretical = 0 THEN 1 ELSE 0 END) as profitable,
      MAX(CASE WHEN is_theoretical = 0 THEN profit_cents END) as best_profit,
      AVG(CASE WHEN profit_cents > 0 AND is_theoretical = 0 THEN profit_cents END) as avg_profit,
      MAX(CASE WHEN is_theoretical = 0 THEN roi_percentage END) as best_roi,
      AVG(total_cost_cents) as avg_cost,
      AVG(chance_to_profit) as avg_chance,
      SUM(CASE WHEN is_theoretical = 1 THEN 1 ELSE 0 END) as theories,
      SUM(CASE WHEN is_theoretical = 1 AND profit_cents > 0 THEN 1 ELSE 0 END) as theory_profitable
    FROM trade_ups WHERE type = ?
  `).get(type) as {
    total: number; profitable: number; best_profit: number | null;
    avg_profit: number | null; best_roi: number | null; avg_cost: number | null;
    avg_chance: number | null; theories: number; theory_profitable: number;
  };

  // Coverage
  const coverage = db.prepare(`
    SELECT COUNT(DISTINCT s.name) as skins, COUNT(*) as listings
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE s.rarity = 'Covert' AND l.stattrak = 0
  `).get() as { skins: number; listings: number };

  // Near-misses & cooldowns
  const nearMiss = db.prepare("SELECT COUNT(*) as cnt, MIN(gap_cents) as closest FROM near_misses").get() as { cnt: number; closest: number | null };
  const cooldowns = db.prepare("SELECT COUNT(*) as cnt FROM theory_tracking WHERE cooldown_until > datetime('now')").get() as { cnt: number };

  // Insert snapshot
  const result = db.prepare(`
    INSERT INTO market_snapshots (
      cycle, type, total_tradeups, profitable_count,
      best_profit_cents, avg_profit_cents, best_roi,
      avg_cost_cents, avg_chance,
      coverage_skins, coverage_listings,
      theory_count, theory_profitable,
      near_miss_count, closest_gap_cents, cooldowns_active,
      api_listing_remaining, api_sale_remaining, api_individual_remaining
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.cycle ?? null,
    type,
    stats.total ?? 0,
    stats.profitable ?? 0,
    stats.best_profit ?? 0,
    Math.round(stats.avg_profit ?? 0),
    stats.best_roi ?? 0,
    Math.round(stats.avg_cost ?? 0),
    stats.avg_chance ?? 0,
    coverage.skins ?? 0,
    coverage.listings ?? 0,
    stats.theories ?? 0,
    stats.theory_profitable ?? 0,
    nearMiss.cnt ?? 0,
    nearMiss.closest ?? null,
    cooldowns.cnt ?? 0,
    opts.apiRemaining?.listing ?? null,
    opts.apiRemaining?.sale ?? null,
    opts.apiRemaining?.individual ?? null,
  );

  const snapshotId = Number(result.lastInsertRowid);

  // Capture top N trade-ups (by profit, real first, then theoretical)
  const topTradeUps = db.prepare(`
    SELECT id, profit_cents, roi_percentage, total_cost_cents,
           chance_to_profit, best_case_cents, worst_case_cents,
           is_theoretical, source, combo_key
    FROM trade_ups
    WHERE type = ?
    ORDER BY is_theoretical ASC, profit_cents DESC
    LIMIT ?
  `).all(type, topN) as {
    id: number; profit_cents: number; roi_percentage: number; total_cost_cents: number;
    chance_to_profit: number; best_case_cents: number; worst_case_cents: number;
    is_theoretical: number; source: string | null; combo_key: string | null;
  }[];

  const insertTop = db.prepare(`
    INSERT INTO snapshot_tradeups (
      snapshot_id, rank, trade_up_id, profit_cents, roi_percentage,
      total_cost_cents, chance_to_profit, best_case_cents, worst_case_cents,
      is_theoretical, source, combo_key, collections, input_skins, output_skins
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getInputs = db.prepare(`
    SELECT DISTINCT collection_name, skin_name, condition, price_cents
    FROM trade_up_inputs WHERE trade_up_id = ?
  `);
  const getOutcomesJson = db.prepare(`
    SELECT outcomes_json FROM trade_ups WHERE id = ?
  `);

  const insertMany = db.transaction(() => {
    for (let i = 0; i < topTradeUps.length; i++) {
      const t = topTradeUps[i];
      const inputs = getInputs.all(t.id) as { collection_name: string; skin_name: string; condition: string; price_cents: number }[];
      const outRow = getOutcomesJson.get(t.id) as { outcomes_json: string | null } | undefined;
      const outputs = (outRow?.outcomes_json ? JSON.parse(outRow.outcomes_json) : []) as { skin_name: string; predicted_condition: string; estimated_price_cents: number; probability: number }[];

      const collections = [...new Set(inputs.map(inp => inp.collection_name))].join(" + ");
      const inputSkins = inputs.map(inp =>
        `${inp.skin_name} ${inp.condition} $${(inp.price_cents / 100).toFixed(2)}`
      ).join("; ");
      const outputSkins = outputs.slice(0, 5).map(out =>
        `${out.skin_name} ${out.predicted_condition} $${(out.estimated_price_cents / 100).toFixed(2)} (${(out.probability * 100).toFixed(1)}%)`
      ).join("; ");

      insertTop.run(
        snapshotId, i + 1, t.id, t.profit_cents, t.roi_percentage,
        t.total_cost_cents, t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
        t.is_theoretical, t.source ?? null, t.combo_key ?? null,
        collections, inputSkins, outputSkins,
      );
    }
  });

  insertMany();
  return snapshotId;
}

/** Purge snapshots older than maxDays (default 30) */
export function purgeOldSnapshots(db: Database.Database, maxDays = 30) {
  db.prepare(`
    DELETE FROM snapshot_tradeups WHERE snapshot_id IN (
      SELECT id FROM market_snapshots
      WHERE julianday('now') - julianday(snapshot_at) > ?
    )
  `).run(maxDays);
  db.prepare("DELETE FROM market_snapshots WHERE julianday('now') - julianday(snapshot_at) > ?").run(maxDays);
}
