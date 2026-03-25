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
import {
  findProfitableKnifeTradeUps,
  findProfitableTradeUps,
  exploreWithBudget,
  exploreKnifeWithBudget,
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
  || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot";
const pool = new Pool({
  connectionString,
  max: 3,
  idleTimeoutMillis: 10_000,
});

// IPC has payload limits (~200MB but serialization overhead makes large arrays fail).
// For results >5000 trade-ups, write to a temp file and send the path instead.
const LARGE_RESULT_THRESHOLD = 5000;

async function sendAndExit(msg: { ok: boolean; tradeUps?: unknown[]; error?: string; stats?: unknown }) {
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

    // Load existing listing signatures so discovery skips combos already in DB
    const tradeUpType = typeMap[task] ?? "classified_covert";
    const existingSigs = new Set<string>();
    const { rows: sigRows } = await pool.query(`
      SELECT trade_up_id, STRING_AGG(listing_id::text, ',' ORDER BY listing_id) as ids
      FROM trade_up_inputs WHERE trade_up_id IN (
        SELECT id FROM trade_ups WHERE type = $1 AND is_theoretical = false
      ) GROUP BY trade_up_id
    `, [tradeUpType]);
    for (const row of sigRows) {
      existingSigs.add(row.ids.split(",").sort().join(","));
    }
    const sigMs = Date.now() - workerStart;
    console.log(`  Loaded ${existingSigs.size} existing signatures for ${task} (${sigMs}ms)`);

    // Phase 1: Structured discovery
    const structuredStart = Date.now();
    let tradeUps;

    // Give structured discovery 60% of the time budget, leave 40% for exploration
    const structuredDeadline = deadline ? Date.now() + Math.floor((deadline - Date.now()) * 0.6) : undefined;

    switch (task) {
      case "knife":
        tradeUps = await findProfitableKnifeTradeUps(pool, {
          existingSignatures: existingSigs,
          deadlineMs: structuredDeadline,
        });
        break;

      case "classified":
        tradeUps = await findProfitableTradeUps(pool, { existingSignatures: existingSigs, deadlineMs: structuredDeadline, preferHighFloat: true });
        break;

      case "restricted":
        tradeUps = await findProfitableTradeUps(pool, { rarities: ["Restricted"], limit: 50000, existingSignatures: existingSigs, deadlineMs: structuredDeadline, preferHighFloat: true });
        break;

      case "milspec":
        tradeUps = await findProfitableTradeUps(pool, { rarities: ["Mil-Spec"], limit: 50000, existingSignatures: existingSigs, deadlineMs: structuredDeadline });
        break;

      case "industrial":
        tradeUps = await findProfitableTradeUps(pool, { rarities: ["Industrial Grade"], limit: 50000, existingSignatures: existingSigs, deadlineMs: structuredDeadline });
        break;

      case "consumer":
        tradeUps = await findProfitableTradeUps(pool, { rarities: ["Consumer Grade"], limit: 50000, existingSignatures: existingSigs, deadlineMs: structuredDeadline });
        break;
    }

    const structuredMs = Date.now() - structuredStart;
    const structuredCount = tradeUps?.length ?? 0;

    // Add structured results to sig set so exploration doesn't rediscover them
    for (const tu of tradeUps ?? []) {
      existingSigs.add(tu.inputs.map(i => i.listing_id).sort().join(","));
    }

    // Phase 2: Deep exploration with remaining time
    let exploreCount = 0;
    if (deadline && Date.now() < deadline - 5000) {
      const exploreStart = Date.now();

      let explored: typeof tradeUps;
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
      tradeUps = [...(tradeUps ?? []), ...explored];
    } else {
      console.log(`  ${task}: structured ${structuredCount} (${(structuredMs / 1000).toFixed(1)}s), no time for exploration`);
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
