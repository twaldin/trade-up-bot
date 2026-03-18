/**
 * One-off script: find and remove duplicate trade-ups (same listing IDs).
 * Keeps the oldest entry (lowest ID), deletes the rest.
 */
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "tradeup.db");
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 30000");

// Step 1: Build signature → [trade_up_ids] map
console.log("Scanning for duplicate trade-ups...");
const allTus = db.prepare(`
  SELECT t.id FROM trade_ups t WHERE t.is_theoretical = 0
`).all() as { id: number }[];

const getInputIds = db.prepare(
  "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = ? ORDER BY listing_id"
);

const sigMap = new Map<string, number[]>(); // sig → [tu_ids]
for (const tu of allTus) {
  const ids = getInputIds.all(tu.id) as { listing_id: string }[];
  const sig = ids.map(r => r.listing_id).join(",");
  const existing = sigMap.get(sig);
  if (existing) existing.push(tu.id);
  else sigMap.set(sig, [tu.id]);
}

// Step 2: Find duplicates
const duplicateGroups: { keep: number; remove: number[] }[] = [];
for (const [_sig, ids] of sigMap) {
  if (ids.length > 1) {
    ids.sort((a, b) => a - b); // keep lowest ID (oldest)
    duplicateGroups.push({ keep: ids[0], remove: ids.slice(1) });
  }
}

const totalDupes = duplicateGroups.reduce((s, g) => s + g.remove.length, 0);
console.log(`Found ${duplicateGroups.length} duplicate groups (${totalDupes} trade-ups to remove)`);

if (totalDupes === 0) {
  console.log("No duplicates found.");
  db.close();
  process.exit(0);
}

// Show sample
for (const g of duplicateGroups.slice(0, 5)) {
  console.log(`  Keep #${g.keep}, remove: ${g.remove.join(", ")}`);
}

// Step 3: Delete duplicates
const deleteInputs = db.prepare("DELETE FROM trade_up_inputs WHERE trade_up_id = ?");
const deleteTu = db.prepare("DELETE FROM trade_ups WHERE id = ?");

const deleteTx = db.transaction(() => {
  for (const g of duplicateGroups) {
    for (const id of g.remove) {
      deleteInputs.run(id);
      deleteTu.run(id);
    }
  }
});

deleteTx();
console.log(`Deleted ${totalDupes} duplicate trade-ups.`);

db.close();
