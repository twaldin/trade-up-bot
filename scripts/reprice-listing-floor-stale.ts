// scripts/reprice-listing-floor-stale.ts
// One-time migration: null out output_repriced_at on active TUs priced before the
// listing-floor cap-bounds fix (GH #61) so the daemon reprices them on next cycle.
//
// Context: resolveOutputCapBounds() was dead code — listing floor fallback path ran
// uncapped when KNN was null and spMedian was absent. Stale collector-premium listings
// (e.g. Sawed-Off | Serenity BS at 3479¢ vs actual ~289¢) flowed through unguarded.
// Setting output_repriced_at = NULL enqueues all 349K affected TUs for Phase 4c repricing.
//
// Run on VPS: npx tsx scripts/reprice-listing-floor-stale.ts

import pg from "pg";

const { Pool } = pg;

const CUTOFF = "2026-03-28T18:39:00Z";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log(`Nulling output_repriced_at for active TUs repriced before ${CUTOFF}...`);

  const { rowCount } = await pool.query(`
    UPDATE trade_ups
    SET output_repriced_at = NULL
    WHERE listing_status = 'active'
      AND output_repriced_at < $1
  `, [CUTOFF]);

  console.log(`Done. ${rowCount ?? 0} trade-ups enqueued for repricing.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
