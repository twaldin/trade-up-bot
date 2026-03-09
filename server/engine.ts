import { initDb } from "./db.js";

// ─── Re-exports from engine submodules ──────────────────────────────────────
// All external consumers import from ./engine.js — never from submodules directly.

// Types
export type { DbListing, DbSkinOutcome, ListingWithCollection, AdjustedListing, PriceAnchor } from "./engine/types.js";
export type { CaseMapping, FinishData } from "./engine/knife-data.js";
export type { ProgressCallback } from "./engine/discovery.js";

// Constants
export { CASE_KNIFE_MAP } from "./engine/knife-data.js";

// Core math
export { calculateOutputFloat, calculateOutcomeProbabilities } from "./engine/core.js";

// Pricing
export { buildPriceCache } from "./engine/pricing.js";

// DB operations
export { saveTradeUps, saveKnifeTradeUps, updateCollectionScores } from "./engine/db-ops.js";

// Knife evaluation
export { getKnifeFinishesWithPrices, evaluateKnifeTradeUp } from "./engine/knife-evaluation.js";

// Classified→Covert discovery
export {
  findProfitableTradeUps, optimizeTradeUps, anchorSpikeExplore,
  deepOptimize, randomExplore, findFNTradeUps,
} from "./engine/discovery.js";

// Knife/Glove discovery
export { findProfitableKnifeTradeUps, randomKnifeExplore } from "./engine/knife-discovery.js";

// Tier 2 strategies
export {
  findTradeUpsForTargetOutputs, optimizeConditionBreakpoints,
  findStatTrakKnifeTradeUps, huntBudgetRange,
} from "./engine/strategies.js";

// ─── Standalone runner ──────────────────────────────────────────────────────

if (
  process.argv[1]?.endsWith("engine.ts") ||
  process.argv[1]?.endsWith("engine.js")
) {
  const { findProfitableTradeUps: find, optimizeTradeUps: optimize } = await import("./engine/discovery.js");
  const { saveTradeUps: save } = await import("./engine/db-ops.js");

  const db = initDb();
  console.log("Finding profitable trade-ups (float-targeted)...");
  const tradeUps = find(db, {
    limit: 200000,
    onProgress: (msg) => process.stdout.write(`\r  ${msg}                    `),
    onFlush: (currentResults, isFirst) => {
      save(db, currentResults, true);
      console.log(`\n  Flushed ${currentResults.length} trade-ups to DB`);
    },
  });
  console.log(`\nFound ${tradeUps.length} trade-ups`);

  if (tradeUps.length > 0) {
    save(db, tradeUps, true);
    console.log("Saved to database (final)");

    // Run optimization pass
    console.log("\nRunning optimization pass...");
    const optResult = optimize(db, {
      topN: 500,
      onProgress: (msg) => process.stdout.write(`\r  ${msg}                    `),
    });
    console.log(`\n  Optimization: ${optResult.improved}/${optResult.total} improved`);

    console.log("\n=== Top 5 Trade-Ups ===");
    for (const tu of tradeUps.slice(0, 5)) {
      console.log(
        `\nCost: $${(tu.total_cost_cents / 100).toFixed(2)} | ` +
          `EV: $${(tu.expected_value_cents / 100).toFixed(2)} | ` +
          `Profit: $${(tu.profit_cents / 100).toFixed(2)} | ` +
          `ROI: ${tu.roi_percentage.toFixed(1)}%`
      );
      console.log(`  Inputs: ${tu.inputs.map((i) => i.skin_name).join(", ")}`);
      console.log(
        `  Outcomes: ${tu.outcomes.map((o) => `${o.skin_name} (${(o.probability * 100).toFixed(1)}% @ $${(o.estimated_price_cents / 100).toFixed(2)})`).join(", ")}`
      );
    }
  }
}
