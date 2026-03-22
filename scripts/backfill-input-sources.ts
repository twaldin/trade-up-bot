// scripts/backfill-input-sources.ts
// One-time migration: populate input_sources for all existing trade-ups.
// Run on VPS: npx tsx scripts/backfill-input-sources.ts

import pg from "pg";
const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log("Backfilling input_sources on trade_ups...");

  // Batch to avoid locking the whole table
  const BATCH = 5000;
  let updated = 0;

  while (true) {
    const { rowCount } = await pool.query(`
      UPDATE trade_ups SET input_sources = COALESCE((
        SELECT ARRAY_AGG(DISTINCT source ORDER BY source)
        FROM trade_up_inputs WHERE trade_up_id = trade_ups.id
      ), '{}')
      WHERE id IN (
        SELECT id FROM trade_ups WHERE input_sources = '{}' LIMIT $1
      )
    `, [BATCH]);

    updated += rowCount ?? 0;
    console.log(`  Updated ${updated} trade-ups so far...`);
    if (!rowCount || rowCount < BATCH) break;
  }

  console.log(`Done. Total updated: ${updated}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
