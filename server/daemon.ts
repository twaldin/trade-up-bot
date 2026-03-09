/**
 * Trade-Up Bot Daemon — Parallel Covert→Knife + Classified→Covert.
 *
 * Strategy:
 *   Phase 0: Purge stale listings
 *   Phase 1a: Knife/Glove sale history — output pricing (~30 calls, maintenance)
 *   Phase 1b: Covert gun sale history — output pricing for BOTH types (~120 calls)
 *   Phase 1c: Classified sale history — input pricing (~60 calls)
 *   Phase 1d: Covert output listings — pricing + knife inputs (~30 calls)
 *   Phase 2: Prioritized knife input fetch — sparse collections (~60 calls)
 *   Phase 3: Discovery Sweep — Broad Covert listing fetch (~8 calls)
 *   Phase 4: Smart per-skin Classified fetch — zero waste (~140 calls, PRIORITY)
 *            High-value collections → under-covered → FN gaps → stale refresh
 *            Skips skins fetched <6h ago, per-skin targeting (no bulk sweeps)
 *   Phase 6: Classified→Covert deterministic calculation
 *   Phase 7: Knife trade-up calculation (deterministic)
 *   Phase 8: Reverse lookup — target expensive outputs, find cheapest inputs
 *   Phase 9: StatTrak knife search — exploit knife-only guarantee
 *   Continuous: Interleaved knife + classified→covert optimization
 *
 *   Budget split: ~128 knife / ~320 classified (was ~396/~18)
 *
 * API budget is allocated smartly: collections with expensive outputs
 * but sparse listings get priority. Both trade-up types run in parallel.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, setSyncMeta } from "./db.js";
import {
  syncListingsForRarity,
  syncListingsByPriceRanges,
  syncListingsForSkin,
  getSkinsNeedingCoverage,
  syncSkinportPrices,
  syncSaleHistory,
  syncClassifiedSaleHistory,
  syncLowFloatClassifiedListings,
  syncSmartClassifiedListings,
  purgeStaleListings,
  syncCovertOutputListings,
  verifyTopTradeUpListings,
  syncPrioritizedKnifeInputs,
  syncKnifeGloveSaleHistory,
  fetchCSFloatListings,
} from "./sync.js";
import {
  findProfitableTradeUps, saveTradeUps, updateCollectionScores,
  optimizeTradeUps, anchorSpikeExplore, deepOptimize, randomExplore, findFNTradeUps,
  findProfitableKnifeTradeUps, saveKnifeTradeUps, randomKnifeExplore,
  findTradeUpsForTargetOutputs, optimizeConditionBreakpoints, findStatTrakKnifeTradeUps,
  huntBudgetRange, buildPriceCache,
} from "./engine.js";

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const apiKey = process.env.CSFLOAT_API_KEY;
if (!apiKey) {
  console.error("Missing CSFLOAT_API_KEY in .env");
  process.exit(1);
}

const db = initDb();

// ─── API Budget Tracker ──────────────────────────────────────────────────────

const API_BUDGET = 450; // Conservative buffer from 500 limit

class BudgetTracker {
  private used = 0;

  use(count: number = 1) { this.used += count; }
  get remaining() { return API_BUDGET - this.used; }
  get usedCount() { return this.used; }
  hasBudget(needed: number = 1) { return this.remaining >= needed; }
  reset() { this.used = 0; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function setDaemonStatus(phase: string, detail: string = "") {
  const status = JSON.stringify({
    phase,
    detail,
    timestamp: new Date().toISOString(),
  });
  try { setSyncMeta(db, "daemon_status", status); } catch {}
}

// Track exploration stats for the frontend
let explorationStats = {
  cycle: 0,
  passes_this_cycle: 0,
  total_passes: 0,
  last_strategy: "",
  new_tradeups_found: 0,
  tradeups_improved: 0,
  started_at: new Date().toISOString(),
};

function updateExplorationStats(update: Partial<typeof explorationStats>) {
  Object.assign(explorationStats, update);
  try {
    setSyncMeta(db, "exploration_stats", JSON.stringify(explorationStats));
  } catch {}
}

interface CollectionScore {
  collection_id: string;
  collection_name: string;
  priority_score: number;
  profitable_count: number;
  avg_profit_cents: number;
  total_tradeups: number;
}

function getCollectionScores(): CollectionScore[] {
  return db.prepare(`
    SELECT collection_id, collection_name, priority_score, profitable_count, avg_profit_cents, total_tradeups
    FROM collection_scores
    ORDER BY priority_score DESC
  `).all() as CollectionScore[];
}

interface SkinInfo {
  id: string;
  name: string;
  min_float: number;
  max_float: number;
  collection_id: string;
  listing_count: number;
}

function getClassifiedSkinsForCollection(collectionId: string): SkinInfo[] {
  return db.prepare(`
    SELECT s.id, s.name, s.min_float, s.max_float, sc.collection_id,
      COUNT(l.id) as listing_count
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
      AND sc.collection_id = ?
    GROUP BY s.id
    ORDER BY listing_count ASC
  `).all(collectionId) as SkinInfo[];
}

// ─── Phase 1: Sale History (Knife/Glove + Covert Gun) ───────────────────────

async function phase1SaleHistory(budget: BudgetTracker) {
  // Phase 1a: Knife/Glove output sale history (highest priority — improves output pricing)
  console.log(`\n[${timestamp()}] ── Phase 1a: Knife/Glove sale history ──`);
  setDaemonStatus("fetching", "Phase 1a: Knife/Glove output sale prices");

  const knifeBudget = Math.min(budget.remaining, 30);
  if (knifeBudget >= 5) {
    try {
      const result = await syncKnifeGloveSaleHistory(db, {
        apiKey: apiKey!,
        maxCalls: knifeBudget,
        onProgress: (msg) => setDaemonStatus("fetching", msg),
      });
      budget.use(result.fetched);
      console.log(`  → ${result.fetched} fetched, ${result.sales} sales, ${result.pricesUpdated} prices (budget: ${budget.remaining} left)`);
    } catch (err: any) {
      console.error(`  → Error: ${err.message}`);
    }
  }

  // Phase 1b: Covert gun skin sale history (knife input pricing)
  console.log(`\n[${timestamp()}] ── Phase 1b: Covert gun sale history ──`);
  setDaemonStatus("fetching", "Phase 1b: Covert gun sale prices");

  const covertBudget = Math.min(budget.remaining, 120);
  if (covertBudget >= 10) {
    try {
      const result = await syncSaleHistory(db, {
        apiKey: apiKey!,
        maxCalls: covertBudget,
        onProgress: (msg) => setDaemonStatus("fetching", msg),
      });
      budget.use(result.fetched);
      console.log(`  → ${result.fetched} fetched, ${result.sales} sales, ${result.pricesUpdated} prices (budget: ${budget.remaining} left)`);
    } catch (err: any) {
      console.error(`  → Error: ${err.message}`);
    }
  }

  // Phase 1c: Classified skin sale history (classified→covert input pricing — ZERO coverage)
  console.log(`\n[${timestamp()}] ── Phase 1c: Classified sale history ──`);
  setDaemonStatus("fetching", "Phase 1c: Classified input sale prices");

  const classifiedBudget = Math.min(budget.remaining, 60);
  if (classifiedBudget >= 5) {
    try {
      const result = await syncClassifiedSaleHistory(db, {
        apiKey: apiKey!,
        maxCalls: classifiedBudget,
        onProgress: (msg) => setDaemonStatus("fetching", msg),
      });
      budget.use(result.fetched);
      console.log(`  → ${result.fetched} fetched, ${result.sales} sales, ${result.pricesUpdated} prices (budget: ${budget.remaining} left)`);
    } catch (err: any) {
      console.error(`  → Error: ${err.message}`);
    }
  }
}

// ─── Phase 1b: Covert Output Listings ────────────────────────────────────────

async function phase1bCovertOutputs(budget: BudgetTracker) {
  console.log(`\n[${timestamp()}] ── Phase 1d: Covert output listings (for pricing) ──`);
  setDaemonStatus("fetching", "Phase 1d: Covert output listings");

  const maxCalls = Math.min(budget.remaining, 30);
  if (maxCalls < 5) {
    console.log("  Skipping — insufficient budget");
    return;
  }

  try {
    const result = await syncCovertOutputListings(db, {
      apiKey: apiKey!,
      maxCalls,
      onProgress: (msg) => setDaemonStatus("fetching", msg),
    });
    budget.use(result.apiCalls);
    console.log(`  → ${result.apiCalls} calls, ${result.inserted} listings (budget: ${budget.remaining} left)`);
  } catch (err: any) {
    console.error(`  → Error: ${err.message}`);
  }
}

// ─── Phase 2: Prioritized Knife Input Fetch ─────────────────────────────────

async function phase2PrioritizedInputs(budget: BudgetTracker) {
  console.log(`\n[${timestamp()}] ── Phase 2: Prioritized knife input fetch ──`);
  setDaemonStatus("fetching", "Phase 2: Prioritized knife inputs (sparse high-value collections)");

  const maxCalls = Math.min(budget.remaining, 60);
  if (maxCalls < 10) {
    console.log("  Skipping — insufficient budget");
    return;
  }

  try {
    const result = await syncPrioritizedKnifeInputs(db, {
      apiKey: apiKey!,
      maxCalls,
      onProgress: (msg) => setDaemonStatus("fetching", msg),
    });
    budget.use(result.apiCalls);
    console.log(`  → ${result.apiCalls} calls, ${result.inserted} listings, ${result.collectionsServed} collections (budget: ${budget.remaining} left)`);
  } catch (err: any) {
    console.error(`  → Error: ${err.message}`);
  }
}

function getValidConditions(minFloat: number, maxFloat: number): string[] {
  const conditions = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];
  return conditions.filter(c => minFloat < c.max && maxFloat > c.min).map(c => c.name);
}

// ─── Phase 3: Broad Discovery Sweep ─────────────────────────────────────────

async function phase3DiscoverySweep(budget: BudgetTracker) {
  console.log(`\n[${timestamp()}] ── Phase 3: Covert listing discovery sweep (knife inputs) ──`);
  setDaemonStatus("fetching", "Phase 3: Covert listing sweep");

  // Covert sweeps — these are the inputs for knife/glove trade-ups (maintenance level)
  const covertJobs = [
    { sortBy: "lowest_price", pages: 4 },
    { sortBy: "most_recent", pages: 4 },
  ];

  for (const job of covertJobs) {
    if (!budget.hasBudget(job.pages)) {
      console.log(`  Skipping ${job.sortBy} — ${budget.remaining} API calls left`);
      continue;
    }

    console.log(`  Covert (${job.sortBy}, ${job.pages}p)...`);
    try {
      const count = await syncListingsForRarity(db, "Covert", {
        pages: job.pages,
        apiKey,
        sortBy: job.sortBy,
      });
      budget.use(job.pages);
      console.log(`    → ${count} listings (budget: ${budget.remaining} left)`);
    } catch (err: any) {
      console.error(`    → Error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ─── Phase 4: Smart Classified Fetch (PRIORITY — zero waste) ─────────────────

async function phase4SmartClassifiedFetch(budget: BudgetTracker) {
  console.log(`\n[${timestamp()}] ── Phase 4: Smart per-skin classified fetch ──`);
  setDaemonStatus("fetching", "Phase 4: Smart classified fetch (per-skin targeting)");

  const maxCalls = Math.min(budget.remaining, 140);
  if (maxCalls < 5) {
    console.log(`  Skipping — only ${budget.remaining} budget left`);
    return;
  }

  try {
    const result = await syncSmartClassifiedListings(db, {
      apiKey: apiKey!,
      maxCalls,
      onProgress: (msg) => setDaemonStatus("fetching", msg),
    });
    budget.use(result.apiCalls);
    console.log(`  → ${result.skinsFetched} skins, ${result.apiCalls} calls, ${result.inserted} listings, ${result.skipped} skipped (budget: ${budget.remaining} left)`);
  } catch (err: any) {
    console.error(`  → Error: ${err.message}`);
  }
}

// ─── Phase 6: Calculate ─────────────────────────────────────────────────────

async function phase6Calculate() {
  console.log(`\n[${timestamp()}] ── Phase 6: Calculating Classified→Covert trade-ups ──`);
  setDaemonStatus("calculating", "Finding profitable classified→covert trade-ups...");

  try {
    const tradeUps = findProfitableTradeUps(db, {
      limit: 100000,
      maxPerSignature: 25,
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus("calculating", msg);
      },
      onFlush: (currentResults, isFirst) => {
        // clearFirst on first flush only, subsequent flushes append
        saveTradeUps(db, currentResults, isFirst, "classified_covert");
        console.log(`\n  Flushed ${currentResults.length} classified→covert trade-ups${isFirst ? " (initial)" : " (updated)"}`);
        setDaemonStatus("calculating", `${currentResults.length} classified→covert so far...`);
      },
    });
    console.log("");
    saveTradeUps(db, tradeUps, true, "classified_covert");
    console.log(`  Saved ${tradeUps.length} classified→covert trade-ups (final)`);

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  ${profitable.length} profitable out of ${tradeUps.length}`);

    if (profitable.length > 0) {
      console.log("\n  Top classified→covert trade-ups:");
      for (const tu of profitable.slice(0, 5)) {
        const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
        console.log(`    Profit: $${(tu.profit_cents / 100).toFixed(2)} (${tu.roi_percentage.toFixed(0)}% ROI) | Cost: $${(tu.total_cost_cents / 100).toFixed(2)} | ${tu.outcomes.length} outcomes`);
        console.log(`      Inputs: ${inputNames}`);
      }
    }

    // Update collection profitability scores
    console.log("  Scoring collections...");
    updateCollectionScores(db);

    setDaemonStatus("idle", `${profitable.length} profitable classified→covert trade-ups`);
  } catch (err: any) {
    console.error(`  Classified→Covert calculation error: ${err.message}`);
    setDaemonStatus("error", err.message);
  }
}

// ─── Phase 6b: FN-Targeted Classified→Covert Discovery ──────────────────────

async function phase6bFNDiscovery() {
  console.log(`\n[${timestamp()}] ── Phase 6b: Condition-targeted classified→covert discovery ──`);
  setDaemonStatus("calculating", "Condition-targeted discovery (FN/MW/FT breakpoints)...");

  try {
    const results = findFNTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus("calculating", msg);
      },
    });
    console.log("");

    if (results.length > 0) {
      saveTradeUps(db, results, true, "classified_covert_fn");

      const profitable = results.filter(t => t.profit_cents > 0);
      const fnOutputs = results.filter(t => t.outcomes.some(o => o.predicted_condition === "Factory New"));
      const mwOutputs = results.filter(t => t.outcomes.some(o => o.predicted_condition === "Minimal Wear"));
      console.log(`  Saved ${results.length} condition-targeted trade-ups (${profitable.length} profitable, ${fnOutputs.length} FN / ${mwOutputs.length} MW)`);

      // Show top 3 by upside ratio
      const withUpside = results
        .map(tu => {
          const bestOut = tu.outcomes.reduce((best, o) => o.estimated_price_cents > best.estimated_price_cents ? o : best);
          return { tu, bestOut, upside: bestOut.estimated_price_cents - tu.total_cost_cents };
        })
        .filter(r => r.upside > 0)
        .sort((a, b) => (b.upside / b.tu.total_cost_cents) - (a.upside / a.tu.total_cost_cents));

      for (const r of withUpside.slice(0, 3)) {
        console.log(`    ${r.bestOut.skin_name} ${r.bestOut.predicted_condition} $${(r.bestOut.estimated_price_cents / 100).toFixed(0)} (${(r.bestOut.probability * 100).toFixed(0)}%) on $${(r.tu.total_cost_cents / 100).toFixed(0)} cost`);
      }
    }

    setDaemonStatus("idle", `${results.length} condition-targeted trade-ups`);
  } catch (err: any) {
    console.error(`  Condition-targeted discovery error: ${err.message}`);
    setDaemonStatus("error", err.message);
  }
}

// ─── Phase 7: Knife Trade-Up Calculation ────────────────────────────────────

async function phase7KnifeTradeUps() {
  console.log(`\n[${timestamp()}] ── Phase 7: Calculating Covert→Knife trade-ups ──`);
  setDaemonStatus("calculating", "Finding profitable knife trade-ups...");

  try {
    const tradeUps = findProfitableKnifeTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus("calculating", msg);
      },
    });
    console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} knife trade-ups (${profitable.length} profitable)`);

    if (tradeUps.length > 0) {
      saveKnifeTradeUps(db, tradeUps);
      console.log(`  Saved ${tradeUps.length} knife trade-ups to DB`);

      if (profitable.length > 0) {
        console.log("\n  Top knife trade-ups:");
        for (const tu of profitable.slice(0, 5)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    Profit: $${(tu.profit_cents / 100).toFixed(2)} (${tu.roi_percentage.toFixed(0)}% ROI) | Cost: $${(tu.total_cost_cents / 100).toFixed(2)} | ${tu.outcomes.length} outcomes`);
          console.log(`      Inputs: ${inputNames}`);
        }
      }
    }

    setDaemonStatus("idle", `${profitable.length} profitable knife trade-ups`);
  } catch (err: any) {
    console.error(`  Knife calculation error: ${err.message}`);
    setDaemonStatus("error", err.message);
  }
}

// ─── Phase 8: Reverse Lookup (Target Expensive Outputs) ─────────────────────

async function phase8ReverseLookup() {
  console.log(`\n[${timestamp()}] ── Phase 8: Reverse lookup (target expensive outputs) ──`);
  setDaemonStatus("calculating", "Reverse lookup: targeting expensive knife/glove outputs...");

  try {
    const tradeUps = findTradeUpsForTargetOutputs(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus("calculating", msg);
      },
    });
    console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Reverse lookup: ${tradeUps.length} evaluated, ${profitable.length} profitable`);

    if (profitable.length > 0) {
      saveTradeUps(db, profitable, false, "covert_knife");
      console.log(`  Saved ${profitable.length} reverse-lookup trade-ups (appended)`);
    }
  } catch (err: any) {
    console.error(`  Reverse lookup error: ${err.message}`);
  }
}

// ─── Phase 9: StatTrak Knife Search ─────────────────────────────────────────

async function phase9StatTrakSearch() {
  console.log(`\n[${timestamp()}] ── Phase 9: StatTrak knife search (knife-only guarantee) ──`);
  setDaemonStatus("calculating", "StatTrak search: knife-only pool (no gloves)...");

  try {
    const tradeUps = findStatTrakKnifeTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus("calculating", msg);
      },
    });
    console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  StatTrak search: ${tradeUps.length} evaluated, ${profitable.length} profitable`);

    if (profitable.length > 0) {
      saveTradeUps(db, profitable, false, "covert_knife");
      console.log(`  Saved ${profitable.length} StatTrak trade-ups (appended)`);
    }
  } catch (err: any) {
    console.error(`  StatTrak search error: ${err.message}`);
  }
}

// ─── Price Refresh ───────────────────────────────────────────────────────────

async function refreshPrices() {
  console.log(`\n[${timestamp()}] ── Refreshing Skinport prices ──`);
  setDaemonStatus("fetching", "Refreshing Skinport prices...");
  try {
    await syncSkinportPrices(db);
  } catch (err: any) {
    console.error(`  Skinport refresh error: ${err.message}`);
  }
}

// ─── Coverage Report ─────────────────────────────────────────────────────────

function printCoverageReport() {
  const classifiedCoverage = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) as total_skins,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN s.id END) as with_listings,
      COUNT(l.id) as total_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
  `).get() as { total_skins: number; with_listings: number; total_listings: number };

  const covertCoverage = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) as total_skins,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN s.id END) as with_listings,
      COUNT(l.id) as total_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0
  `).get() as { total_skins: number; with_listings: number; total_listings: number };

  const salePrices = db.prepare(
    "SELECT COUNT(*) as cnt FROM price_data WHERE source = 'csfloat_sales'"
  ).get() as { cnt: number };

  const classifiedSalePrices = db.prepare(`
    SELECT COUNT(DISTINCT pd.skin_name || ':' || pd.condition) as cnt
    FROM price_data pd
    JOIN skins s ON pd.skin_name = s.name
    WHERE pd.source = 'csfloat_sales' AND s.rarity = 'Classified'
  `).get() as { cnt: number };

  const refPrices = db.prepare(
    "SELECT COUNT(*) as cnt FROM price_data WHERE source = 'csfloat_ref'"
  ).get() as { cnt: number };

  const tradeUpCounts = db.prepare(`
    SELECT COALESCE(type, 'unknown') as type, COUNT(*) as cnt,
           SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
    FROM trade_ups GROUP BY type
  `).all() as { type: string; cnt: number; profitable: number }[];

  console.log(`\n[${timestamp()}] === Coverage Report ===`);
  console.log(`  Classified inputs: ${classifiedCoverage.with_listings}/${classifiedCoverage.total_skins} skins (${classifiedCoverage.total_listings} listings)`);
  console.log(`  Covert inputs: ${covertCoverage.with_listings}/${covertCoverage.total_skins} skins (${covertCoverage.total_listings} listings)`);
  console.log(`  Output prices: ${salePrices.cnt} sale-based + ${refPrices.cnt} reference (${classifiedSalePrices.cnt} classified)`);
  for (const tc of tradeUpCounts) {
    console.log(`  ${tc.type}: ${tc.cnt} total, ${tc.profitable} profitable`);
  }
}

// ─── Continuous Optimization ─────────────────────────────────────────────────

/**
 * Runs exploration and optimization strategies back-to-back during API cooldown.
 * No idle time — uses 100% of downtime for computation.
 *
 * Strategy rotation (8 strategies, interleaved knife + classified→covert):
 * 0: Random knife exploration
 * 1: Full knife recalculation
 * 2: Classified→Covert random exploration (FN/MW/FT targeting)
 * 3: Condition breakpoint optimizer (knife)
 * 4: Budget hunt $150-350 (knife)
 * 5: Random knife exploration (different combos)
 * 6: Classified→Covert full recalculation
 * 7: Reverse lookup + StatTrak (knife)
 */
async function continuousOptimization(durationMs: number) {
  const endTime = Date.now() + durationMs;
  let pass = 0;

  console.log(`\n[${timestamp()}] Starting continuous optimization — knife + classified→covert (${Math.round(durationMs / 60000)} min)`);
  updateExplorationStats({ passes_this_cycle: 0 });

  while (Date.now() < endTime) {
    pass++;
    const timeLeft = Math.round((endTime - Date.now()) / 60000);
    const strategy = pass % 9;

    try {
      if (strategy === 1) {
        // Full deterministic knife recalculation
        console.log(`\n[${timestamp()}] Pass ${pass}: Full knife recalc (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Knife full recalc", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        await phase7KnifeTradeUps();
      } else if (strategy === 2) {
        // Classified→Covert random exploration
        console.log(`\n[${timestamp()}] Pass ${pass}: Classified→Covert explore (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Classified→Covert explore", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        setDaemonStatus("calculating", `Classified→Covert explore (${timeLeft} min left)`);

        const result = randomExplore(db, {
          iterations: 2000,
          onProgress: (msg) => setDaemonStatus("calculating", msg),
        });

        if (result.found > 0) {
          console.log(`  → +${result.found} new classified→covert (${result.explored} explored)`);
          updateExplorationStats({
            new_tradeups_found: explorationStats.new_tradeups_found + result.found,
          });
        } else {
          console.log(`  → No new classified→covert finds (${result.explored} explored)`);
        }
      } else if (strategy === 3) {
        // Condition breakpoint optimization — push outputs across FN/MW boundaries
        console.log(`\n[${timestamp()}] Pass ${pass}: Condition breakpoint optimizer (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Breakpoint optimizer", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        setDaemonStatus("calculating", `Breakpoint optimizer (${timeLeft} min left)`);

        const result = optimizeConditionBreakpoints(db, {
          onProgress: (msg) => setDaemonStatus("calculating", msg),
        });

        if (result.improved > 0) {
          console.log(`  → ${result.improved} improved out of ${result.checked} checked`);
          updateExplorationStats({
            tradeups_improved: explorationStats.tradeups_improved + result.improved,
          });
        } else {
          console.log(`  → No improvements (${result.checked} checked)`);
        }
      } else if (strategy === 4) {
        // Budget hunt — specifically target $150-350 range trade-ups
        console.log(`\n[${timestamp()}] Pass ${pass}: Budget hunt $150-350 (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Budget hunt $150-350", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        setDaemonStatus("calculating", `Budget hunt $150-350 (${timeLeft} min left)`);

        const result = huntBudgetRange(db, {
          minCostCents: 15000,
          maxCostCents: 35000,
          iterations: 5000,
          onProgress: (msg) => setDaemonStatus("calculating", msg),
        });

        if (result.found > 0) {
          console.log(`  → +${result.found} new in budget range (${result.explored} explored)`);
          updateExplorationStats({
            new_tradeups_found: explorationStats.new_tradeups_found + result.found,
          });
        } else {
          console.log(`  → No new finds in budget (${result.explored} explored)`);
        }
      } else if (strategy === 6) {
        // Full classified→covert recalculation
        console.log(`\n[${timestamp()}] Pass ${pass}: Full classified→covert recalc (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Classified→Covert full recalc", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        await phase6Calculate();
      } else if (strategy === 7) {
        // Reverse lookup + StatTrak — target expensive outputs
        console.log(`\n[${timestamp()}] Pass ${pass}: Reverse lookup + StatTrak (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Reverse + StatTrak", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        await phase8ReverseLookup();
        await phase9StatTrakSearch();
      } else if (strategy === 8) {
        // Condition-targeted classified→covert discovery (FN/MW/FT breakpoints)
        console.log(`\n[${timestamp()}] Pass ${pass}: Condition-targeted discovery (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Condition-targeted discovery", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        await phase6bFNDiscovery();
      } else {
        // Random knife exploration — discovers new profitable combos (strategies 0, 5)
        console.log(`\n[${timestamp()}] Pass ${pass}: Random knife explore (${timeLeft} min left)`);
        updateExplorationStats({ last_strategy: "Knife random explore", passes_this_cycle: pass, total_passes: explorationStats.total_passes + 1 });
        setDaemonStatus("calculating", `Knife explore pass ${pass} (${timeLeft} min left)`);

        const result = randomKnifeExplore(db, {
          iterations: 2000,
          onProgress: (msg) => {
            setDaemonStatus("calculating", msg);
          },
        });

        if (result.found > 0 || result.improved > 0) {
          console.log(`  → +${result.found} new, ${result.improved} improved (${result.explored} tried)`);
          updateExplorationStats({
            new_tradeups_found: explorationStats.new_tradeups_found + result.found,
            tradeups_improved: explorationStats.tradeups_improved + result.improved,
          });
        } else {
          console.log(`  → No new finds (${result.explored} tried)`);
        }
      }
    } catch (err: any) {
      console.error(`  Pass ${pass} error: ${err.message}`);
    }
  }

  setDaemonStatus("waiting", `Starting next fetch cycle`);
  console.log(`\n[${timestamp()}] Continuous optimization done (${pass} passes)`);
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${timestamp()}] Trade-Up Bot Daemon started`);
  console.log(`  Mode: Parallel Covert→Knife + Classified→Covert`);
  console.log(`  API budget: ${API_BUDGET} calls per cycle`);
  console.log(`  Strategy: Sale History → Inputs → Sweep → Calc (both types) → Optimize\n`);

  // Initial stats
  printCoverageReport();

  let cycleCount = 0;

  while (true) {
    cycleCount++;
    const budget = new BudgetTracker();
    updateExplorationStats({
      cycle: cycleCount,
      passes_this_cycle: 0,
      new_tradeups_found: 0,
      tradeups_improved: 0,
      started_at: new Date().toISOString(),
    });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${timestamp()}] Cycle ${cycleCount} — Budget: ${budget.remaining}`);
    console.log("=".repeat(60));

    // Phase 0: Purge stale listings (>14 days old, likely sold)
    console.log(`\n[${timestamp()}] ── Phase 0: Purge stale listings ──`);
    const purged = purgeStaleListings(db, 14);
    if (purged.deleted > 0) {
      console.log(`  Deleted ${purged.deleted} stale listings (>14 days old)`);
    }

    // Rate limit probe: test a single API call before wasting time on fetch phases
    let apiAvailable = true;
    try {
      await fetchCSFloatListings({
        skinName: "AK-47 | Redline (Field-Tested)",
        sortBy: "lowest_price",
        limit: 1,
        apiKey: apiKey!,
      });
      budget.use(1);
      console.log(`\n[${timestamp()}] API probe: OK (rate limit clear)`);
    } catch (err: any) {
      if (err.message?.includes("429")) {
        apiAvailable = false;
        console.log(`\n[${timestamp()}] API probe: Rate limited — skipping fetch phases`);
      }
    }

    if (apiAvailable) {
      // Phase 1: Sale history (knife/glove outputs + covert gun inputs)
      await phase1SaleHistory(budget);

      // Phase 1b: Covert output listings — pricing + knife trade-up inputs
      await phase1bCovertOutputs(budget);

      // Phase 2: Prioritized knife input fetch (sparse high-value collections first)
      await phase2PrioritizedInputs(budget);

      // Phase 3: Broad Covert listing sweep (knife/glove inputs, maintenance)
      await phase3DiscoverySweep(budget);

      // Phase 4: Smart per-skin classified fetch (replaces old bulk sweeps + targeted fill)
      // Prioritizes: high-value collections > under-covered skins > FN gaps > stale refresh
      // Skips skins fetched <6h ago. Zero waste — every call discovers new data.
      await phase4SmartClassifiedFetch(budget);

      // Force price cache rebuild after fetching new data
      buildPriceCache(db, true);
    }

    // Coverage report
    printCoverageReport();
    console.log(`  API calls used: ${budget.usedCount}/${API_BUDGET}`);

    // Phase 6: Classified→Covert deterministic calculation
    await phase6Calculate();

    // Phase 6b: FN/condition-targeted classified→covert discovery
    await phase6bFNDiscovery();

    // Phase 7: Deterministic knife trade-up calculation
    await phase7KnifeTradeUps();

    // Phase 8: Reverse lookup (target expensive outputs)
    await phase8ReverseLookup();

    // Phase 9: StatTrak knife search
    await phase9StatTrakSearch();

    // Refresh Skinport prices periodically (fallback source)
    if (cycleCount === 1 || cycleCount % 10 === 0) {
      await refreshPrices();
    }

    // Continuous optimization during rate limit cooldown — no idle time
    const waitMs = 50 * 60 * 1000;
    await continuousOptimization(waitMs);
  }
}

main().catch((err) => {
  console.error("Daemon crashed:", err);
  process.exit(1);
});
