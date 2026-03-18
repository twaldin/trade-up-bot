import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "..", "data", "tradeup.db"), { readonly: true });

// Find top knife trade-ups and compare their listings
const tus = db.prepare(`
  SELECT t.id, t.profit_cents, t.created_at FROM trade_ups t
  WHERE t.type = 'covert_knife' AND t.is_theoretical = 0 AND t.listing_status = 'active'
  ORDER BY t.profit_cents DESC LIMIT 10
`).all() as { id: number; profit_cents: number; created_at: string }[];

const sigs = new Map<string, number[]>();

for (const tu of tus) {
  const inputs = db.prepare(
    "SELECT listing_id, skin_name, float_value, price_cents FROM trade_up_inputs WHERE trade_up_id = ? ORDER BY listing_id"
  ).all(tu.id) as { listing_id: string; skin_name: string; float_value: number; price_cents: number }[];

  const idSig = inputs.map(i => i.listing_id).join(",");
  const contentSig = inputs.map(i => `${i.skin_name}|${i.float_value}|${i.price_cents}`).sort().join(";;");

  console.log(`TU #${tu.id} profit=$${(tu.profit_cents/100).toFixed(2)} created=${tu.created_at}`);
  console.log(`  ID sig: ${idSig}`);
  console.log(`  Content sig: ${contentSig}`);
  for (const i of inputs) {
    console.log(`    ${i.listing_id.substring(0,20)}... ${i.skin_name} float=${i.float_value} $${(i.price_cents/100).toFixed(2)}`);
  }

  // Track content-level duplicates
  const existing = sigs.get(contentSig);
  if (existing) {
    existing.push(tu.id);
    console.log(`  *** CONTENT DUPLICATE of TU #${existing[0]}`);
  } else {
    sigs.set(contentSig, [tu.id]);
  }
  console.log();
}

db.close();
