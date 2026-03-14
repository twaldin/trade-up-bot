
import Database from "better-sqlite3";
import { setSyncMeta } from "../db.js";

export async function syncSkinportPrices(db: Database.Database) {
  console.log("Fetching Skinport prices...");

  const res = await fetch(
    "https://api.skinport.com/v1/items?app_id=730&currency=USD",
    { headers: { "Accept-Encoding": "br, gzip" } }
  );

  if (!res.ok) {
    throw new Error(`Skinport API error: ${res.status}`);
  }

  const items: {
    market_hash_name: string;
    suggested_price: number;
    min_price: number | null;
    max_price: number | null;
    mean_price: number | null;
    median_price: number | null;
    quantity: number;
  }[] = await res.json();

  console.log(`  Got ${items.length} items from Skinport`);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'skinport', datetime('now'))
  `);

  let count = 0;
  const insertPrices = db.transaction(() => {
    for (const item of items) {
      // Parse condition from market_hash_name
      const condMatch = item.market_hash_name.match(
        /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/
      );
      if (!condMatch) continue;

      const condition = condMatch[1];
      const avgCents = Math.round((item.mean_price ?? item.suggested_price ?? 0) * 100);
      const medianCents = Math.round((item.median_price ?? avgCents) * 100);
      const minCents = Math.round((item.min_price ?? 0) * 100);

      // Strip condition from name to get base skin name
      const skinName = item.market_hash_name
        .replace(/\s*\([^)]+\)\s*$/, "")
        .trim();

      insertPrice.run(
        skinName,
        condition,
        avgCents,
        medianCents,
        minCents,
        item.quantity,
      );
      count++;
    }
  });
  insertPrices();

  console.log(`  Inserted ${count} price entries`);
  setSyncMeta(db, "last_price_sync", new Date().toISOString());
}
