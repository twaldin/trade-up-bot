
import pg from "pg";
import { setSyncMeta } from "../db.js";

export async function syncSkinportPrices(pool: pg.Pool) {
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

  let count = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

      await client.query(`
        INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'skinport', NOW())
        ON CONFLICT (skin_name, condition, source) DO UPDATE SET
          avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
      `, [skinName, condition, avgCents, medianCents, minCents, item.quantity]);
      count++;
    }
    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  console.log(`  Inserted ${count} price entries`);
  await setSyncMeta(pool, "last_price_sync", new Date().toISOString());
}
