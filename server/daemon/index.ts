/**
 * Trade-Up Daemon — time-bounded discovery engine.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 3: API Probe (rate limit detection for listing + sale pools)
 * Phase 4: Data Fetch (sale history, listings)
 * Phase 5: TIME-BOUNDED ENGINE — repeating super-batches of:
 *   (a) 2 workers (structured discovery -> deep exploration, 2-min time limit)
 *   (b) Merge results
 *   (c) Revival (200 gun + 200 knife)
 *
 * CSFloat individual pool (staleness checks) managed by separate csfloat-checker process.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "node:child_process";
import { initDb, emitEvent, getSyncMeta, setSyncMeta } from "../db.js";
import { takeSnapshot, purgeOldSnapshots } from "../snapshot.js";
import { initRedis, setCycleVersion, cacheSet } from "../redis.js";
import type { TradeUp } from "../../shared/types.js";

import {
  startSkinportListener, getSkinportStats, isDMarketConfigured,
  checkDMarketStaleness,
} from "../sync.js";
import {
  mergeTradeUps, updateCollectionScores, buildPriceCache, trimGlobalExcess,
  reviveStaleGunTradeUps, reviveStaleTradeUps,
  getKnifeFinishesWithPrices, CASE_KNIFE_MAP, GLOVE_GEN_SKINS,
  cascadeTradeUpStatuses, withRetry,
  type FinishData,
} from "../engine.js";
import { BudgetTracker, FreshnessTracker, TARGET_CYCLE_MS } from "./state.js";
import {
  timestamp, setDaemonStatus, setDaemonMeta, updateExplorationStats, printCoverageReport,
  ensureStatsTable, saveCycleStats, printPerformanceComparison,
  type CycleStats,
} from "./utils.js";

// ─── Graceful restart queue ──────────────────────────────────────────────────
// SIGUSR2: queue restart at end of current cycle (PM2 auto-restarts after exit)
// SIGTERM/SIGINT: graceful shutdown (finish current phase, then exit)
let restartQueued = false;
let shutdownRequested = false;

process.on("SIGUSR2", () => {
  restartQueued = true;
  console.log(`\n[${timestamp()}] SIGUSR2 received — restart queued for end of cycle`);
});

process.on("SIGTERM", () => {
  if (shutdownRequested) {
    console.log(`\n[${timestamp()}] SIGTERM received again — forcing exit`);
    process.exit(1);
  }
  shutdownRequested = true;
  restartQueued = true; // also exit at cycle end
  console.log(`\n[${timestamp()}] SIGTERM received — will exit at end of current cycle`);
});

process.on("SIGINT", () => {
  if (shutdownRequested) process.exit(1);
  shutdownRequested = true;
  restartQueued = true;
  console.log(`\n[${timestamp()}] SIGINT received — will exit at end of current cycle`);
});

/** Check if daemon should skip starting new work (restart/shutdown pending). */
export function isRestartQueued(): boolean {
  return restartQueued;
}
import {
  phase1Housekeeping,
  phase3ApiProbe,
  phase4DataFetch,
} from "./phases.js";
import { initAlertState, checkAndFireAlerts, refreshAlertTops } from "./discord-alerts.js";

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
const MIN_WORKER_TIME = 180_000; // 3 min minimum (data loading overhead is ~18s with 126K+ listings)

/** Maximum worker time limit in ms. First super-batch gets more time. */
const MAX_WORKER_TIME = 300_000; // 5 min maximum

/** Kill timeout buffer — SIGTERM workers that exceed their time limit by this margin. */
const WORKER_KILL_BUFFER = 30_000; // 30s grace period

/** Worker round definitions: pairs of tiers to run in parallel. */
const WORKER_ROUNDS: ([string, string] | [string, null])[] = [
  ["knife", "classified"],
  ["knife", "restricted"],
  ["milspec", "industrial"],
  ["consumer", null],
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
interface WorkerResult {
  tradeUps: TradeUp[];
  stats?: { structuredCount: number; exploreCount: number; structuredMs: number };
}

function runCalcWorker(
  task: "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer",
  timeLimitMs?: number,
  cycleStartedAt?: number,
  discoveryFile?: string,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL("./calc-worker.ts", import.meta.url));

    // Extract tsx loader flags + memory flags from parent process execArgv
    const execArgv: string[] = [];
    for (let i = 0; i < process.execArgv.length; i++) {
      const arg = process.execArgv[i];
      if ((arg === "--require" || arg === "--import") && i + 1 < process.execArgv.length) {
        execArgv.push(arg, process.execArgv[i + 1]);
        i++;
      } else if (arg.startsWith("--max-old-space-size") || arg.startsWith("--max_old_space_size")) {
        execArgv.push(arg);
      }
    }

    const child = fork(workerPath, [], {
      execArgv,
      serialization: "advanced",
      env: {
        ...process.env,
        CALC_WORKER_DATA: JSON.stringify({ task, timeLimitMs, cycleStartedAt, discoveryFile }),
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
              resolve({ tradeUps: data, stats: msg.stats as WorkerResult['stats'] });
            });
          });
        } else {
          resolve({ tradeUps: msg.tradeUps!, stats: msg.stats as WorkerResult['stats'] });
        }
      } else {
        reject(new Error(`Worker ${task}: ${msg.error}`));
      }
    });
    child.on("error", (err) => {
      if (!settled) { settled = true; cleanup(); reject(err); }
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        cleanup();
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        if (code !== 0 || signal) reject(new Error(`Worker ${task} exited with ${reason}`));
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

  const pool = initDb();
  initRedis();
  const freshness = new FreshnessTracker();
  const daemonStartedAt = new Date().toISOString();

  // --fresh flag: purge all trade-ups for a clean start (useful when testing new logic)
  const freshStart = process.argv.includes("--fresh") || process.env.DAEMON_FRESH === "1";

  await ensureStatsTable(pool);
  setDaemonMeta(0, daemonStartedAt);

  console.log(`[${timestamp()}] Trade-Up Daemon started (time-bounded engine)`);
  console.log(`  Phases: Housekeeping -> Probe -> Fetch -> Time-Bounded Engine (structured + deep exploration)`);
  console.log(`  Rate limits (2 pools, individual managed by csfloat-checker):`);
  console.log(`    Listing search: 200/~1h | Sale history: 500/~24h`);
  console.log(`  Data sources: CSFloat API${isDMarketConfigured() ? " + DMarket API" : ""} + Skinport WebSocket`);
  console.log(`  Worker time limit: ${MIN_WORKER_TIME / 1000}s-${MAX_WORKER_TIME / 1000}s per worker (dynamic), 2 workers per round`);

  // Start Skinport WebSocket listener (passive listing accumulation — no auth, no rate limits)
  const stopSkinport = await startSkinportListener(pool);
  console.log(`  Skinport WebSocket: listener started (passive listing feed)`);

  if (freshStart) {
    await pool.query("DELETE FROM trade_up_inputs");
    const purged = await pool.query("DELETE FROM trade_ups");
    console.log(`  --fresh: purged ${purged.rowCount} trade-ups for clean start`);
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
    const { rows: [existing] } = await pool.query("SELECT COUNT(*) as cnt, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable FROM trade_ups WHERE is_theoretical = false");
    console.log(`  Resuming with ${existing.cnt} existing trade-ups (${existing.profitable ?? 0} profitable)`);
  }
  console.log("");

  await printCoverageReport(pool);
  await printPerformanceComparison(pool);

  // Initialize Discord alert state (seed Redis with current tops for each type/metric)
  try {
    const { getRedis } = await import("../redis.js");
    const redis = getRedis();
    if (redis) {
      await initAlertState(pool, redis);
    }
  } catch (e: any) {
    console.error("  Discord alert init failed (non-critical):", e.message);
  }

  let cycleCount = 0;

  while (true) {
    cycleCount++;
    setDaemonMeta(cycleCount, daemonStartedAt);
    const cycleStarted = Date.now();
    const cycleStartedAt = new Date().toISOString();
    const budget = new BudgetTracker();

    await updateExplorationStats(pool, {
      cycle: cycleCount,
      passes_this_cycle: 0,
      new_tradeups_found: 0,
      tradeups_improved: 0,
      started_at: cycleStartedAt,
    });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${timestamp()}] Cycle ${cycleCount}`);
    console.log("=".repeat(60));

    // Clear per-cycle caches (discovery data may have changed since last cycle)
    const { clearDiscoveryCache } = await import("../engine.js");
    clearDiscoveryCache();

    // Phase 1: Housekeeping — withRetry handles transient DB restarts (57P01 admin_shutdown)
    await withRetry(() => phase1Housekeeping(pool, cycleCount), 3, "Phase 1 Housekeeping");

    // Refresh Discord alert tops (re-validate cached tops are still active)
    try {
      const { getRedis } = await import("../redis.js");
      const redis = getRedis();
      if (redis) await refreshAlertTops(pool, redis);
    } catch { /* non-critical */ }

    // Phase 3: API Probe (tests all 3 rate limit pools independently)
    const probe = await phase3ApiProbe(pool, budget, apiKey);

    // Phase 4: Data Fetch — runs whichever endpoints are available
    const anyAvailable = probe.listingSearch.available || probe.saleHistory.available;
    if (anyAvailable) {
      await phase4DataFetch(pool, budget, freshness, apiKey, [], probe);
    } else {
      console.log(`  All endpoints rate limited — skipping Phase 4`);
    }

    // Phase 4.5/4.6: CSFloat staleness checks handled by separate csfloat-checker process

    // Phase 4b: Recalc trade-up stats where input prices changed (DMarket/Skinport updates)
    {
      const { recalcTradeUpCosts } = await import("../engine.js");
      const lastRecalc = await getSyncMeta(pool, "last_recalc_at");
      const recalcResult = await recalcTradeUpCosts(pool, lastRecalc ?? undefined);
      await setSyncMeta(pool, "last_recalc_at", new Date().toISOString());
      if (recalcResult.updated > 0) {
        console.log(`  Phase 4b: Recalculated ${recalcResult.updated} trade-ups with changed input prices`);
      }
    }

    // Phase 4c: Reprice output values with current KNN + price cache
    // 20000/cycle at ~7ms each = ~140s. Covers new discovery + works through backlog.
    {
      const t4c = Date.now();
      const { repriceTradeUpOutputs } = await import("../engine.js");
      const repriceResult = await repriceTradeUpOutputs(pool, 20000);
      const repriceMs = Date.now() - t4c;
      if (repriceResult.checked > 0) {
        console.log(`  Phase 4c: Repriced ${repriceResult.updated}/${repriceResult.checked} trade-up outputs (${(repriceMs / 1000).toFixed(1)}s)`);
      }
    }

    // --- Phase 5: Time-Bounded Discovery Engine ---
    const engineEnd = cycleStarted + TARGET_CYCLE_MS - 30_000; // 30s reserved for post-engine work
    const engineBudgetMs = Math.max(engineEnd - Date.now(), 60_000);

    console.log(`\n[${timestamp()}] Phase 5: Time-Bounded Engine (${(engineBudgetMs / 60000).toFixed(1)} min budget)`);
    await setDaemonStatus(pool, "calculating", "Phase 5: Time-Bounded Engine");

    // Build price cache + knife finish cache for main-thread merge/revival
    await buildPriceCache(pool, true);

    // Pre-materialize discovery data: load listings + compute KNN once, write to temp files.
    // Workers read these files instead of independently querying PG + computing KNN (~15s each).
    const { loadDiscoveryData: loadDD, serializeDiscoveryData, cleanupDiscoveryFiles } = await import("../engine.js");
    const discoveryFiles: string[] = [];
    const RARITY_CONFIGS: Array<{ rarity: string; groupKey: "collection_id" | "collection_name"; excludeWeapons?: readonly string[] }> = [
      { rarity: "Covert", groupKey: "collection_name", excludeWeapons: (await import("../engine.js")).KNIFE_WEAPONS },
      { rarity: "Classified", groupKey: "collection_id" },
      { rarity: "Restricted", groupKey: "collection_id" },
      { rarity: "Mil-Spec", groupKey: "collection_id" },
      { rarity: "Industrial Grade", groupKey: "collection_id" },
      { rarity: "Consumer Grade", groupKey: "collection_id" },
    ];
    const preMatStart = Date.now();
    for (const cfg of RARITY_CONFIGS) {
      const data = await loadDD(pool, cfg.rarity, cfg.groupKey, { excludeWeapons: cfg.excludeWeapons });
      const filePath = `/tmp/discovery-data-${cfg.rarity.replace(/\s+/g, "-").toLowerCase()}-${cfg.groupKey}.ndjson`;
      await serializeDiscoveryData(data, cfg.rarity, cfg.groupKey, filePath);
      discoveryFiles.push(filePath);
    }
    console.log(`  Pre-materialized ${RARITY_CONFIGS.length} discovery files (${((Date.now() - preMatStart) / 1000).toFixed(1)}s)`);
    // Clear main-process cache — workers use their own files, main process doesn't need this data
    clearDiscoveryCache();

    // Map worker task names to their pre-materialized file paths
    const taskDiscoveryFile: Record<string, string> = {
      knife: `/tmp/discovery-data-covert-collection_name.ndjson`,
      classified: `/tmp/discovery-data-classified-collection_id.ndjson`,
      restricted: `/tmp/discovery-data-restricted-collection_id.ndjson`,
      milspec: `/tmp/discovery-data-mil-spec-collection_id.ndjson`,
      industrial: `/tmp/discovery-data-industrial-grade-collection_id.ndjson`,
      consumer: `/tmp/discovery-data-consumer-grade-collection_id.ndjson`,
    };
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
        const finishes = await getKnifeFinishesWithPrices(pool, it);
        if (finishes.length > 0) revivalKnifeCache.set(it, finishes);
      }
    }

    // Engine stats
    let superBatchCount = 0;
    let totalKnifeResults = 0;
    let totalKnifeProfitable = 0;
    let totalClassifiedResults = 0;
    let totalClassifiedProfitable = 0;
    let totalRevived = 0;
    let totalDmarketChecked = 0;
    let topKnifeProfit = 0;

    const dmarketEnabled = isDMarketConfigured();

    // Super-batch loop: runs until cycle time budget is exhausted
    while (Date.now() < engineEnd - 30_000) { // Stop 30s before end
      superBatchCount++;
      const batchStart = Date.now();
      console.log(`\n  -- Super-batch ${superBatchCount} --`);
      await setDaemonStatus(pool, "calculating", `Phase 5: Super-batch ${superBatchCount}`);

      // Run worker rounds (1-2 workers per round)
      for (let roundIdx = 0; roundIdx < WORKER_ROUNDS.length; roundIdx++) {
        if (Date.now() >= engineEnd - 30_000) break;

        const [taskA, taskB] = WORKER_ROUNDS[roundIdx];

        const isFirstBatch = superBatchCount === 1;
        const remainingMs = engineEnd - Date.now();
        const remainingRounds = WORKER_ROUNDS.length - roundIdx;
        const workerTimeLimit = isFirstBatch
          ? Math.min(MAX_WORKER_TIME, Math.floor(remainingMs / remainingRounds))
          : MIN_WORKER_TIME;

        const statusDetail = taskB
          ? `Phase 5: ${taskA} + ${taskB} (${Math.round(workerTimeLimit / 1000)}s)`
          : `Phase 5: ${taskA} (${Math.round(workerTimeLimit / 1000)}s)`;
        await setDaemonStatus(pool, "calculating", statusDetail);

        const workers: Promise<WorkerResult>[] = [
          runCalcWorker(taskA as "knife", workerTimeLimit, cycleStarted, taskDiscoveryFile[taskA]),
        ];
        if (taskB) {
          workers.push(runCalcWorker(taskB as "classified", workerTimeLimit, cycleStarted, taskDiscoveryFile[taskB]));
        }
        const results = await Promise.allSettled(workers);

        // Merge results for each worker
        const taskNames = taskB ? [taskA, taskB] : [taskA];
        for (let i = 0; i < taskNames.length; i++) {
          const r = results[i];
          const taskName = taskNames[i];
          const tradeUpType = TASK_TYPE_MAP[taskName];

          if (r.status === "fulfilled" && r.value.tradeUps.length > 0) {
            const tradeUps = r.value.tradeUps;
            const wStats = r.value.stats;
            const profitable = tradeUps.filter(t => t.profit_cents > 0);

            await mergeTradeUps(pool, tradeUps, tradeUpType);

            // Check for new all-time records and fire Discord alerts (post-merge, uses DB data)
            try {
              const { getRedis } = await import("../redis.js");
              const redis = getRedis();
              if (redis) {
                await checkAndFireAlerts(pool, redis, tradeUpType);
              }
            } catch (e: any) {
              console.error(`    Alert check failed: ${e.message}`);
            }

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
            if (wStats) {
              console.log(`      structured ${wStats.structuredCount} (${(wStats.structuredMs / 1000).toFixed(1)}s) + explored ${wStats.exploreCount}`);
            }

            if (profitable.length > 0 && (taskName === "knife" || taskName === "classified")) {
              for (const tu of profitable.slice(0, 3)) {
                const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
                console.log(`      $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
              }
            }

            await emitEvent(pool, `${tradeUpType}_calc`, `${profitable.length} profitable, best +$${profitable.length > 0 ? (profitable[0].profit_cents / 100).toFixed(2) : "0.00"}`);
          } else if (r.status === "rejected") {
            console.error(`    ${taskName} failed: ${r.reason?.message}`);
          } else {
            console.log(`    ${taskName}: 0 trade-ups`);
          }
        }
      }

      // Revival between super-batches (CPU-only, no API calls)
      await setDaemonStatus(pool, "calculating", `Phase 5: Revival (batch ${superBatchCount})`);
      const knifeRevival = await reviveStaleTradeUps(pool, revivalKnifeCache, 1000);
      const gunTypes = [
        "classified_covert", "restricted_classified", "milspec_restricted",
        "industrial_milspec", "consumer_industrial",
      ];
      let gunRevived = 0;
      for (const gt of gunTypes) {
        const r = await reviveStaleGunTradeUps(pool, 1000, gt);
        gunRevived += r.revived;
      }
      const batchRevived = gunRevived + knifeRevival.revived;
      totalRevived += batchRevived;
      if (batchRevived > 0) {
        console.log(`    Revival: ${gunRevived} gun (5 types) + ${knifeRevival.revived} knife revived`);
      }

      // Handle expired claims: clear claimed_by, check if listings were actually purchased
      // Uses FOR UPDATE SKIP LOCKED to prevent double-processing with API route
      {
        const client = await pool.connect();
        let expired: { id: number; trade_up_id: number; user_id: string }[] = [];
        try {
          await client.query('BEGIN');
          const { rows } = await client.query(`
            SELECT id, trade_up_id, user_id FROM trade_up_claims
            WHERE released_at IS NULL AND confirmed_at IS NULL AND expires_at <= NOW()
            FOR UPDATE SKIP LOCKED
          `);
          expired = rows;
          if (expired.length > 0) {
            for (const claim of expired) {
              const { rows: claimListings } = await client.query(
                "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
                [claim.trade_up_id]
              );
              for (const { listing_id } of claimListings) {
                await client.query(
                  "UPDATE listings SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2",
                  [listing_id, claim.user_id]
                );
              }
              await client.query("UPDATE trade_up_claims SET released_at = NOW() WHERE id = $1", [claim.id]);
            }
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        } finally {
          client.release();
        }
        if (expired.length > 0) {
          console.log(`    Expired claims: ${expired.length} released`);
          // Cascade status — unclaimed listings may restore trade-ups to active
          const allExpiredListingIds: string[] = [];
          for (const claim of expired) {
            const { rows: ls } = await pool.query(
              "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
              [claim.trade_up_id]
            );
            for (const { listing_id } of ls) {
              if (!listing_id.startsWith("theor")) allExpiredListingIds.push(listing_id);
            }
          }
          if (allExpiredListingIds.length > 0) {
            await cascadeTradeUpStatuses(pool, allExpiredListingIds);
          }
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
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              for (const lid of confirmedIds) {
                await client.query("DELETE FROM listings WHERE id = $1", [lid]);
              }
              await client.query('COMMIT');
            } catch (txErr) {
              await client.query('ROLLBACK');
              throw txErr;
            } finally {
              client.release();
            }
            // Cascade trade-up statuses for confirmed (deleted) listings
            await cascadeTradeUpStatuses(pool, confirmedIds);
            console.log(`    Confirmed purchases: deleted ${confirmedIds.length} listings`);
          }
        }
      }

      // DMarket staleness (every other super-batch)
      if (dmarketEnabled && superBatchCount % 2 === 0) {
        try {
          const dmResult = await checkDMarketStaleness(pool, {
            maxChecks: 5,
            onProgress: (msg) => setDaemonStatus(pool, "fetching", `DMarket: ${msg}`),
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

    // Clean up pre-materialized discovery files
    await cleanupDiscoveryFiles(discoveryFiles);

    // Post-engine: update collection scores + global trim
    await updateCollectionScores(pool);
    await trimGlobalExcess(pool, 5_000_000);

    console.log(`\n[${timestamp()}] Engine done: ${superBatchCount} super-batches, ${totalKnifeResults} knife + ${totalClassifiedResults} classified, ${totalRevived} revived`);

    // --- Post-engine: coverage, snapshot, Redis, stats ---

    await printCoverageReport(pool);
    console.log(`  API: ${budget.saleCount} sale calls (${budget.saleRemaining} remaining) + ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);

    // Pre-populate Redis cache so API never hits cold DB
    try {
      const cycleTs = new Date().toISOString();
      await setCycleVersion(cycleTs);

      const { rows: [stats] } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM trade_ups WHERE is_theoretical = false) as total_tu,
          (SELECT SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) FROM trade_ups WHERE is_theoretical = false) as profitable_tu,
          (SELECT COUNT(*) FROM listings) as listings,
          (SELECT COUNT(*) FROM price_observations) as sale_obs,
          (SELECT COUNT(*) FROM sale_history) as sale_hist,
          (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as refs,
          (SELECT COUNT(*) FROM daemon_cycle_stats) as cycles
      `);
      await cacheSet("global_stats", {
        total_trade_ups: Number(stats.total_tu),
        profitable_trade_ups: Number(stats.profitable_tu ?? 0),
        total_data_points: Number(stats.listings) + Number(stats.sale_obs) + Number(stats.sale_hist) + Number(stats.refs),
        listings: Number(stats.listings),
        sale_observations: Number(stats.sale_obs),
        sale_history: Number(stats.sale_hist),
        ref_prices: Number(stats.refs),
        total_cycles: Number(stats.cycles),
      }, 60);

      const { rows: inputSkins } = await pool.query("SELECT DISTINCT skin_name as name FROM trade_up_inputs");
      const { rows: outputSkins } = await pool.query(
        `SELECT DISTINCT elem->>'skin_name' as name
         FROM trade_ups t, json_array_elements(t.outcomes_json::json) AS elem
         WHERE t.listing_status = 'active' AND t.is_theoretical = false
           AND t.outcomes_json IS NOT NULL AND t.outcomes_json != '[]'`
      );
      const skinFlags = new Map<string, { input: boolean; output: boolean }>();
      for (const s of inputSkins) skinFlags.set(s.name, { input: true, output: false });
      for (const s of outputSkins) {
        const existing = skinFlags.get(s.name);
        if (existing) existing.output = true;
        else skinFlags.set(s.name, { input: false, output: true });
      }
      const skinMap = [...skinFlags.entries()].map(([name, flags]) => ({
        name, input: flags.input, output: flags.output,
      }));
      const { rows: collections } = await pool.query("SELECT collection_name as name, COUNT(*) as count FROM trade_up_inputs GROUP BY collection_name ORDER BY count DESC");
      const { rows: marketRows } = await pool.query(
        "SELECT source as name, COUNT(DISTINCT trade_up_id) as count FROM trade_up_inputs GROUP BY source ORDER BY count DESC"
      );
      await cacheSet("filter_opts", { skins: skinMap, collections, markets: marketRows }, 600);

      // Invalidate stale trade-up list cache so API shows fresh counts
      const { cacheInvalidatePrefix } = await import("../redis.js");
      await cacheInvalidatePrefix("tu:");

      console.log(`  Redis cache pre-populated`);
    } catch (e) {
      console.error(`  Redis pre-populate failed: ${(e as Error).message}`);
    }

    // Pre-compute /api/status data
    try {
      const { buildStatusData } = await import("../routes/status-helpers.js");
      const statusData = await buildStatusData(pool);
      await cacheSet("status", statusData, 1800);
      console.log("  Status cache pre-warmed");
    } catch (e) {
      console.error(`  Status pre-compute failed: ${(e as Error).message}`);
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
    await saveCycleStats(pool, cycleStats);

    // Take market snapshot for historical analysis
    const snapshotId = await takeSnapshot(pool, {
      cycle: cycleCount,
      type: "covert_knife",
      topN: 25,
      apiRemaining: {
        listing: probe.listingSearch.rateLimit.remaining ?? undefined,
        sale: probe.saleHistory.rateLimit.remaining ?? undefined,
      },
    });
    if (cycleCount % 10 === 0) await purgeOldSnapshots(pool, 30);
    console.log(`  Snapshot #${snapshotId} saved (top 25 trade-ups)`);

    // Log Skinport WebSocket stats (sale observations only)
    const spStats = getSkinportStats();
    if (spStats.totalSaleObservations > 0) {
      console.log(`  Skinport WS: ${spStats.connected ? "connected" : "disconnected"}, ${spStats.totalSaleObservations} sale observations / ${spStats.totalReceived} events`);
    }

    console.log(`\n[${timestamp()}] Cycle ${cycleCount} complete (${(cycleDuration / 60000).toFixed(1)} min)`);
    await printPerformanceComparison(pool);

    // Generate trade-up sitemap for SEO (profitable active trade-ups only)
    try {
      const { rows: tuRows } = await pool.query(`
        SELECT id FROM trade_ups
        WHERE is_theoretical = false AND profit_cents > 0 AND listing_status = 'active'
        ORDER BY profit_cents DESC LIMIT 50000
      `);
      const lastmod = new Date().toISOString().split("T")[0];
      const urls = tuRows.map((r: { id: number }) =>
        `  <url><loc>https://tradeupbot.app/trade-ups/${r.id}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.5</priority></url>`
      ).join("\n");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
      fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "sitemap-tradeups.xml"), xml);
      console.log(`  Sitemap: wrote ${tuRows.length} trade-up URLs to sitemap-tradeups.xml`);
    } catch (e) {
      console.error("  Sitemap generation failed:", e instanceof Error ? e.message : e);
    }

    // Check for queued restart — exit cleanly so PM2 auto-restarts
    if (restartQueued) {
      console.log(`\n[${timestamp()}] Queued restart: exiting after cycle ${cycleCount}`);
      process.exit(0);
    }

    // Sleep until 30-min mark to align with listing pool reset window
    const elapsed = Date.now() - cycleStarted;
    const remaining = TARGET_CYCLE_MS - elapsed;
    if (remaining > 1000) {
      console.log(`  Sleeping ${(remaining / 1000).toFixed(0)}s to align with listing pool reset`);
      await new Promise(r => setTimeout(r, remaining));
    }
  }
}
