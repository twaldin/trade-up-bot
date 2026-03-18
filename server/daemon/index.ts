/**
 * Trade-Up Daemon — time-bounded discovery engine.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 3: API Probe (rate limit detection)
 * Phase 4: Data Fetch (sale history, listings)
 * Phase 4.5: Verify profitable inputs (individual lookup pool)
 * Phase 5: TIME-BOUNDED ENGINE — repeating super-batches of:
 *   (a) 2 workers (structured discovery → deep exploration, 2-min time limit)
 *   (b) Merge results
 *   (c) Revival (200 gun + 200 knife)
 *   (d) Staleness checks (75 listings, paced by API budget)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "node:child_process";
import { initDb, DB_PATH, emitEvent, getSyncMeta, setSyncMeta } from "../db.js";
import { takeSnapshot, purgeOldSnapshots } from "../snapshot.js";
import { initRedis, setCycleVersion, cacheSet } from "../redis.js";
import type { TradeUp } from "../../shared/types.js";

import {
  startSkinportListener, getSkinportStats, isDMarketConfigured,
  checkListingStaleness, checkDMarketStaleness,
} from "../sync.js";
import {
  mergeTradeUps, updateCollectionScores, buildPriceCache, trimGlobalExcess,
  reviveStaleGunTradeUps, reviveStaleTradeUps,
  getKnifeFinishesWithPrices, CASE_KNIFE_MAP, GLOVE_GEN_SKINS,
  type FinishData,
} from "../engine.js";
import { BudgetTracker, FreshnessTracker, TARGET_CYCLE_MS } from "./state.js";
import {
  timestamp, setDaemonStatus, setDaemonMeta, updateExplorationStats, printCoverageReport,
  ensureStatsTable, saveCycleStats, printPerformanceComparison,
  type CycleStats,
} from "./utils.js";
import {
  phase1Housekeeping,
  phase3ApiProbe,
  phase4DataFetch,
  phase4p5VerifyInputs,
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

/** Minimum worker time limit in ms. Workers do structured + exploration within this budget. */
const MIN_WORKER_TIME = 120_000; // 2 min minimum

/** Maximum worker time limit in ms. First super-batch gets more time. */
const MAX_WORKER_TIME = 300_000; // 5 min maximum

/** Kill timeout buffer — SIGTERM workers that exceed their time limit by this margin. */
const WORKER_KILL_BUFFER = 30_000; // 30s grace period

/** Worker round definitions: pairs of tiers to run in parallel. */
const WORKER_ROUNDS: [string, string][] = [
  ["knife", "classified"],
  ["restricted", "milspec"],
  ["industrial", "consumer"],
];

/** Trade-up type for each worker task. */
const TASK_TYPE_MAP: Record<string, string> = {
  knife: "covert_knife",
  classified: "classified_covert",
  restricted: "restricted_classified",
  milspec: "milspec_restricted",
  industrial: "industrial_milspec",
  consumer: "consumer_industrial",
};

/**
 * Spawn a child process for CPU-intensive trade-up discovery.
 * Time-bounded: worker runs structured discovery then deep exploration
 * until timeLimitMs expires. Kill timeout prevents hangs.
 */
function runCalcWorker(
  task: "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer",
  dbPath: string,
  timeLimitMs?: number,
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
        CALC_WORKER_DATA: JSON.stringify({ task, dbPath, timeLimitMs }),
      },
    });

    let settled = false;

    // Kill timeout: terminate worker if it exceeds time limit + buffer
    let killTimeout: NodeJS.Timeout | undefined;
    if (timeLimitMs) {
      killTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGTERM");
          reject(new Error(`Worker ${task} timed out after ${timeLimitMs + WORKER_KILL_BUFFER}ms`));
        }
      }, timeLimitMs + WORKER_KILL_BUFFER);
    }

    const cleanup = () => {
      if (killTimeout) clearTimeout(killTimeout);
    };

    child.on("message", (msg: { ok: boolean; tradeUps?: TradeUp[]; resultFile?: string; error?: string; stats?: unknown }) => {
      if (settled) return;
      settled = true;
      cleanup();
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
              try { fs.unlinkSync(msg.resultFile!); } catch { /* already cleaned up */ }
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
      if (!settled) { settled = true; cleanup(); reject(err); }
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        cleanup();
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
  initRedis();
  const freshness = new FreshnessTracker();
  const daemonStartedAt = new Date().toISOString();

  // --fresh flag: purge all trade-ups for a clean start (useful when testing new logic)
  const freshStart = process.argv.includes("--fresh") || process.env.DAEMON_FRESH === "1";

  ensureStatsTable(db);
  setDaemonMeta(0, daemonStartedAt);

  console.log(`[${timestamp()}] Trade-Up Daemon started (time-bounded engine)`);
  console.log(`  Phases: Housekeeping → Probe → Fetch → Time-Bounded Engine (structured + deep exploration)`);
  console.log(`  Rate limits (3 separate pools):`);
  console.log(`    Listing search: 200/~30min | Sale history: 500/~12h | Individual: 50K/~12h`);
  console.log(`  Data sources: CSFloat API${isDMarketConfigured() ? " + DMarket API" : ""} + Skinport WebSocket`);
  console.log(`  Worker time limit: ${MIN_WORKER_TIME / 1000}s-${MAX_WORKER_TIME / 1000}s per worker (dynamic), 2 workers per round`);

  // Start Skinport WebSocket listener (passive listing accumulation — no auth, no rate limits)
  const stopSkinport = await startSkinportListener(db);
  console.log(`  Skinport WebSocket: listener started (passive listing feed)`);

  if (freshStart) {
    db.prepare("DELETE FROM trade_up_inputs").run();
    const purged = db.prepare("DELETE FROM trade_ups").run();
    console.log(`  --fresh: purged ${purged.changes} trade-ups for clean start`);
    // Flush Redis cache — old trade-up data is invalid
    try {
      const { getRedis } = await import("../redis.js");
      const redis = getRedis();
      if (redis) {
        await redis.flushdb();
        console.log(`  --fresh: Redis cache flushed`);
      }
    } catch { /* Redis not available */ }
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

    // Phase 4b: Recalc trade-up stats where input prices changed (DMarket/Skinport updates)
    {
      const { recalcTradeUpCosts } = await import("../engine.js");
      const lastRecalc = getSyncMeta(db, "last_recalc_at");
      const recalcResult = recalcTradeUpCosts(db, lastRecalc ?? undefined);
      setSyncMeta(db, "last_recalc_at", new Date().toISOString());
      if (recalcResult.updated > 0) {
        console.log(`  Phase 4b: Recalculated ${recalcResult.updated} trade-ups with changed input prices`);
      }
    }

    // ─── Phase 5: Time-Bounded Discovery Engine ───────────────────────
    // Replaces old Phase 5 (one-shot workers) + Phase 6 (cooldown).
    // Workers do structured discovery (instant via sig-skip) then deep
    // exploration until their time limit. Between worker rounds: merge,
    // revival, staleness checks. Repeats until cycle time budget exhausted.
    const engineBudgetMs = Math.max(TARGET_CYCLE_MS - (Date.now() - cycleStarted), 60_000);
    const engineEnd = Date.now() + engineBudgetMs;

    console.log(`\n[${timestamp()}] Phase 5: Time-Bounded Engine (${(engineBudgetMs / 60000).toFixed(1)} min budget)`);
    setDaemonStatus(db, "calculating", "Phase 5: Time-Bounded Engine");

    // Build price cache + knife finish cache for main-thread merge/revival
    buildPriceCache(db, true);
    const revivalKnifeCache = new Map<string, FinishData[]>();
    {
      const itemTypes = new Set<string>();
      for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
        for (const kt of caseInfo.knifeTypes) itemTypes.add(kt);
        if (caseInfo.gloveGen) {
          for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) itemTypes.add(gt);
        }
      }
      for (const it of itemTypes) {
        const finishes = getKnifeFinishesWithPrices(db, it);
        if (finishes.length > 0) revivalKnifeCache.set(it, finishes);
      }
    }

    // Engine stats
    let superBatchCount = 0;
    let totalKnifeResults = 0;
    let totalKnifeProfitable = 0;
    let totalClassifiedResults = 0;
    let totalClassifiedProfitable = 0;
    let totalStalenessChecked = 0;
    let totalStalenessSold = 0;
    let totalStalenessRemoved = 0;
    let totalRevived = 0;
    let totalDmarketChecked = 0;
    let topKnifeProfit = 0;

    const dmarketEnabled = isDMarketConfigured();

    // Super-batch loop: runs until cycle time budget is exhausted
    while (Date.now() < engineEnd - 30_000) { // Stop 30s before end
      superBatchCount++;
      const batchStart = Date.now();
      console.log(`\n  ── Super-batch ${superBatchCount} ──`);
      setDaemonStatus(db, "calculating", `Phase 5: Super-batch ${superBatchCount}`);

      // Run 3 rounds of 2 workers each
      for (let roundIdx = 0; roundIdx < WORKER_ROUNDS.length; roundIdx++) {
        if (Date.now() >= engineEnd - 30_000) break;

        const [taskA, taskB] = WORKER_ROUNDS[roundIdx];

        // Dynamic worker time: first super-batch gets generous time for full
        // structured discovery (no existing sigs on fresh/cycle 1).
        // Subsequent super-batches: structured is instant, use minimum for exploration.
        const isFirstBatch = superBatchCount === 1;
        const remainingMs = engineEnd - Date.now();
        const workerTimeLimit = isFirstBatch
          ? Math.min(MAX_WORKER_TIME, Math.floor(remainingMs / WORKER_ROUNDS.length))
          : MIN_WORKER_TIME;

        setDaemonStatus(db, "calculating", `Phase 5: ${taskA} + ${taskB} (${Math.round(workerTimeLimit / 1000)}s)`);

        const results = await Promise.allSettled([
          runCalcWorker(taskA as "knife", DB_PATH, workerTimeLimit),
          runCalcWorker(taskB as "classified", DB_PATH, workerTimeLimit),
        ]);

        // Merge results for each worker
        for (let i = 0; i < 2; i++) {
          const r = results[i];
          const taskName = i === 0 ? taskA : taskB;
          const tradeUpType = TASK_TYPE_MAP[taskName];

          if (r.status === "fulfilled" && r.value.length > 0) {
            const tradeUps = r.value;
            const profitable = tradeUps.filter(t => t.profit_cents > 0);

            // Merge-save (cap at 30K for lower tiers to prevent OOM)
            const MAX_SAVE = 30000;
            let toSave = tradeUps;
            if (tradeUps.length > MAX_SAVE) {
              const profitableSet = tradeUps.filter(t => t.profit_cents > 0);
              const highChance = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) >= 0.25);
              const rest = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) < 0.25);
              rest.sort((a, b) => b.profit_cents - a.profit_cents);
              toSave = [...profitableSet, ...highChance, ...rest].slice(0, MAX_SAVE);
            }

            mergeTradeUps(db, toSave, tradeUpType);

            // Track stats
            if (taskName === "knife") {
              totalKnifeResults += tradeUps.length;
              totalKnifeProfitable += profitable.length;
              if (profitable.length > 0 && profitable[0].profit_cents > topKnifeProfit) {
                topKnifeProfit = profitable[0].profit_cents;
              }
            } else if (taskName === "classified") {
              totalClassifiedResults += tradeUps.length;
              totalClassifiedProfitable += profitable.length;
            }

            console.log(`    ${taskName}: ${tradeUps.length} trade-ups (${profitable.length} profitable)`);

            // Log top trade-ups for high-value tiers
            if (profitable.length > 0 && (taskName === "knife" || taskName === "classified")) {
              for (const tu of profitable.slice(0, 3)) {
                const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
                console.log(`      $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
              }
            }

            emitEvent(db, `${tradeUpType}_calc`, `${profitable.length} profitable, best +$${profitable.length > 0 ? (profitable[0].profit_cents / 100).toFixed(2) : "0.00"}`);
          } else if (r.status === "rejected") {
            console.error(`    ${taskName} failed: ${r.reason?.message}`);
          } else {
            console.log(`    ${taskName}: 0 trade-ups`);
          }
        }
      }

      // Revival between super-batches (CPU-only, no API calls)
      setDaemonStatus(db, "calculating", `Phase 5: Revival (batch ${superBatchCount})`);
      const gunRevival = reviveStaleGunTradeUps(db, 200);
      const knifeRevival = reviveStaleTradeUps(db, revivalKnifeCache, 200);
      const batchRevived = gunRevival.revived + knifeRevival.revived;
      totalRevived += batchRevived;
      if (batchRevived > 0) {
        console.log(`    Revival: ${gunRevival.revived} gun + ${knifeRevival.revived} knife revived`);
      }

      // Handle expired claims: clear claimed_by, check if listings were actually purchased
      {
        const expired = db.prepare(`
          SELECT id, trade_up_id, user_id FROM trade_up_claims
          WHERE released_at IS NULL AND confirmed_at IS NULL AND expires_at <= datetime('now')
        `).all() as { id: number; trade_up_id: number; user_id: string }[];
        if (expired.length > 0) {
          const clearClaimed = db.prepare("UPDATE listings SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND claimed_by = ?");
          const releaseClaim = db.prepare("UPDATE trade_up_claims SET released_at = datetime('now') WHERE id = ?");
          db.transaction(() => {
            for (const claim of expired) {
              const listings = db.prepare(
                "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = ?"
              ).all(claim.trade_up_id) as { listing_id: string }[];
              for (const { listing_id } of listings) clearClaimed.run(listing_id, claim.user_id);
              releaseClaim.run(claim.id);
            }
          })();
          console.log(`    Expired claims: ${expired.length} released`);
          // Expired listings will be checked by the staleness batch below
        }
      }

      // Process confirmed purchases: delete listings queued by confirm endpoint
      {
        const { getRedis: getR } = await import("../redis.js");
        const redis = getR();
        if (redis) {
          const confirmedIds: string[] = [];
          let id: string | null;
          while ((id = await redis.rpop("confirmed_listings")) !== null) {
            confirmedIds.push(id);
          }
          if (confirmedIds.length > 0) {
            const deleteListing = db.prepare("DELETE FROM listings WHERE id = ?");
            db.transaction(() => {
              for (const lid of confirmedIds) deleteListing.run(lid);
            })();
            // refreshListingStatuses in next housekeeping will cascade partial status
            console.log(`    Confirmed purchases: deleted ${confirmedIds.length} listings`);
          }
        }
      }

      // Adjust staleness budget based on verify API calls from users
      let stalenessMaxChecks = 75;
      try {
        const { getRedis } = await import("../redis.js");
        const redis = getRedis();
        if (redis) {
          const verifyCalls = parseInt(await redis.getset("verify_api_calls", "0") || "0");
          if (verifyCalls > 0) {
            stalenessMaxChecks = Math.max(25, 75 - verifyCalls);
            console.log(`    Staleness budget adjusted: 75 - ${verifyCalls} verify calls = ${stalenessMaxChecks}`);
          }
        }
      } catch { /* Redis unavailable */ }

      // Staleness checks between super-batches (uses individual API pool)
      setDaemonStatus(db, "fetching", `Phase 5: Staleness (batch ${superBatchCount})`);
      try {
        const stalenessResult = await checkListingStaleness(db, {
          apiKey,
          maxChecks: stalenessMaxChecks,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        totalStalenessChecked += stalenessResult.checked;
        totalStalenessSold += stalenessResult.sold;
        totalStalenessRemoved += stalenessResult.delisted;
        if (stalenessResult.sold > 0 || stalenessResult.delisted > 0) {
          freshness.markListingsChanged();
          console.log(`    Staleness: ${stalenessResult.checked} checked, ${stalenessResult.sold} sold, ${stalenessResult.delisted} removed`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429")) {
          console.log(`    Staleness: rate limited after ${totalStalenessChecked} total checks`);
        }
      }

      // DMarket staleness (every other super-batch)
      if (dmarketEnabled && superBatchCount % 2 === 0) {
        try {
          const dmResult = await checkDMarketStaleness(db, {
            maxChecks: 5,
            onProgress: (msg) => setDaemonStatus(db, "fetching", `DMarket: ${msg}`),
          });
          totalDmarketChecked += dmResult.checked;
          if (dmResult.removed > 0) {
            freshness.markListingsChanged();
            console.log(`    DMarket staleness: ${dmResult.checked} checked, ${dmResult.removed} removed`);
          }
        } catch {
          // DMarket errors don't block engine loop
        }
      }

      const batchMs = Date.now() - batchStart;
      console.log(`    Super-batch ${superBatchCount} done (${(batchMs / 1000).toFixed(1)}s)`);
    }

    // Post-engine: update collection scores + global trim
    updateCollectionScores(db);
    trimGlobalExcess(db, 5_000_000); // 5M cap — will lower if cycle time exceeds 30 min
    freshness.markCalcDone();

    const engineMs = Date.now() - cycleStarted - (Date.now() - (cycleStarted + engineBudgetMs - (engineEnd - Date.now())));
    console.log(`\n[${timestamp()}] Engine done: ${superBatchCount} super-batches, ${totalKnifeResults} knife + ${totalClassifiedResults} classified, ${totalRevived} revived, ${totalStalenessChecked} staleness checks`);

    // ─── Post-engine: coverage, snapshot, Redis, stats ────────────────

    // Coverage report
    printCoverageReport(db);
    console.log(`  API: ${budget.saleCount} sale calls (${budget.saleRemaining} remaining) + ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);

    // WAL checkpoint — keeps WAL file size manageable
    db.pragma("wal_checkpoint(PASSIVE)");

    // Pre-populate Redis cache so API never hits cold SQLite
    try {
      const cycleTs = new Date().toISOString();
      await setCycleVersion(cycleTs);

      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM trade_ups WHERE is_theoretical = 0) as total_tu,
          (SELECT SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) FROM trade_ups WHERE is_theoretical = 0) as profitable_tu,
          (SELECT COUNT(*) FROM listings) as listings,
          (SELECT COUNT(*) FROM price_observations) as sale_obs,
          (SELECT COUNT(*) FROM sale_history) as sale_hist,
          (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as refs,
          (SELECT COUNT(*) FROM daemon_cycle_stats) as cycles
      `).get() as { total_tu: number; profitable_tu: number; listings: number; sale_obs: number; sale_hist: number; refs: number; cycles: number };
      await cacheSet("global_stats", {
        total_trade_ups: stats.total_tu,
        profitable_trade_ups: stats.profitable_tu ?? 0,
        total_data_points: stats.listings + stats.sale_obs + stats.sale_hist + stats.refs,
        listings: stats.listings,
        sale_observations: stats.sale_obs,
        sale_history: stats.sale_hist,
        ref_prices: stats.refs,
        total_cycles: stats.cycles,
      }, 60);

      const inputSkins = db.prepare("SELECT DISTINCT skin_name as name FROM trade_up_inputs").all() as { name: string }[];
      const skinMap = inputSkins.map(s => ({ name: s.name, input: true, output: false }));
      const collections = db.prepare("SELECT collection_name as name, COUNT(*) as count FROM trade_up_inputs GROUP BY collection_name ORDER BY count DESC").all() as { name: string; count: number }[];
      await cacheSet("filter_opts", { skins: skinMap, collections }, 600);

      // Invalidate stale trade-up list cache so API shows fresh counts
      const { cacheInvalidatePrefix } = await import("../redis.js");
      await cacheInvalidatePrefix("tu:");

      console.log(`  Redis cache pre-populated`);
    } catch (e) {
      console.error(`  Redis pre-populate failed: ${(e as Error).message}`);
    }

    // Save cycle stats
    const cycleDuration = Date.now() - cycleStarted;
    const cycleStats: CycleStats = {
      cycle: cycleCount,
      startedAt: cycleStartedAt,
      durationMs: cycleDuration,
      apiCallsUsed: budget.usedCount,
      apiLimitDetected: probe.listingSearch.rateLimit.limit,
      apiAvailable: anyAvailable,
      knifeTradeUpsTotal: totalKnifeResults,
      knifeProfitable: totalKnifeProfitable,
      theoriesGenerated: 0,
      theoriesProfitable: 0,
      gapsFilled: 0,
      cooldownPasses: superBatchCount,
      cooldownNewFound: 0,
      cooldownImproved: 0,
      topProfit: topKnifeProfit,
      avgProfit: totalKnifeProfitable > 0 ? Math.round(topKnifeProfit / totalKnifeProfitable) : 0,
      classifiedTotal: totalClassifiedResults,
      classifiedProfitable: totalClassifiedProfitable,
      classifiedTheories: 0,
      classifiedTheoriesProfitable: 0,
    };
    saveCycleStats(db, cycleStats);

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
