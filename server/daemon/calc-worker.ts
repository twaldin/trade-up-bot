/**
 * Worker process for parallel trade-up discovery.
 *
 * Runs CPU-intensive discovery functions in a child process (via fork()).
 * Opens its own read-only DB connection — discovery only reads.
 * Receives task config via env var, sends results via IPC or temp file.
 *
 * Time-bounded: runs structured discovery first (fast with sig-skipping),
 * then switches to deep random exploration until timeLimitMs expires.
 *
 * Using child_process.fork() instead of worker_threads because tsx's
 * ESM loader hooks aren't inherited by worker threads in Node.js v24.
 */
import Database from "better-sqlite3";
import { createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  findProfitableKnifeTradeUps,
  findProfitableTradeUps,
  exploreWithBudget,
  exploreKnifeWithBudget,
} from "../engine.js";

interface WorkerInput {
  task: "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer";
  dbPath: string;
  timeLimitMs?: number;
}

const input = JSON.parse(process.env.CALC_WORKER_DATA!) as WorkerInput;
const { task, dbPath, timeLimitMs } = input;
const deadline = timeLimitMs ? Date.now() + timeLimitMs : undefined;

// Read-only connection — discovery functions only read from DB
const db = new Database(dbPath, { readonly: true });

// IPC has payload limits (~200MB but serialization overhead makes large arrays fail).
// For results >5000 trade-ups, write to a temp file and send the path instead.
const LARGE_RESULT_THRESHOLD = 5000;

function sendAndExit(msg: { ok: boolean; tradeUps?: unknown[]; error?: string; stats?: unknown }) {
  db.close();

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

// Load existing listing signatures so discovery skips combos already in DB
const tradeUpType = typeMap[task] ?? "classified_covert";
const existingSigs = new Set<string>();
const sigRows = db.prepare(`
  SELECT trade_up_id, GROUP_CONCAT(listing_id) as ids
  FROM trade_up_inputs WHERE trade_up_id IN (
    SELECT id FROM trade_ups WHERE type = ? AND is_theoretical = 0
  ) GROUP BY trade_up_id
`).all(tradeUpType) as { trade_up_id: number; ids: string }[];
for (const row of sigRows) {
  existingSigs.add(row.ids.split(",").sort().join(","));
}
console.log(`  Loaded ${existingSigs.size} existing signatures for ${task}`);

try {
  // Phase 1: Structured discovery
  const structuredStart = Date.now();
  let tradeUps;

  switch (task) {
    case "knife":
      tradeUps = findProfitableKnifeTradeUps(db, {
        existingSignatures: existingSigs,
      });
      break;

    case "classified":
      tradeUps = findProfitableTradeUps(db, { existingSignatures: existingSigs });
      break;

    case "restricted":
      tradeUps = findProfitableTradeUps(db, { rarities: ["Restricted"], limit: 50000, existingSignatures: existingSigs });
      break;

    case "milspec":
      tradeUps = findProfitableTradeUps(db, { rarities: ["Mil-Spec"], limit: 50000, existingSignatures: existingSigs });
      break;

    case "industrial":
      tradeUps = findProfitableTradeUps(db, { rarities: ["Industrial Grade"], limit: 50000, existingSignatures: existingSigs });
      break;

    case "consumer":
      tradeUps = findProfitableTradeUps(db, { rarities: ["Consumer Grade"], limit: 50000, existingSignatures: existingSigs });
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
      explored = exploreKnifeWithBudget(db, deadline, existingSigs, {
        onProgress: (msg) => console.log(`  ${msg}`),
      });
    } else {
      const inputRarity = rarityMap[task] ?? "Classified";
      explored = exploreWithBudget(db, deadline, existingSigs, {
        inputRarity,
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

  // Cap results to avoid OOM on NDJSON write/read (80K+ knife trade-ups with
  // 60+ outcomes each = several GB). Keep top 30K sorted by profit.
  if (tradeUps && tradeUps.length > 30000) {
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
    tradeUps = tradeUps.slice(0, 30000);
  }

  sendAndExit({
    ok: true,
    tradeUps,
    stats: { structuredCount, exploreCount, structuredMs },
  });
} catch (err) {
  sendAndExit({ ok: false, error: (err as Error).message });
}
