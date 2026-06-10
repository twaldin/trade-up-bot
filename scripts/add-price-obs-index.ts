#!/usr/bin/env tsx
/**
 * Add idx_price_obs_skin_observed to price_observations for fast time-windowed queries.
 *
 * Supports: WHERE skin_name = $1 AND observed_at > NOW() - INTERVAL '30 days'
 * Used by: skin SEO handler (server/index.ts), KNN observation queries (server/sync/sales.ts)
 *
 * Uses CREATE INDEX CONCURRENTLY so it does NOT block reads/writes on the table
 * while building (safe to run on the live VPS). Run during a quiet window.
 *
 * Usage:
 *   npx tsx scripts/add-price-obs-index.ts
 *
 * Safe to re-run — IF NOT EXISTS makes it idempotent.
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

const connectionString =
  process.env.DATABASE_URL || "postgresql://localhost:5432/tradeupbot";

// CONCURRENTLY cannot run inside a transaction — use a plain client (not a transaction block)
const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();

  console.log("Adding idx_price_obs_skin_observed to price_observations...");
  console.log("  Using CREATE INDEX CONCURRENTLY — this may take a while on large tables.");
  console.log("  Reads and writes on price_observations will NOT be blocked.");

  // CONCURRENTLY must be outside any BEGIN/COMMIT block
  await client.query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_obs_skin_observed
     ON price_observations(skin_name, observed_at DESC)`
  );

  console.log("  Done.");

  // Verify the index exists
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'price_observations'
       AND indexname = 'idx_price_obs_skin_observed'`
  );

  if (rows.length === 0) {
    console.error("ERROR: index was not found after creation — check for errors above.");
    process.exitCode = 1;
  } else {
    console.log(`  Verified: ${rows[0].indexname} exists.`);
  }

  // Print EXPLAIN for the 30-day trend query to confirm index usage
  console.log("\nEXPLAIN for 30-day trend query:");
  const { rows: explainRows } = await client.query(
    `EXPLAIN
     SELECT float_value, price_cents, observed_at
     FROM price_observations
     WHERE skin_name = $1 AND observed_at > NOW() - INTERVAL '30 days'
     ORDER BY observed_at DESC`,
    ["AK-47 | Redline"]
  );
  for (const r of explainRows) {
    console.log(" ", r["QUERY PLAN"]);
  }

  await client.end();
}

main().catch(err => {
  console.error("Script failed:", err.message);
  client.end().catch(() => { /* ignore */ });
  process.exit(1);
});
