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
  computeChanceToProfit,
} from "../engine.js";

const { Pool } = pg;

interface WorkerInput {
  task: "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer";
  timeLimitMs?: number;
  cycleStartedAt?: number;
  discoveryFile?: string;
}

const input = JSON.parse(process.env.CALC_WORKER_DATA!) as WorkerInput;
const { task, timeLimitMs, cycleStartedAt, discoveryFile } = input;
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
const WORKER_MAX_RESULTS = parsePositiveInt(process.env.DAEMON_WORKER_MAX_RESULTS, 30_000);
const SIG_LOAD_LIMIT = parsePositiveInt(process.env.DAEMON_SIG_LOAD_LIMIT, 200_000);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function tradeUpScore(tu: TradeUp): number {
  const ctp = tu.chance_to_profit ?? computeChanceToProfit(tu.outcomes, tu.total_cost_cents);
  return tu.profit_cents + (ctp > 0.25 ? ctp * 5000 : 0);
}

function capTradeUps(tradeUps: TradeUp[], maxResults: number): TradeUp[] {
  if (tradeUps.length <= maxResults) return tradeUps;
  const profitable = tradeUps.filter(t => t.profit_cents > 0);
  const highChance = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) >= 0.25);
  const rest = tradeUps.filter(t => t.profit_cents <= 0 && (t.chance_to_profit ?? 0) < 0.25);
  rest.sort((a, b) => tradeUpScore(b) - tradeUpScore(a));
  return [...profitable, ...highChance, ...rest].slice(0, maxResults);
}

async function sendAndExit(msg: { ok: boolean; tradeUps?: unknown[]; error?: string; stats?: unknown }) {
  try {
    const { clearDiscoveryCache } = await import("../engine.js");
    clearDiscoveryCache();
  } catch {
    // Best-effort cleanup before process exit
  }
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
const typeMap: Record<string, string> = {
  knife: "covert_knife",
  classified: "classified_covert",
  restricted: "restricted_classified",
  milspec: "milspec_restricted",
  industrial: "industrial_milspec",
  consumer: "consumer_industrial",
};

// Rarity map for gun tiers
const rarityMap: Record<string, string> = {
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
    const tradeUpType = typeMap[task] ?? "classified_covert";
    const existingSigs = new Set<string>();
    const sigClient = await pool.connect();
    try {
      await sigClient.query("SET statement_timeout = '30000'");
      const { rows: sigRows } = await sigClient.query<{ ids: string }>(`
        WITH recent_tradeups AS (
          SELECT id
          FROM trade_ups
          WHERE type = $1 AND is_theoretical = false
          ORDER BY id DESC
          LIMIT $2
        )
        SELECT STRING_AGG(tui.listing_id::text, ',' ORDER BY tui.listing_id) as ids
        FROM trade_up_inputs tui
        JOIN recent_tradeups rt ON rt.id = tui.trade_up_id
        GROUP BY tui.trade_up_id
      `, [tradeUpType, SIG_LOAD_LIMIT]);
      for (const row of sigRows) {
        if (row.ids) existingSigs.add(row.ids);
      }
      if (existingSigs.size >= SIG_LOAD_LIMIT) {
        console.log(`  [${task}] sig load capped at ${SIG_LOAD_LIMIT.toLocaleString()} entries`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${task}] sig load failed (${Date.now() - workerStart}ms): ${msg} — skipping dedup`);
    } finally {
      sigClient.release();
    }
    const sigMs = Date.now() - workerStart;
    const memAfter = process.memoryUsage();
    console.log(`  Loaded ${existingSigs.size} existing signatures for ${task} (${sigMs}ms, rss=${(memAfter.rss / 1024 / 1024).toFixed(0)}MB)`);

    // Phase 1: Structured discovery
    const structuredStart = Date.now();
    let tradeUps: TradeUp[] = [];

    // Give structured discovery 60% of the time budget, leave 40% for exploration
    const structuredDeadline = deadline ? Date.now() + Math.floor((deadline - Date.now()) * 0.6) : undefined;

    switch (task) {
      case "knife":
        tradeUps = await findProfitableKnifeTradeUps(pool, {
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
          limit: WORKER_MAX_RESULTS,
        });
        break;

      case "classified":
        tradeUps = await findProfitableTradeUps(pool, {
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
          preferHighFloat: true,
          limit: WORKER_MAX_RESULTS,
          hardLimit: WORKER_MAX_RESULTS,
          maxPerSignature: 30,
        });
        break;

      case "restricted":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Restricted"],
          limit: WORKER_MAX_RESULTS,
          hardLimit: WORKER_MAX_RESULTS,
          maxPerSignature: 30,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
          preferHighFloat: true,
        });
        break;

      case "milspec":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Mil-Spec"],
          limit: WORKER_MAX_RESULTS,
          hardLimit: WORKER_MAX_RESULTS,
          maxPerSignature: 30,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;

      case "industrial":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Industrial Grade"],
          limit: WORKER_MAX_RESULTS,
          hardLimit: WORKER_MAX_RESULTS,
          maxPerSignature: 30,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;

      case "consumer":
        tradeUps = await findProfitableTradeUps(pool, {
          rarities: ["Consumer Grade"],
          limit: WORKER_MAX_RESULTS,
          hardLimit: WORKER_MAX_RESULTS,
          maxPerSignature: 30,
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;
    }

    tradeUps = capTradeUps(tradeUps, WORKER_MAX_RESULTS);
    const structuredMs = Date.now() - structuredStart;
    const structuredCount = tradeUps.length;

    // Phase 2: Deep exploration with remaining time
    let exploreCount = 0;
    const remainingResultBudget = Math.max(WORKER_MAX_RESULTS - structuredCount, 0);
    if (deadline && Date.now() < deadline - 5000 && remainingResultBudget > 0) {
      const exploreStart = Date.now();

      let explored: TradeUp[];
      if (task === "knife") {
        explored = await exploreKnifeWithBudget(pool, deadline, existingSigs, {
          cycleStartedAt,
          onProgress: (msg) => console.log(`  ${msg}`),
          maxResults: remainingResultBudget,
        });
      } else {
        const inputRarity = rarityMap[task] ?? "Classified";
        const preferHighFloat = task === "classified" || task === "restricted";
        explored = await exploreWithBudget(pool, deadline, existingSigs, {
          inputRarity,
          cycleStartedAt,
          preferHighFloat,
          onProgress: (msg) => console.log(`  ${msg}`),
          maxResults: remainingResultBudget,
        });
      }

      exploreCount = explored.length;
      const exploreMs = Date.now() - exploreStart;
      console.log(`  ${task}: structured ${structuredCount} (${(structuredMs / 1000).toFixed(1)}s) + explored ${exploreCount} (${(exploreMs / 1000).toFixed(1)}s)`);

      // Combine results
      tradeUps = capTradeUps([...tradeUps, ...explored], WORKER_MAX_RESULTS);
    } else {
      const reason = remainingResultBudget <= 0 ? "result cap reached" : "no time for exploration";
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
