/**
 * Trade-Up Daemon — multi-type loop with float-aware theory.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 2: Theory — knife + classified (pure computation, no API)
 * Phase 3: API Probe (rate limit detection)
 * Phase 4: Data Fetch (sale history, listings, unified wanted list)
 * Phase 4.5: Verify profitable inputs (individual lookup pool)
 * Phase 5: Knife Calc (discovery + materialization)
 * Phase 5b: Classified Calc (discovery + materialization)
 * Phase 5c: Staircase (50 Classified → 5 Coverts → 1 Knife/Glove)
 * Phase 6: Cooldown (staleness checks)
 * Phase 7: Re-materialization (re-check theories with updated data)
 *
 * Key insight: Theory runs BEFORE API calls so the wanted list guides fetching.
 * Knife + classified wanted lists are merged and fetched by priority.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork, type ChildProcess } from "node:child_process";
import { initDb, DB_PATH, setSyncMeta } from "../db.js";
import { takeSnapshot, purgeOldSnapshots } from "../snapshot.js";
import {
  loadNearMissesFromDb, type NearMissInfo, type WantedListing,
  generateTheoriesForTier, buildWantedListForTier, saveTheoryTradeUpsForTier, getTierById,
} from "../engine.js";
import type { TradeUp } from "../../shared/types.js";

import { startSkinportListener, getSkinportStats, isDMarketConfigured } from "../sync.js";
import { BudgetTracker, FreshnessTracker, TARGET_CYCLE_MS, MIN_COOLDOWN_MS, MAX_COOLDOWN_MS, IDLE_COOLDOWN_MS } from "./state.js";
import {
  timestamp, setDaemonStatus, setDaemonMeta, updateExplorationStats, printCoverageReport,
  ensureStatsTable, saveCycleStats, printPerformanceComparison,
  type CycleStats,
} from "./utils.js";
import { cooldownLoop } from "./loops.js";
import {
  phase1Housekeeping,
  phase2Theory,
  phase2ClassifiedTheory,
  phase3ApiProbe,
  phase4DataFetch,
  phase4p5VerifyInputs,
  phase5KnifeCalc,
  phase5ClassifiedCalc,
  phase5cStaircase,
  phase5GenericCalc,
  phase2cStaircaseTheory,
  phase7Rematerialization,
  printTheoryAccuracy,
} from "./phases.js";

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

/**
 * Spawn a child process for CPU-intensive trade-up discovery.
 * Uses fork() instead of worker_threads because tsx's ESM loader
 * hooks aren't inherited by worker threads in Node.js v24.
 */
function runCalcWorker(
  task: "knife" | "classified" | "restricted" | "milspec",
  dbPath: string,
  extraTransitionPoints?: number[],
): Promise<TradeUp[]> {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL("./calc-worker.ts", import.meta.url));

    // Extract tsx loader flags from parent process execArgv
    const execArgv: string[] = [];
    for (let i = 0; i < process.execArgv.length; i++) {
      const arg = process.execArgv[i];
      if ((arg === "--require" || arg === "--import") && i + 1 < process.execArgv.length) {
        execArgv.push(arg, process.execArgv[i + 1]);
        i++;
      }
    }

    const child = fork(workerPath, [], {
      execArgv,
      serialization: "advanced",
      env: {
        ...process.env,
        CALC_WORKER_DATA: JSON.stringify({ task, dbPath, extraTransitionPoints }),
      },
    });

    let settled = false;
    child.on("message", (msg: { ok: boolean; tradeUps?: TradeUp[]; resultFile?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      if (msg.ok) {
        if (msg.resultFile) {
          // Large result set written as NDJSON (one JSON object per line).
          // Stream-read line-by-line to avoid V8 string length limit.
          import("readline").then(({ createInterface }) => {
            const data: TradeUp[] = [];
            const rl = createInterface({ input: fs.createReadStream(msg.resultFile!), crlfDelay: Infinity });
            rl.on("line", (line: string) => {
              if (line.trim()) {
                try { data.push(JSON.parse(line)); } catch { /* skip malformed */ }
              }
            });
            rl.on("close", () => {
              try { fs.unlinkSync(msg.resultFile!); } catch { /* expected — temp file already cleaned up */ }
              resolve(data);
            });
          });
        } else {
          resolve(msg.tradeUps!);
        }
      } else {
        reject(new Error(`Worker ${task}: ${msg.error}`));
      }
    });
    child.on("error", (err) => {
      if (!settled) { settled = true; reject(err); }
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        if (code !== 0) reject(new Error(`Worker ${task} exited with code ${code}`));
        else reject(new Error(`Worker ${task} exited without sending results`));
      }
    });
  });
}

export async function main() {
  const apiKey = process.env.CSFLOAT_API_KEY;
  if (!apiKey) {
    console.error("Missing CSFLOAT_API_KEY in .env");
    process.exit(1);
  }

  const db = initDb();
  const freshness = new FreshnessTracker();
  const daemonStartedAt = new Date().toISOString();

  // --fresh flag: purge all trade-ups for a clean start (useful when testing new logic)
  const freshStart = process.argv.includes("--fresh") || process.env.DAEMON_FRESH === "1";

  ensureStatsTable(db);
  setDaemonMeta(0, daemonStartedAt);

  console.log(`[${timestamp()}] Trade-Up Daemon started`);
  console.log(`  Phases: Housekeeping → Theory (knife+classified) → Probe → Fetch → Parallel Calc (knife+classified workers) → Staircase → Cooldown → Re-materialize`);
  console.log(`  Theory runs first (pure computation) → unified wanted list guides API fetching`);
  console.log(`  Rate limits (3 separate pools):`);
  console.log(`    Listing search: 200/~30min | Sale history: 500/~12h | Individual: 50K/~12h`);
  console.log(`  Data sources: CSFloat API${isDMarketConfigured() ? " + DMarket API" : ""} + Skinport WebSocket`);

  // Start Skinport WebSocket listener (passive listing accumulation — no auth, no rate limits)
  const stopSkinport = await startSkinportListener(db);
  console.log(`  Skinport WebSocket: listener started (passive listing feed)`);

  if (freshStart) {
    db.prepare("DELETE FROM trade_up_inputs").run();
    const purged = db.prepare("DELETE FROM trade_ups").run();
    console.log(`  --fresh: purged ${purged.changes} trade-ups for clean start`);
  } else {
    const existing = db.prepare("SELECT COUNT(*) as cnt, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable FROM trade_ups WHERE is_theoretical = 0").get() as { cnt: number; profitable: number };
    console.log(`  Resuming with ${existing.cnt} existing trade-ups (${existing.profitable} profitable)`);
  }
  console.log("");

  printCoverageReport(db);
  printPerformanceComparison(db);

  let cycleCount = 0;
  // Load persisted near-misses from DB (survives daemon restarts)
  let previousKnifeNearMisses: NearMissInfo[] = loadNearMissesFromDb(db, "knife");
  let previousClassifiedNearMisses: NearMissInfo[] = loadNearMissesFromDb(db, "classified");
  if (previousKnifeNearMisses.length > 0) {
    console.log(`  Loaded ${previousKnifeNearMisses.length} knife near-misses from previous session`);
  }
  if (previousClassifiedNearMisses.length > 0) {
    console.log(`  Loaded ${previousClassifiedNearMisses.length} classified near-misses from previous session`);
  }

  while (true) {
    cycleCount++;
    setDaemonMeta(cycleCount, daemonStartedAt);
    const cycleStarted = Date.now();
    const cycleStartedAt = new Date().toISOString();
    const budget = new BudgetTracker();

    updateExplorationStats(db, {
      cycle: cycleCount,
      passes_this_cycle: 0,
      new_tradeups_found: 0,
      tradeups_improved: 0,
      started_at: cycleStartedAt,
    });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${timestamp()}] Cycle ${cycleCount}`);
    console.log("=".repeat(60));

    // Phase 1: Housekeeping
    await phase1Housekeeping(db, cycleCount);

    // Phase 2: Theory (pure computation — no API calls)
    // Runs BEFORE fetch so wanted list guides API spend
    const theoryResult = phase2Theory(db, cycleCount, previousKnifeNearMisses);

    // Phase 2b: Classified Theory
    const classifiedTheoryResult = phase2ClassifiedTheory(db, cycleCount, previousClassifiedNearMisses);

    // Phase 2c: Staircase Theory (uses classified theories as Stage 1 inputs)
    const staircaseTheoryResult = phase2cStaircaseTheory(db, classifiedTheoryResult.theories);

    // Apply staircase boost to classified wanted list
    if (staircaseTheoryResult.boostMap.size > 0) {
      for (const w of classifiedTheoryResult.wantedList) {
        // Check if any classified theory using this skin contributes to a staircase
        for (const theory of classifiedTheoryResult.theories) {
          if (theory.inputSkins.some(s => s.skinName === w.skin_name)) {
            const boost = staircaseTheoryResult.boostMap.get(theory.comboKey);
            if (boost) {
              w.priority_score += boost;
              break; // one boost per skin
            }
          }
        }
      }
    }

    // Phase 2d: Theory for new rarity tiers (every 3 cycles — less critical than knife/classified)
    let restrictedWanted: WantedListing[] = [];
    let milspecWanted: WantedListing[] = [];
    if (cycleCount % 3 === 1) {
      try {
        const restrictedTier = getTierById("restricted_classified")!;
        console.log(`\n[${timestamp()}] Phase 2d: Restricted→Classified Theory`);
        const restrictedTheories = generateTheoriesForTier(db, restrictedTier, {
          onProgress: (msg) => console.log(`  ${msg}`),
          maxTheories: 1000,
        });
        if (restrictedTheories.length > 0) {
          saveTheoryTradeUpsForTier(db, restrictedTheories, "restricted_classified");
          restrictedWanted = buildWantedListForTier(restrictedTheories);
          console.log(`  Restricted wanted list: ${restrictedWanted.length} skins`);
        }
      } catch (err) { console.error(`  Restricted theory error: ${(err as Error).message}`); }

      try {
        const milspecTier = getTierById("milspec_restricted")!;
        console.log(`[${timestamp()}] Phase 2e: Mil-Spec→Restricted Theory`);
        const milspecTheories = generateTheoriesForTier(db, milspecTier, {
          onProgress: (msg) => console.log(`  ${msg}`),
          maxTheories: 500,
        });
        if (milspecTheories.length > 0) {
          saveTheoryTradeUpsForTier(db, milspecTheories, "milspec_restricted");
          milspecWanted = buildWantedListForTier(milspecTheories);
          console.log(`  Mil-Spec wanted list: ${milspecWanted.length} skins`);
        }
      } catch (err) { console.error(`  Mil-Spec theory error: ${(err as Error).message}`); }
    }

    // Merge wanted lists — fetch most impactful skins first regardless of type
    const unifiedWantedList: WantedListing[] = [
      ...theoryResult.wantedList,
      ...classifiedTheoryResult.wantedList,
      ...restrictedWanted,
      ...milspecWanted,
    ].sort((a, b) => b.priority_score - a.priority_score);
    if (unifiedWantedList.length > 0) {
      const parts = [
        `${theoryResult.wantedList.length} knife`,
        `${classifiedTheoryResult.wantedList.length} classified`,
        restrictedWanted.length > 0 ? `${restrictedWanted.length} restricted` : null,
        milspecWanted.length > 0 ? `${milspecWanted.length} milspec` : null,
      ].filter(Boolean).join(" + ");
      console.log(`\n  Unified wanted list: ${unifiedWantedList.length} skins (${parts})`);
    }

    // Persist wanted list for the continuous DMarket fetcher process
    setSyncMeta(db, "dmarket_wanted_list", JSON.stringify(
      unifiedWantedList.slice(0, 200).map(w => ({
        skin_name: w.skin_name,
        priority: w.priority_score,
      }))
    ));

    // Phase 3: API Probe (tests all 3 rate limit pools independently)
    const probe = await phase3ApiProbe(db, budget, apiKey);

    // Phase 4: Data Fetch — runs whichever endpoints are available
    // Uses unified wanted list so both knife and classified theories guide fetching
    const anyAvailable = probe.listingSearch.available || probe.saleHistory.available;
    if (anyAvailable) {
      await phase4DataFetch(db, budget, freshness, apiKey, unifiedWantedList, probe);
    } else {
      console.log(`  All endpoints rate limited — skipping Phase 4`);
    }

    // Phase 4.5: Verify profitable trade-up inputs still exist
    await phase4p5VerifyInputs(db, freshness, apiKey, probe, budget);

    // Phase 5: Parallel discovery via worker threads
    // Knife, Classified, and ST discovery run concurrently in separate threads.
    // Each worker opens a read-only DB connection and builds its own price cache.
    // Materialization + saving happens sequentially on the main thread after.
    const shouldRunKnife = freshness.needsRecalc() || cycleCount === 1;

    let knifeDiscovery: TradeUp[] | undefined;
    let classifiedDiscovery: TradeUp[] | undefined;
    let restrictedDiscovery: TradeUp[] | undefined;
    let milspecDiscovery: TradeUp[] | undefined;

    {
      type WorkerTask = { name: string; promise: Promise<TradeUp[]> };
      const tasks: WorkerTask[] = [];
      if (shouldRunKnife) {
        tasks.push({ name: "knife", promise: runCalcWorker("knife", DB_PATH, theoryResult.bestFloatTargets) });
      }
      tasks.push({ name: "classified", promise: runCalcWorker("classified", DB_PATH) });
      tasks.push({ name: "restricted", promise: runCalcWorker("restricted", DB_PATH) });
      tasks.push({ name: "milspec", promise: runCalcWorker("milspec", DB_PATH) });

      console.log(`\n[${timestamp()}] Spawning ${tasks.length} worker threads for parallel discovery...`);
      setDaemonStatus(db, "calculating", `Phase 5: ${tasks.length} parallel discovery workers`);

      const results = await Promise.allSettled(tasks.map(t => t.promise));
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          if (tasks[i].name === "knife") knifeDiscovery = r.value;
          else if (tasks[i].name === "classified") classifiedDiscovery = r.value;
          else if (tasks[i].name === "restricted") restrictedDiscovery = r.value;
          else if (tasks[i].name === "milspec") milspecDiscovery = r.value;
          console.log(`  Worker ${tasks[i].name}: ${r.value.length} trade-ups`);
        } else {
          console.error(`  Worker ${tasks[i].name} failed: ${r.reason?.message} — falling back to main thread`);
        }
      }
    }

    // Phase 5: Knife (materialization + saving on main thread)
    const knifeCalcResult = phase5KnifeCalc(db, freshness, cycleCount === 1, theoryResult.bestFloatTargets, theoryResult.theories, knifeDiscovery);
    previousKnifeNearMisses = knifeCalcResult.nearMisses;

    // Phase 5b: Classified (materialization + saving on main thread)
    const classifiedCalcResult = phase5ClassifiedCalc(db, freshness, cycleCount === 1, classifiedTheoryResult.theories, classifiedDiscovery);
    previousClassifiedNearMisses = classifiedCalcResult.nearMisses;

    // Phase 5e: Restricted→Classified discovery (must run before staircases)
    phase5GenericCalc(db, "restricted_classified", restrictedDiscovery);

    // Phase 5f: Mil-Spec→Restricted discovery (must run before staircases)
    phase5GenericCalc(db, "milspec_restricted", milspecDiscovery);

    // Phase 5c: Staircase (every 5 cycles — depends on classified results being saved)
    if (cycleCount % 5 === 1) {
      phase5cStaircase(db);
    }

    // Coverage report
    printCoverageReport(db);
    console.log(`  API: ${budget.saleCount} sale calls (${budget.saleRemaining} remaining) + ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);

    // Theory vs Reality accuracy check
    printTheoryAccuracy(db);

    // Phase 7: Re-materialization — re-check theories with data changes from Phase 4
    if (freshness.needsRecalc()) {
      previousKnifeNearMisses = phase7Rematerialization(db, theoryResult, previousKnifeNearMisses);
    }

    // Phase 6: Cooldown — dynamic duration targeting fixed cycle time
    // Runs LAST so all work phases are included in timing calculation
    const workPhaseMs = Date.now() - cycleStarted;
    const hasListingBudget = !budget.isListingRateLimited() && budget.hasListingBudget();
    const hasSaleBudget = !budget.isSaleRateLimited() && budget.hasSaleBudget();
    let waitMs: number;
    if (hasListingBudget || hasSaleBudget) {
      // Dynamic: fill remaining time to hit target cycle duration
      waitMs = Math.max(MIN_COOLDOWN_MS, Math.min(MAX_COOLDOWN_MS, TARGET_CYCLE_MS - workPhaseMs));
    } else {
      // Rate limited on listing+sale pools — long idle cooldown
      waitMs = IDLE_COOLDOWN_MS;
    }
    const cooldownMin = (waitMs / 60000).toFixed(1);
    const workMin = (workPhaseMs / 60000).toFixed(1);
    console.log(`  Dynamic cooldown: ${workMin} min work + ${cooldownMin} min cooldown = ${((workPhaseMs + waitMs) / 60000).toFixed(1)} min target cycle`);
    setDaemonStatus(db, "waiting", `Phase 6: Staleness checks (${cooldownMin} min${hasListingBudget ? ", pacing" : ""})`);
    const cooldownResult = await cooldownLoop(db, waitMs, {
      freshness,
      apiKey,
      cycleCount,
      budget,
    });

    // Save cycle stats
    const cycleDuration = Date.now() - cycleStarted;
    const stats: CycleStats = {
      cycle: cycleCount,
      startedAt: cycleStartedAt,
      durationMs: cycleDuration,
      apiCallsUsed: budget.usedCount,
      apiLimitDetected: probe.listingSearch.rateLimit.limit,
      apiAvailable: anyAvailable,
      knifeTradeUpsTotal: knifeCalcResult.total,
      knifeProfitable: knifeCalcResult.profitable,
      theoriesGenerated: theoryResult.generated + classifiedTheoryResult.generated,
      theoriesProfitable: theoryResult.profitable + classifiedTheoryResult.profitable,
      gapsFilled: 0,
      cooldownPasses: cooldownResult.passes,
      cooldownNewFound: cooldownResult.newFound,
      cooldownImproved: cooldownResult.improved,
      topProfit: knifeCalcResult.topProfit,
      avgProfit: knifeCalcResult.avgProfit,
      classifiedTotal: classifiedCalcResult.total,
      classifiedProfitable: classifiedCalcResult.profitable,
      classifiedTheories: classifiedTheoryResult.generated,
      classifiedTheoriesProfitable: classifiedTheoryResult.profitable,
    };
    saveCycleStats(db, stats);

    // Take market snapshot for historical analysis
    const snapshotId = takeSnapshot(db, {
      cycle: cycleCount,
      type: "covert_knife",
      topN: 25,
      apiRemaining: {
        listing: probe.listingSearch.rateLimit.remaining ?? undefined,
        sale: probe.saleHistory.rateLimit.remaining ?? undefined,
        individual: probe.individualListing.rateLimit.remaining ?? undefined,
      },
    });
    if (cycleCount % 10 === 0) purgeOldSnapshots(db, 30);
    console.log(`  Snapshot #${snapshotId} saved (top 25 trade-ups)`);

    // Log Skinport WebSocket stats
    const spStats = getSkinportStats();
    if (spStats.totalReceived > 0) {
      console.log(`  Skinport WS: ${spStats.connected ? "connected" : "disconnected"}, ${spStats.totalStored} stored / ${spStats.totalReceived} received, ${spStats.totalSold} sold`);
    }

    console.log(`\n[${timestamp()}] Cycle ${cycleCount} complete (${(cycleDuration / 60000).toFixed(1)} min)`);
    printPerformanceComparison(db);
  }
}
