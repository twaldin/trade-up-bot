/**
 * Worker process for parallel trade-up discovery.
 *
 * Runs CPU-intensive discovery functions in a child process (via fork()).
 * Opens its own PG Pool connection — discovery only reads.
 * Receives task config via env var, sends results via IPC or temp file.
 *
 * Time-bounded: runs structured discovery first (fast with sig-skipping),
 * then switches to deep random exploration until timeLimitMs expires.
 *
 * Using child_process.fork() instead of worker_threads because tsx's
 * ESM loader hooks aren't inherited by worker threads in Node.js v24.
 */
import pg from "pg";
import { createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TradeUp } from "../../shared/types.js";
import {
  findProfitableKnifeTradeUps,
  findProfitableTradeUps,
  exploreWithBudget,
  exploreKnifeWithBudget,
} from "../engine.js";

const { Pool } = pg;

type WorkerTask = "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer";

interface WorkerInput {
  task: WorkerTask;
  timeLimitMs?: number;
  cycleStartedAt?: number;
  discoveryFile?: string;
  safeMode?: boolean;
}

const input = JSON.parse(process.env.CALC_WORKER_DATA!) as WorkerInput;
const { task, timeLimitMs, cycleStartedAt, discoveryFile, safeMode = false } = input;
const deadline = timeLimitMs ? Date.now() + timeLimitMs : undefined;

// Create own PG pool — worker needs its own connection
const connectionString = process.env.DATABASE_URL
  || "postgresql://localhost:5432/tradeupbot";
const pool = new Pool({
  connectionString,
  max: 3,
  idleTimeoutMillis: 10_000,
});

// IPC has payload limits (~200MB but serialization overhead makes large arrays fail).
// For results >5000 trade-ups, write to a temp file and send the path instead.
const LARGE_RESULT_THRESHOLD = 5000;

const STRUCTURED_LIMITS: Record<WorkerTask, number> = {
  knife: 30000,
  classified: 30000,
  restricted: 30000,
  milspec: 15000,
  industrial: 12000,
  consumer: 10000,
};

const SAFE_STRUCTURED_LIMITS: Record<WorkerTask, number> = {
  knife: 15000,
  classified: 15000,
  restricted: 12000,
  milspec: 8000,
  industrial: 6000,
  consumer: 5000,
};

const SIG_LOAD_LIMITS: Record<WorkerTask, number> = {
  knife: 120000,
  classified: 120000,
  restricted: 100000,
  milspec: 80000,
  industrial: 70000,
  consumer: 60000,
};

const SAFE_SIG_LOAD_LIMITS: Record<WorkerTask, number> = {
  knife: 60000,
  classified: 60000,
  restricted: 50000,
  milspec: 40000,
  industrial: 35000,
  consumer: 30000,
};

const RESULT_CAPS: Record<WorkerTask, number> = {
  knife: 12000,
  classified: 18000,
  restricted: 18000,
  milspec: 10000,
  industrial: 8000,
  consumer: 6000,
};

const SAFE_RESULT_CAPS: Record<WorkerTask, number> = {
  knife: 7000,
  classified: 10000,
  restricted: 9000,
  milspec: 6000,
  industrial: 5000,
  consumer: 4000,
};

function capTradeUpsForTask(taskName: WorkerTask, tradeUps: TradeUp[], isSafeMode: boolean): TradeUp[] {
  const cap = isSafeMode ? SAFE_RESULT_CAPS[taskName] : RESULT_CAPS[taskName];
  if (tradeUps.length <= cap) return tradeUps;

  const ranked = [...tradeUps];
  ranked.sort((a, b) => {
    const aProfitable = a.profit_cents > 0 ? 1 : 0;
    const bProfitable = b.profit_cents > 0 ? 1 : 0;
    if (bProfitable !== aProfitable) return bProfitable - aProfitable;

    const aHighChance = (a.chance_to_profit ?? 0) >= 0.25 ? 1 : 0;
    const bHighChance = (b.chance_to_profit ?? 0) >= 0.25 ? 1 : 0;
    if (bHighChance !== aHighChance) return bHighChance - aHighChance;

    if (b.profit_cents !== a.profit_cents) return b.profit_cents - a.profit_cents;

    const aChance = a.chance_to_profit ?? 0;
    const bChance = b.chance_to_profit ?? 0;
    if (bChance !== aChance) return bChance - aChance;

    if (b.roi_percentage !== a.roi_percentage) return b.roi_percentage - a.roi_percentage;
    return a.total_cost_cents - b.total_cost_cents;
  });
  return ranked.slice(0, cap);
}

async function sendAndExit(msg: { ok: boolean; tradeUps?: TradeUp[]; error?: string; stats?: unknown }) {
  await pool.end();

  if (msg.ok && msg.tradeUps && msg.tradeUps.length > LARGE_RESULT_THRESHOLD) {
    const tmpFile = join(tmpdir(), `calc-worker-${task}-${process.pid}.json`);

    // Stream-write as newline-delimited JSON (NDJSON) to avoid V8 string limit.
    const ws = createWriteStream(tmpFile);
    for (const tu of msg.tradeUps) {
      ws.write(JSON.stringify(tu) + "\n");
    }
    ws.end(() => {
      process.send!({ ok: true, resultFile: tmpFile, stats: msg.stats }, () => {
        process.exit(0);
      });
    });
    return;
  }

  process.send!(msg, () => {
    process.exit(0);
  });
}

// Map worker task name to trade_ups.type for signature loading
const typeMap: Record<WorkerTask, string> = {
  knife: "covert_knife",
  classified: "classified_covert",
  restricted: "restricted_classified",
  milspec: "milspec_restricted",
  industrial: "industrial_milspec",
  consumer: "consumer_industrial",
};

// Rarity map for gun tiers
const rarityMap: Record<Exclude<WorkerTask, "knife">, string> = {
  classified: "Classified",
  restricted: "Restricted",
  milspec: "Mil-Spec",
  industrial: "Industrial Grade",
  consumer: "Consumer Grade",
};

// Wrap in async IIFE since we need await for PG queries
(async () => {
  try {
    const workerStart = Date.now();

    // Pre-load discovery data from NDJSON file if available (avoids PG query + KNN scoring)
    if (discoveryFile) {
      const { loadDiscoveryDataFromFile } = await import("../engine.js");
      await loadDiscoveryDataFromFile(discoveryFile);
    }

    // Log memory before heavy signature load (helps diagnose OOM — see GH #22)
    const memBefore = process.memoryUsage();
    console.log(`  [${task}] pre-sig rss=${(memBefore.rss / 1024 / 1024).toFixed(0)}MB heap=${(memBefore.heapUsed / 1024 / 1024).toFixed(0)}MB`);

    // Load existing listing signatures so discovery skips combos already in DB.
    // Uses a dedicated client with statement_timeout to prevent runaway queries (GH #22:
    // knife sig load took 174s vs normal 8s, likely due to DB pressure with no escape hatch).
    const tradeUpType = typeMap[task];
    const sigLimit = safeMode ? SAFE_SIG_LOAD_LIMITS[task] : SIG_LOAD_LIMITS[task];
    const existingSigs = new Set<string>();
    const sigClient = await pool.connect();
    try {
      await sigClient.query("SET statement_timeout = '30000'");
      const { rows: sigRows } = await sigClient.query(`
        SELECT STRING_AGG(tui.listing_id::text, ',' ORDER BY tui.listing_id) as ids
        FROM trade_up_inputs tui
        WHERE tui.trade_up_id IN (
          SELECT id
          FROM trade_ups
          WHERE type = $1 AND is_theoretical = false
          ORDER BY (listing_status = 'active') DESC, profit_cents DESC, id DESC
          LIMIT $2
        )
        GROUP BY tui.trade_up_id
      `, [tradeUpType, sigLimit]);
      for (const row of sigRows) {
        if (typeof row.ids === "string" && row.ids.length > 0) {
          // Already canonical because query aggregates listing_id in sorted order.
          existingSigs.add(row.ids);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${task}] sig load failed (${Date.now() - workerStart}ms): ${msg} — skipping dedup`);
    } finally {
      sigClient.release();
    }
    const sigMs = Date.now() - workerStart;
    const memAfter = process.memoryUsage();
    console.log(`  Loaded ${existingSigs.size} existing signatures for ${task} (cap ${sigLimit}, ${sigMs}ms, rss=${(memAfter.rss / 1024 / 1024).toFixed(0)}MB)`);

    // Phase 1: Structured discovery
    const structuredStart = Date.now();
    let tradeUps: TradeUp[] = [];
    const structuredLimit = safeMode ? SAFE_STRUCTURED_LIMITS[task] : STRUCTURED_LIMITS[task];

    // Give structured discovery 60% of the time budget, leave 40% for exploration
    const structuredDeadline = deadline
      ? Date.now() + Math.floor((deadline - Date.now()) * (safeMode ? 0.35 : 0.6))
      : undefined;

    switch (task) {
      case "knife":
        tradeUps = (await findProfitableKnifeTradeUps(pool, {
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        })) ?? [];
        break;

      case "classified":
        tradeUps = await findProfitableTradeUps(pool, {
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
          preferHighFloat: true,
          limit: structuredLimit,
        });
        break;

      case "restricted":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Restricted"],
          limit: structuredLimit,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
          preferHighFloat: true,
        });
        break;

      case "milspec":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Mil-Spec"],
          limit: structuredLimit,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;

      case "industrial":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Industrial Grade"],
          limit: structuredLimit,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;

      case "consumer":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Consumer Grade"],
          limit: structuredLimit,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;
    }

    const structuredRawCount = tradeUps.length;
    tradeUps = capTradeUpsForTask(task, tradeUps, safeMode);
    if (tradeUps.length < structuredRawCount) {
      console.log(`  ${task}: capped structured results ${structuredRawCount} -> ${tradeUps.length}`);
    }

    const structuredMs = Date.now() - structuredStart;
    const structuredCount = structuredRawCount;

    // Add structured results to sig set so exploration doesn't rediscover them
    for (const tu of tradeUps) {
      existingSigs.add(tu.inputs.map(i => i.listing_id).sort().join(","));
    }

    // Phase 2: Deep exploration with remaining time
    let exploreCount = 0;
    if (!safeMode && deadline && Date.now() < deadline - 5000) {
      const exploreStart = Date.now();

      let explored: TradeUp[];
      if (task === "knife") {
        explored = await exploreKnifeWithBudget(pool, deadline, existingSigs, {
          cycleStartedAt,
          onProgress: (msg) => console.log(`  ${msg}`),
        });
      } else {
        const inputRarity = rarityMap[task] ?? "Classified";
        const preferHighFloat = task === "classified" || task === "restricted";
        explored = await exploreWithBudget(pool, deadline, existingSigs, {
          inputRarity,
          cycleStartedAt,
          preferHighFloat,
          onProgress: (msg) => console.log(`  ${msg}`),
        });
      }

      exploreCount = explored.length;
      const exploreMs = Date.now() - exploreStart;
      console.log(`  ${task}: structured ${structuredCount} (${(structuredMs / 1000).toFixed(1)}s) + explored ${exploreCount} (${(exploreMs / 1000).toFixed(1)}s)`);

      // Combine results
      const combined = [...tradeUps, ...explored];
      tradeUps = capTradeUpsForTask(task, combined, safeMode);
      if (tradeUps.length < combined.length) {
        console.log(`  ${task}: capped combined results ${combined.length} -> ${tradeUps.length}`);
      }
    } else {
      const reason = safeMode ? "safe mode" : "no time for exploration";
      console.log(`  ${task}: structured ${structuredCount} (${(structuredMs / 1000).toFixed(1)}s), ${reason}`);
    }

    await sendAndExit({
      ok: true,
      tradeUps,
      stats: { structuredCount, exploreCount, structuredMs },
    });
  } catch (err) {
    await sendAndExit({ ok: false, error: (err as Error).message });
  }
})();
