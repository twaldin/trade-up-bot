#!/usr/bin/env tsx
/**
 * Copy the top 1000 active trade-ups into trade_up_top_snapshots and drop
 * rows older than 14 days.
 *
 *   npx tsx scripts/snapshot-top-trade-ups.ts
 *
 * Daily schedule: scripts/trade-up-top-snapshot.cron
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyDotenv } from "./lib/dotenv-file.js";
import { runTopSnapshotJob } from "../server/top-snapshot.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) applyDotenv(readFileSync(envPath, "utf-8"));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/tradeupbot",
  max: 1,
});

try {
  const result = await runTopSnapshotJob(pool);
  console.log(`top snapshot inserted=${result.inserted} purged=${result.purged}`);
  if (result.gaveUp) {
    console.error("top snapshot gave up (statement_timeout or lock_timeout)");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
