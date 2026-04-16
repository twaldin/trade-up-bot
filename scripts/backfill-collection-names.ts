#!/usr/bin/env tsx
/**
 * Backfill collection_names on trade_ups for all existing rows.
 *
 * Aggregates trade_up_inputs.collection_name per trade_up_id and writes the
 * resulting array to trade_ups.collection_names. Runs in batches to avoid
 * locking the table for a long time.
 *
 * Usage:
 *   npx tsx scripts/backfill-collection-names.ts
 *
 * Safe to re-run (only updates rows where collection_names = '{}').
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const BATCH_SIZE = 50_000;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/tradeupbot",
  max: 3,
});

async function main() {
  console.log("Backfilling collection_names on trade_ups...");

  // Count rows needing backfill
  const { rows: [{ count }] } = await pool.query(
    "SELECT COUNT(*) as count FROM trade_ups WHERE collection_names = '{}'"
  );
  const total = parseInt(count);
  console.log(`  ${total.toLocaleString()} rows to backfill`);

  if (total === 0) {
    console.log("  Nothing to do.");
    await pool.end();
    return;
  }

  let updated = 0;
  let batch = 0;
  const t0 = Date.now();

  while (true) {
    const t1 = Date.now();
    const { rowCount } = await pool.query(`
      WITH batch AS (
        SELECT id FROM trade_ups
        WHERE collection_names = '{}'
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      ),
      agg AS (
        SELECT tui.trade_up_id, array_agg(DISTINCT tui.collection_name ORDER BY tui.collection_name) AS names
        FROM trade_up_inputs tui
        WHERE tui.trade_up_id IN (SELECT id FROM batch)
        GROUP BY tui.trade_up_id
      )
      UPDATE trade_ups t
      SET collection_names = COALESCE(agg.names, '{}')
      FROM batch
      LEFT JOIN agg ON agg.trade_up_id = batch.id
      WHERE t.id = batch.id AND t.collection_names = '{}'
    `);

    if (!rowCount || rowCount === 0) break;

    updated += rowCount;
    batch++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const batchMs = Date.now() - t1;
    const pct = ((updated / total) * 100).toFixed(1);
    console.log(`  Batch ${batch}: +${rowCount.toLocaleString()} rows (${updated.toLocaleString()}/${total.toLocaleString()} = ${pct}%) — ${batchMs}ms batch, ${elapsed}s total`);

    if (rowCount < BATCH_SIZE) break;
  }

  console.log(`\nDone. Backfilled ${updated.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Verify
  const { rows: [{ remaining }] } = await pool.query(
    "SELECT COUNT(*) as remaining FROM trade_ups WHERE collection_names = '{}'"
  );
  console.log(`  Remaining empty rows: ${remaining}`);

  await pool.end();
}

main().catch(err => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
