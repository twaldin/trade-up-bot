// scripts/retroactive-reprice.ts
// One-time migration: reprice all stale trade-up outputs with current KNN cap (3x SP median),
// and deactivate trade-ups with overpriced inputs (>5x Skinport median).
//
// Context: PRs #34/#35 deployed fixes but left 351K active TUs with pre-fix output prices.
// Phase 4c reprices 20K/cycle at 30-min intervals (~8.75h for full coverage).
// This script processes all stale TUs immediately.
//
// Run on VPS: npx tsx scripts/retroactive-reprice.ts

import pg from "pg";
import { buildPriceCache, repriceTradeUpOutputs } from "../server/engine.js";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Step 1: Deactivate trade-ups with inputs priced >5x Skinport median.
  // PR #35 blocks new bad inputs from entering discovery, but existing TUs
  // (e.g. $15.37 listings on sub-$1 skins — 384x ratio) remain active on the site.
  console.log("Step 1: Deactivating TUs with inputs >5x Skinport median...");
  const { rowCount: deactivated } = await pool.query(`
    UPDATE trade_ups SET listing_status = 'inactive'
    WHERE listing_status = 'active'
      AND is_theoretical = false
      AND EXISTS (
        SELECT 1 FROM trade_up_inputs ti
        JOIN price_data pd ON pd.skin_name = ti.skin_name
          AND pd.condition = ti.condition
          AND pd.source = 'skinport'
        WHERE ti.trade_up_id = trade_ups.id
          AND pd.median_price_cents > 0
          AND ti.price_cents > pd.median_price_cents * 5
      )
  `);
  console.log(`  Deactivated ${deactivated ?? 0} TUs with overpriced inputs`);

  // Step 2: Reprice all stale active trade-up outputs using current KNN + price cache.
  // lookupOutputPrice now caps KNN at 3x Skinport median (via getListingFloor sanity cap),
  // so repricing with current logic corrects phantom-profit outputs.
  console.log("\nStep 2: Repricing stale trade-up outputs (batches of 20K)...");
  await buildPriceCache(pool, true);

  let totalChecked = 0;
  let totalUpdated = 0;
  const BATCH = 20000;

  while (true) {
    const result = await repriceTradeUpOutputs(pool, BATCH);
    totalChecked += result.checked;
    totalUpdated += result.updated;
    if (result.checked > 0) {
      console.log(`  Batch: repriced ${result.updated}/${result.checked} (running total: ${totalUpdated}/${totalChecked})`);
    }
    if (result.checked === 0) break;
  }

  console.log(`\nDone.`);
  console.log(`  Bad-input TUs deactivated: ${deactivated ?? 0}`);
  console.log(`  Output TUs repriced: ${totalUpdated}/${totalChecked}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
