/**
 * Trade-Up Daemon — multi-type loop with parallel discovery.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 3: API Probe (rate limit detection)
 * Phase 4: Data Fetch (sale history, listings)
 * Phase 4.5: Verify profitable inputs (individual lookup pool)
 * Phase 5: Knife Calc (discovery)
 * Phase 5b: Classified Calc (discovery)
 * Phase 5c: Staircase (50 Classified → 5 Coverts → 1 Knife/Glove)
 * Phase 6: Cooldown (staleness checks)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork, type ChildProcess } from "node:child_process";
import { initDb, DB_PATH, setSyncMeta } from "../db.js";
import { takeSnapshot, purgeOldSnapshots } from "../snapshot.js";
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
  phase3ApiProbe,
  phase4DataFetch,
  phase4p5VerifyInputs,
  phase5KnifeCalc,
  phase5ClassifiedCalc,
  phase5GenericCalc,
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
  task: "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer",
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
  console.log(`  Phases: Housekeeping → Probe → Fetch → Parallel Calc (knife+classified workers) → Staircase → Cooldown`);
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

    // Phase 3: API Probe (tests all 3 rate limit pools independently)
    const probe = await phase3ApiProbe(db, budget, apiKey);

    // Phase 4: Data Fetch — runs whichever endpoints are available
    const anyAvailable = probe.listingSearch.available || probe.saleHistory.available;
    if (anyAvailable) {
      await phase4DataFetch(db, budget, freshness, apiKey, [], probe);
    } else {
      console.log(`  All endpoints rate limited — skipping Phase 4`);
    }

    // Phase 4.5: Verify profitable trade-up inputs still exist
    await phase4p5VerifyInputs(db, freshness, apiKey, probe, budget);

    // Phase 5: Parallel discovery via worker threads
    // Knife, Classified, and ST discovery run concurrently in separate threads.
    // Each worker opens a read-only DB connection and builds its own price cache.
    // Saving happens sequentially on the main thread after.
    const shouldRunKnife = freshness.needsRecalc() || cycleCount === 1;

    let knifeDiscovery: TradeUp[] | undefined;
    let classifiedDiscovery: TradeUp[] | undefined;
    let restrictedDiscovery: TradeUp[] | undefined;
    let milspecDiscovery: TradeUp[] | undefined;
    let industrialDiscovery: TradeUp[] | undefined;
    let consumerDiscovery: TradeUp[] | undefined;

    {
      type WorkerTask = { name: string; promise: Promise<TradeUp[]> };
      // Batch 1: high-priority (knife + classified) — 2 workers max to keep API responsive
      const batch1: WorkerTask[] = [];
      if (shouldRunKnife) batch1.push({ name: "knife", promise: runCalcWorker("knife", DB_PATH) });
      batch1.push({ name: "classified", promise: runCalcWorker("classified", DB_PATH) });

      console.log(`\n[${timestamp()}] Batch 1: ${batch1.map(t => t.name).join(" + ")} (parallel)`);
      setDaemonStatus(db, "calculating", `Phase 5: ${batch1.map(t => t.name).join(" + ")}`);

      const results1 = await Promise.allSettled(batch1.map(t => t.promise));
      for (let i = 0; i < results1.length; i++) {
        const r = results1[i];
        if (r.status === "fulfilled") {
          if (batch1[i].name === "knife") knifeDiscovery = r.value;
          else if (batch1[i].name === "classified") classifiedDiscovery = r.value;
          console.log(`  Worker ${batch1[i].name}: ${r.value.length} trade-ups`);
        } else {
          console.error(`  Worker ${batch1[i].name} failed: ${r.reason?.message}`);
        }
      }

      // Batch 2: lower-priority (restricted + milspec + industrial) — 2 at a time
      const batch2: WorkerTask[] = [
        { name: "restricted", promise: runCalcWorker("restricted", DB_PATH) },
        { name: "milspec", promise: runCalcWorker("milspec", DB_PATH) },
      ];
      console.log(`  Batch 2: ${batch2.map(t => t.name).join(" + ")}`);
      setDaemonStatus(db, "calculating", `Phase 5: ${batch2.map(t => t.name).join(" + ")}`);

      const results2 = await Promise.allSettled(batch2.map(t => t.promise));
      for (let i = 0; i < results2.length; i++) {
        const r = results2[i];
        if (r.status === "fulfilled") {
          if (batch2[i].name === "restricted") restrictedDiscovery = r.value;
          else if (batch2[i].name === "milspec") milspecDiscovery = r.value;
          console.log(`  Worker ${batch2[i].name}: ${r.value.length} trade-ups`);
        } else {
          console.error(`  Worker ${batch2[i].name} failed: ${r.reason?.message}`);
        }
      }

      // Batch 3: industrial + consumer (parallel)
      console.log(`  Batch 3: industrial + consumer`);
      setDaemonStatus(db, "calculating", "Phase 5: industrial + consumer");
      const batch3 = [
        { name: "industrial", promise: runCalcWorker("industrial", DB_PATH) },
        { name: "consumer", promise: runCalcWorker("consumer", DB_PATH) },
      ];
      const batch3Results = await Promise.allSettled(batch3.map(w => w.promise));
      for (let i = 0; i < batch3.length; i++) {
        const r = batch3Results[i];
        if (r.status === "fulfilled") {
          console.log(`  Worker ${batch3[i].name}: ${r.value.length} trade-ups`);
          if (batch3[i].name === "industrial") industrialDiscovery = r.value;
          if (batch3[i].name === "consumer") consumerDiscovery = r.value;
        } else {
          console.error(`  Worker ${batch3[i].name} failed: ${r.reason?.message}`);
        }
      }

    }

    // Phase 5: Knife (saving on main thread)
    const knifeCalcResult = phase5KnifeCalc(db, freshness, cycleCount === 1, knifeDiscovery);

    // Phase 5b: Classified (saving on main thread)
    const classifiedCalcResult = phase5ClassifiedCalc(db, freshness, cycleCount === 1, classifiedDiscovery);

    // Phase 5e: Restricted→Classified discovery (must run before staircases)
    phase5GenericCalc(db, "restricted_classified", restrictedDiscovery);

    // Phase 5f: Mil-Spec→Restricted discovery
    phase5GenericCalc(db, "milspec_restricted", milspecDiscovery);

    // Phase 5g: Industrial→Mil-Spec discovery
    phase5GenericCalc(db, "industrial_milspec", industrialDiscovery);

    // Phase 5h: Consumer→Industrial discovery
    phase5GenericCalc(db, "consumer_industrial", consumerDiscovery);

    // Staircase removed — single-stage results are non-deterministic (which Coverts
    // come out of stage 1 is probabilistic, making stage 2 profit estimates unreliable).

    // Coverage report
    printCoverageReport(db);
    console.log(`  API: ${budget.saleCount} sale calls (${budget.saleRemaining} remaining) + ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);

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
      theoriesGenerated: 0,
      theoriesProfitable: 0,
      gapsFilled: 0,
      cooldownPasses: cooldownResult.passes,
      cooldownNewFound: cooldownResult.newFound,
      cooldownImproved: cooldownResult.improved,
      topProfit: knifeCalcResult.topProfit,
      avgProfit: knifeCalcResult.avgProfit,
      classifiedTotal: classifiedCalcResult.total,
      classifiedProfitable: classifiedCalcResult.profitable,
      classifiedTheories: 0,
      classifiedTheoriesProfitable: 0,
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
