/**
 * One-shot sale history sync for Covert output pricing.
 * Run: npx tsx server/run-sale-history.ts [maxCalls]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { syncSaleHistory } from "./sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const db = initDb();
const apiKey = process.env.CSFLOAT_API_KEY!;
const maxCalls = parseInt(process.argv[2] ?? "50");

console.log(`Syncing Covert sale history (max ${maxCalls} API calls)...`);

syncSaleHistory(db, {
  apiKey,
  maxCalls,
  onProgress: (msg) => console.log(`  ${msg}`),
}).then((result) => {
  console.log("\nDone:", result);

  const salesCount = (db.prepare("SELECT COUNT(*) as cnt FROM sale_history").get() as any).cnt;
  console.log(`Total sales in DB: ${salesCount}`);

  const prices = db.prepare(`
    SELECT skin_name, condition, median_price_cents, volume
    FROM price_data WHERE source = 'csfloat_sales'
    ORDER BY skin_name, condition
  `).all() as any[];
  console.log(`\n${prices.length} sale-based output prices:`);
  for (const p of prices) {
    console.log(`  ${p.skin_name} (${p.condition}): median $${(p.median_price_cents/100).toFixed(2)}, ${p.volume} sales`);
  }
}).catch(console.error);
