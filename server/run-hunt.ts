import { initDb } from "./db.js";
import { huntBudgetRange } from "./engine.js";

const db = initDb();
console.log("Running budget hunt $150-350...");
const result = huntBudgetRange(db, {
  minCostCents: 15000,
  maxCostCents: 35000,
  iterations: 10000,
  onProgress: (msg) => console.log(msg),
});
console.log("Done:", result);

// Show best finds
const best = db.prepare(`
  SELECT t.id, t.total_cost_cents, t.profit_cents, t.chance_to_profit, t.best_case_cents, t.worst_case_cents
  FROM trade_ups t
  WHERE t.type = 'covert_knife' AND t.profit_cents > 0
    AND t.total_cost_cents >= 15000 AND t.total_cost_cents <= 35000
  ORDER BY t.chance_to_profit DESC LIMIT 10
`).all() as { id: number; total_cost_cents: number; profit_cents: number; chance_to_profit: number; best_case_cents: number; worst_case_cents: number }[];
console.log("\nTop by chance-to-profit in $150-350 budget:");
for (const t of best) {
  console.log(`  #${t.id}: Cost $${(t.total_cost_cents/100).toFixed(2)}, Profit $${(t.profit_cents/100).toFixed(2)}, Chance ${(t.chance_to_profit*100).toFixed(1)}%, Best +$${(t.best_case_cents/100).toFixed(2)}, Worst $${(t.worst_case_cents/100).toFixed(2)}`);
}

const bestUpside = db.prepare(`
  SELECT t.id, t.total_cost_cents, t.profit_cents, t.chance_to_profit, t.best_case_cents, t.worst_case_cents
  FROM trade_ups t
  WHERE t.type = 'covert_knife' AND t.profit_cents > 0
    AND t.total_cost_cents >= 15000 AND t.total_cost_cents <= 35000
  ORDER BY t.best_case_cents DESC LIMIT 10
`).all() as typeof best;
console.log("\nTop by upside in $150-350 budget:");
for (const t of bestUpside) {
  console.log(`  #${t.id}: Cost $${(t.total_cost_cents/100).toFixed(2)}, Profit $${(t.profit_cents/100).toFixed(2)}, Chance ${(t.chance_to_profit*100).toFixed(1)}%, Best +$${(t.best_case_cents/100).toFixed(2)}, Worst $${(t.worst_case_cents/100).toFixed(2)}`);
}
