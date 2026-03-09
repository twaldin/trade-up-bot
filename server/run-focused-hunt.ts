import { initDb } from "./db.js";
import { huntBudgetRange } from "./engine.js";

const db = initDb();

// Run multiple focused hunts with different budget ranges
const hunts = [
  { name: "$200-300 (sweet spot)", min: 20000, max: 30000, iters: 30000 },
  { name: "$150-200 (cheap)", min: 15000, max: 20000, iters: 15000 },
  { name: "$300-500 (premium)", min: 30000, max: 50000, iters: 15000 },
];

for (const hunt of hunts) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Hunting ${hunt.name}...`);
  console.log("=".repeat(60));
  const result = huntBudgetRange(db, {
    minCostCents: hunt.min,
    maxCostCents: hunt.max,
    iterations: hunt.iters,
    onProgress: (msg) => console.log(msg),
  });
  console.log(`Result: ${result.found} found, ${result.explored} explored`);
}

// Summary of all profitable knife trade-ups
const ranges = [
  { label: "$150-200", min: 15000, max: 20000 },
  { label: "$200-300", min: 20000, max: 30000 },
  { label: "$300-500", min: 30000, max: 50000 },
];

console.log("\n" + "=".repeat(60));
console.log("SUMMARY OF ALL PROFITABLE KNIFE TRADE-UPS");
console.log("=".repeat(60));

for (const range of ranges) {
  const best = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.profit_cents, t.chance_to_profit, t.best_case_cents, t.worst_case_cents
    FROM trade_ups t
    WHERE t.type = 'covert_knife' AND t.profit_cents > 0
      AND t.total_cost_cents >= ? AND t.total_cost_cents <= ?
    ORDER BY t.chance_to_profit DESC LIMIT 5
  `).all(range.min, range.max) as any[];

  const bestUpside = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.profit_cents, t.chance_to_profit, t.best_case_cents, t.worst_case_cents
    FROM trade_ups t
    WHERE t.type = 'covert_knife' AND t.profit_cents > 0
      AND t.total_cost_cents >= ? AND t.total_cost_cents <= ?
    ORDER BY t.best_case_cents DESC LIMIT 5
  `).all(range.min, range.max) as any[];

  const count = db.prepare(`
    SELECT COUNT(*) as c FROM trade_ups
    WHERE type = 'covert_knife' AND profit_cents > 0
      AND total_cost_cents >= ? AND total_cost_cents <= ?
  `).get(range.min, range.max) as { c: number };

  console.log(`\n--- ${range.label} (${count.c} profitable) ---`);
  console.log("Top by chance:");
  for (const t of best) {
    console.log(`  #${t.id}: $${(t.total_cost_cents/100).toFixed(0)} cost, ${(t.chance_to_profit*100).toFixed(1)}% chance, +$${(t.best_case_cents/100).toFixed(0)} best, $${(t.worst_case_cents/100).toFixed(0)} worst`);
  }
  console.log("Top by upside:");
  for (const t of bestUpside) {
    console.log(`  #${t.id}: $${(t.total_cost_cents/100).toFixed(0)} cost, ${(t.chance_to_profit*100).toFixed(1)}% chance, +$${(t.best_case_cents/100).toFixed(0)} best, $${(t.worst_case_cents/100).toFixed(0)} worst`);
  }
}
