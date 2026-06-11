/**
 * Per-cycle signature file helpers for worker precompute (plan 019).
 *
 * The main daemon writes one file per trade-up type before forking workers.
 * Workers read it via loadSigsFromFile() instead of querying PG directly,
 * eliminating the sig-load DB race and the 8–174s timeout feedback loop.
 *
 * File format: one signature per line (sorted listing IDs joined by comma).
 * Empty lines are ignored. No header.
 */

import { createReadStream, createWriteStream } from "fs";
import { createInterface } from "readline";

/**
 * Load existing trade-up signatures from a pre-written file.
 * Returns a Set<string> suitable for seeding TradeUpStore.
 * Each line is a signature (sorted listing IDs joined by comma).
 * Blank lines are ignored.
 */
export async function loadSigsFromFile(filePath: string): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const sigs = new Set<string>();
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });
    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (trimmed) sigs.add(trimmed);
    });
    rl.on("close", () => resolve(sigs));
    rl.on("error", reject);
  });
}

/**
 * Write a set of signatures to a file (one per line).
 * Used by the main daemon before forking workers.
 */
export async function writeSignatureFile(filePath: string, sigs: Set<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(filePath);
    ws.on("error", reject);
    ws.on("finish", resolve);
    for (const sig of sigs) {
      ws.write(sig + "\n");
    }
    ws.end();
  });
}
