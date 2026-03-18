/**
 * Worker process for parallel trade-up discovery.
 *
 * Runs CPU-intensive discovery functions in a child process (via fork()).
 * Opens its own read-only DB connection — discovery only reads.
 * Receives task config via env var, sends results via IPC or temp file.
 *
 * Using child_process.fork() instead of worker_threads because tsx's
 * ESM loader hooks aren't inherited by worker threads in Node.js v24.
 */
import Database from "better-sqlite3";
import { writeFileSync, createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findProfitableKnifeTradeUps, findProfitableTradeUps } from "../engine.js";

interface WorkerInput {
  task: "knife" | "classified" | "restricted" | "milspec" | "industrial" | "consumer";
  dbPath: string;
  extraTransitionPoints?: number[];
}

const input = JSON.parse(process.env.CALC_WORKER_DATA!) as WorkerInput;
const { task, dbPath, extraTransitionPoints } = input;

// Read-only connection — discovery functions only read from DB
const db = new Database(dbPath, { readonly: true });

// IPC has payload limits (~200MB but serialization overhead makes large arrays fail).
// For results >5000 trade-ups, write to a temp file and send the path instead.
const LARGE_RESULT_THRESHOLD = 5000;

function sendAndExit(msg: { ok: boolean; tradeUps?: unknown[]; error?: string }) {
  db.close();

  if (msg.ok && msg.tradeUps && msg.tradeUps.length > LARGE_RESULT_THRESHOLD) {
    const tmpFile = join(tmpdir(), `calc-worker-${task}-${process.pid}.json`);

    // Stream-write as newline-delimited JSON (NDJSON) to avoid V8 string limit.
    // JSON.stringify of 80K+ trade-ups with outcomes can exceed 512MB.
    // Parent reads line-by-line to avoid the same limit.
    const ws = createWriteStream(tmpFile);
    for (const tu of msg.tradeUps) {
      ws.write(JSON.stringify(tu) + "\n");
    }
    ws.end(() => {
      process.send!({ ok: true, resultFile: tmpFile }, () => {
        process.exit(0);
      });
    });
    return; // Don't fall through — ws.end callback handles exit
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
  let tradeUps;

  switch (task) {
    case "knife":
      tradeUps = findProfitableKnifeTradeUps(db, {
        extraTransitionPoints,
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

  // Cap results to avoid OOM on NDJSON write/read (80K+ knife trade-ups with
  // 60+ outcomes each = several GB). Keep top 30K sorted by profit.
  if (tradeUps && tradeUps.length > 30000) {
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
    tradeUps = tradeUps.slice(0, 30000);
  }

  sendAndExit({ ok: true, tradeUps });
} catch (err) {
  sendAndExit({ ok: false, error: (err as Error).message });
}
