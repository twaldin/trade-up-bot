import { initDb } from "./db.js";
import { findProfitableTradeUps, saveTradeUps } from "./engine.js";

const db = initDb();

console.log("Finding profitable trade-ups...");
const tradeUps = findProfitableTradeUps(db, { limit: 1000 });
console.log(`Found ${tradeUps.length} trade-ups`);

if (tradeUps.length > 0) {
  saveTradeUps(db, tradeUps);
  console.log("Saved to database");

  console.log("\n=== Top 10 Trade-Ups ===");
  for (const tu of tradeUps.slice(0, 10)) {
    console.log(
      `\nCost: $${(tu.total_cost_cents / 100).toFixed(2)} | ` +
        `EV: $${(tu.expected_value_cents / 100).toFixed(2)} | ` +
        `Profit: $${(tu.profit_cents / 100).toFixed(2)} | ` +
        `ROI: ${tu.roi_percentage.toFixed(1)}%`
    );
    console.log(`  Inputs: ${tu.inputs.map((i) => `${i.skin_name} ($${(i.price_cents / 100).toFixed(2)})`).join(", ")}`);
    console.log(
      `  Outcomes: ${tu.outcomes.map((o) => `${o.skin_name} ${o.predicted_condition} (${(o.probability * 100).toFixed(1)}% @ $${(o.estimated_price_cents / 100).toFixed(2)})`).join(", ")}`
    );
  }
} else {
  console.log("No profitable trade-ups found. Try syncing data first: npm run sync");
}
