/**
 * Worker process for parallel trade-up discovery.
 *
 * Runs CPU-intensive discovery functions in a child process (via fork()).
 * Opens its own read-only DB connection — discovery only reads.
 * Receives task config via env var, sends results via IPC.
 *
 * Using child_process.fork() instead of worker_threads because tsx's
 * ESM loader hooks aren't inherited by worker threads in Node.js v24.
 */
import Database from "better-sqlite3";
import { findProfitableKnifeTradeUps, findProfitableTradeUps } from "../engine.js";

interface WorkerInput {
  task: "knife" | "classified" | "stattrak";
  dbPath: string;
  extraTransitionPoints?: number[];
}

const input = JSON.parse(process.env.CALC_WORKER_DATA!) as WorkerInput;
const { task, dbPath, extraTransitionPoints } = input;

// Read-only connection — discovery functions only read from DB
const db = new Database(dbPath, { readonly: true });

function sendAndExit(msg: { ok: boolean; tradeUps?: unknown[]; error?: string }) {
  db.close();
  // Use callback to ensure message is flushed before exit
  process.send!(msg, () => {
    process.exit(0);
  });
}

try {
  let tradeUps;

  switch (task) {
    case "knife":
      tradeUps = findProfitableKnifeTradeUps(db, {
        extraTransitionPoints,
      });
      break;

    case "classified":
      tradeUps = findProfitableTradeUps(db);
      break;

    case "stattrak": {
      // Check if ST listings exist before heavy computation
      const count = (db.prepare(`
        SELECT COUNT(*) as c FROM listings l
        JOIN skins s ON l.skin_id = s.id
        WHERE s.rarity = 'Classified' AND l.stattrak = 1
      `).get() as { c: number }).c;

      tradeUps = count > 0
        ? findProfitableTradeUps(db, { stattrak: true })
        : [];
      break;
    }
  }

  sendAndExit({ ok: true, tradeUps });
} catch (err) {
  sendAndExit({ ok: false, error: (err as Error).message });
}
