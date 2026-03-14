
import Database from "better-sqlite3";
import { CSFLOAT_BASE, CONDITION_FROM_FLOAT } from "./types.js";
import type { CSFloatSaleEntry } from "./types.js";

/**
 * Fetch sale history for a specific skin+condition from CSFloat.
 * Endpoint: GET /api/v1/history/{market_hash_name}/sales
 * Returns ~40 recent sales. CF-cached so repeat calls are free.
 */
export async function fetchSaleHistory(
  marketHashName: string,
  apiKey: string
): Promise<CSFloatSaleEntry[]> {
  const url = `${CSFLOAT_BASE}/history/${encodeURIComponent(marketHashName)}/sales`;
  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      const reset = res.headers.get("x-ratelimit-reset");
      throw Object.assign(new Error(`CSFloat API error: 429`), {
        status: 429,
        retryInfo: { reset },
      });
    }
    throw Object.assign(new Error(`CSFloat history API error: ${res.status}`), {
      status: res.status,
    });
  }

  const data: CSFloatSaleEntry[] = await res.json();
  return data;
}

/**
 * Sync sale history for Covert skins (trade-up outputs).
 * Fetches recent sales from CSFloat for each skin+condition, stores in sale_history,
 * and updates price_data with median sale prices (source='csfloat_sales').
 */
export async function syncSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get all Covert skins that are actual trade-up outputs
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0
      AND sc.collection_id IN (
        SELECT DISTINCT sc2.collection_id
        FROM skins s2
        JOIN skin_collections sc2 ON s2.id = sc2.skin_id
        WHERE s2.rarity = 'Classified'
      )
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  // Build list of skin+condition pairs
  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of CONDITION_FROM_FLOAT) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Check which pairs already have recent sale history (24h — all coverts already have data)
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-24 hours') AND source = 'csfloat'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Coverage-aware: prioritize skins with fewer sales
  const saleCounts = new Map<string, number>();
  const saleCountRows = db.prepare(`
    SELECT skin_name, COUNT(*) as cnt FROM sale_history
    WHERE skin_name NOT LIKE '★%'
    GROUP BY skin_name
  `).all() as { skin_name: string; cnt: number }[];
  for (const r of saleCountRows) saleCounts.set(r.skin_name, r.cnt);

  // Skip skins that persistently 403 (re-check after 24h)
  const errorSkins = new Set<string>();
  const errorRows = db.prepare(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE error_count >= 2 AND last_seen_at > datetime('now', '-24 hours')
  `).all() as { market_hash_name: string }[];
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  const toFetch = pairs.filter(
    (p) => !recentlyFetched.has(`${p.skinName}:${p.condition}`) && !errorSkins.has(p.marketHashName)
  );
  // Fewer sales first — spread coverage evenly
  toFetch.sort((a, b) => (saleCounts.get(a.skinName) ?? 0) - (saleCounts.get(b.skinName) ?? 0));

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  if (errorSkins.size > 0) {
    console.log(`  Sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${errorSkins.size} error-skipped, ${limited.length} to fetch`);
  } else {
    console.log(`  Sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${limited.length} to fetch`);
  }

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;

  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing out — hit ${consecutiveRateLimits} consecutive rate limits, API quota likely exhausted`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0; // Reset on success
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            const delay = 15000;
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, delay));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;

      if (sales.length === 0) {
        // Throttle between requests
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Store individual sales
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;

          const condition = pair.condition;
          insertSale.run(
            sale.id,
            pair.skinName,
            condition,
            sale.price,
            sale.item.float_value,
            sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Also save reference price if available (comes free with history)
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName,
          pair.condition,
          sales[0].reference.base_price,
          sales[0].reference.base_price,
          sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate median sale price and store in price_data
      const validPrices = sales
        .filter((s) => s.state === "sold" && !s.item.is_stattrak)
        .map((s) => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median =
          validPrices.length % 2 === 0
            ? Math.round(
                (validPrices[validPrices.length / 2 - 1] +
                  validPrices[validPrices.length / 2]) /
                  2
              )
            : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(
          validPrices.reduce((s, p) => s + p, 0) / validPrices.length
        );
        const min = validPrices[0];

        insertPrice.run(
          pair.skinName,
          pair.condition,
          avg,
          median,
          min,
          validPrices.length
        );
        pricesUpdated++;
      }

      if (totalFetched % 25 === 0) {
        const msg = `Sale history: ${totalFetched}/${limited.length} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      // Throttle between requests (CF caches responses, but be respectful)
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${pair.marketHashName}: ${err.message}`);
      // 403/404 still consumed an API call — count it
      if (err.status !== 429) totalFetched++;
      // Track persistent errors so we skip them next cycle
      if (err.status === 403 || err.status === 404) {
        db.prepare(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES (?, ?)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = error_count + 1,
            last_seen_at = datetime('now')
        `).run(pair.marketHashName, err.status);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const finalMsg = `Sale history complete: ${totalFetched} fetched, ${totalSales} sales stored, ${pricesUpdated} prices updated`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Sync sale history for StatTrak Covert skins (trade-up outputs for ST classified→covert).
 * CSFloat has ST sales but we weren't fetching them. Uses the same API endpoint
 * with market_hash_name like "StatTrak™ AWP | Printstream (Well-Worn)".
 */
export async function syncStatTrakSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = 1
      AND sc.collection_id IN (
        SELECT DISTINCT sc2.collection_id
        FROM skins s2
        JOIN skin_collections sc2 ON s2.id = sc2.skin_id
        WHERE s2.rarity = 'Classified'
      )
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of CONDITION_FROM_FLOAT) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Skip recently fetched (48h — ST items trade less frequently)
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-48 hours') AND source = 'csfloat'
      AND skin_name LIKE 'StatTrak%'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Prioritize skins without any sale price data
  const hasSalesPrice = new Set<string>();
  const salesRows = db.prepare(`
    SELECT skin_name, condition FROM price_data
    WHERE source = 'csfloat_sales' AND skin_name LIKE 'StatTrak%'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of salesRows) hasSalesPrice.add(`${r.skin_name}:${r.condition}`);

  const errorSkins = new Set<string>();
  const errorRows = db.prepare(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE error_count >= 2 AND last_seen_at > datetime('now', '-24 hours')
  `).all() as { market_hash_name: string }[];
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  const toFetch = pairs.filter(
    p => !recentlyFetched.has(`${p.skinName}:${p.condition}`) && !errorSkins.has(p.marketHashName)
  );
  // No sale data first
  toFetch.sort((a, b) => {
    const aHas = hasSalesPrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHas = hasSalesPrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    return aHas - bHas;
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(`  ST Covert sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${hasSalesPrice.size} with sales data, ${limited.length} to fetch`);

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);
  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;
  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing — ${consecutiveRateLimits} consecutive rate limits`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0;
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise(r => setTimeout(r, 15000));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;
      if (sales.length === 0) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // Store ST sales (don't filter out is_stattrak — that's what we want)
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          insertSale.run(
            sale.id, pair.skinName, pair.condition,
            sale.price, sale.item.float_value, sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Save reference price if available
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate median sale price
      const validPrices = sales
        .filter(s => s.state === "sold")
        .map(s => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median = validPrices.length % 2 === 0
          ? Math.round((validPrices[validPrices.length / 2 - 1] + validPrices[validPrices.length / 2]) / 2)
          : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(validPrices.reduce((s, p) => s + p, 0) / validPrices.length);
        const min = validPrices[0];
        insertPrice.run(pair.skinName, pair.condition, avg, median, min, validPrices.length);
        pricesUpdated++;
      }

      if (totalFetched % 10 === 0) {
        const msg = `ST Covert sales: ${totalFetched}/${limited.length}, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
      }

      await new Promise(r => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${pair.marketHashName}: ${err.message}`);
      if (err.status !== 429) totalFetched++;
      if (err.status === 403 || err.status === 404) {
        db.prepare(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES (?, ?)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = error_count + 1,
            last_seen_at = datetime('now')
        `).run(pair.marketHashName, err.status);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const finalMsg = `ST Covert sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Sync sale history for Classified skins (trade-up inputs for classified->covert).
 * These need accurate pricing so we know the true cost of each trade-up.
 * Prioritizes skins WITHOUT csfloat_sales data first.
 */
export async function syncClassifiedSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get all Classified skins that are trade-up inputs
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  // Build list of skin+condition pairs
  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of CONDITION_FROM_FLOAT) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Skip recently fetched (6h window)
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-6 hours') AND source = 'csfloat'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Check which pairs already have csfloat_sales data
  const hasSalesPrice = new Set<string>();
  const salesRows = db.prepare(`
    SELECT skin_name, condition FROM price_data WHERE source = 'csfloat_sales'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of salesRows) hasSalesPrice.add(`${r.skin_name}:${r.condition}`);

  // Skip skins that persistently 403 (re-check after 24h)
  const errorSkins = new Set<string>();
  const errorRows = db.prepare(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE error_count >= 2 AND last_seen_at > datetime('now', '-24 hours')
  `).all() as { market_hash_name: string }[];
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  const toFetch = pairs.filter(
    (p) => !recentlyFetched.has(`${p.skinName}:${p.condition}`) && !errorSkins.has(p.marketHashName)
  );

  // Prioritize: skins WITHOUT csfloat_sales data first
  toFetch.sort((a, b) => {
    const aHas = hasSalesPrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHas = hasSalesPrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    return aHas - bHas;
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(
    `  Classified sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${hasSalesPrice.size} with sales data, ${limited.length} to fetch`
  );

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;
  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing — ${consecutiveRateLimits} consecutive rate limits`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0;
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, 15000));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;

      if (sales.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Store individual sales
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;
          insertSale.run(
            sale.id, pair.skinName, pair.condition,
            sale.price, sale.item.float_value, sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Save reference price if available
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate median sale price
      const validPrices = sales
        .filter(s => s.state === "sold" && !s.item.is_stattrak)
        .map(s => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median = validPrices.length % 2 === 0
          ? Math.round((validPrices[validPrices.length / 2 - 1] + validPrices[validPrices.length / 2]) / 2)
          : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(validPrices.reduce((s, p) => s + p, 0) / validPrices.length);
        const min = validPrices[0];

        insertPrice.run(pair.skinName, pair.condition, avg, median, min, validPrices.length);
        pricesUpdated++;
      }

      if (totalFetched % 10 === 0) {
        const msg = `Classified sales: ${totalFetched}/${limited.length}, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${pair.marketHashName}: ${err.message}`);
      if (err.status !== 429) totalFetched++;
      if (err.status === 403 || err.status === 404) {
        db.prepare(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES (?, ?)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = error_count + 1,
            last_seen_at = datetime('now')
        `).run(pair.marketHashName, err.status);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const finalMsg = `Classified sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Fetch sale history for knife and glove skins from CSFloat.
 * These are trade-up outputs that need accurate pricing.
 */
export async function syncKnifeGloveSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get knife/glove skins that we need prices for
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.stattrak = 0
      AND (s.weapon LIKE '%Knife%' OR s.weapon LIKE '%Bayonet%'
        OR s.weapon LIKE '%Gloves%' OR s.weapon LIKE '%Wraps%'
        OR s.weapon = 'Shadow Daggers')
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  // Build skin+condition pairs
  const condBounds = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of condBounds) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Skip recently fetched — 48h window (rare skins may not have new sales for days)
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-48 hours') AND source = 'csfloat'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Coverage-aware prioritization: count existing sale records per skin
  const saleCounts = new Map<string, number>();
  const saleCountRows = db.prepare(`
    SELECT skin_name, COUNT(*) as cnt FROM sale_history
    WHERE skin_name LIKE '★%'
    GROUP BY skin_name
  `).all() as { skin_name: string; cnt: number }[];
  for (const r of saleCountRows) saleCounts.set(r.skin_name, r.cnt);

  // Check which have csfloat_sales pricing (the gold standard)
  const hasSalePrice = new Set<string>();
  const salePriceRows = db.prepare(`
    SELECT skin_name, condition FROM price_data
    WHERE source = 'csfloat_sales' AND median_price_cents > 0
  `).all() as { skin_name: string; condition: string }[];
  for (const r of salePriceRows) hasSalePrice.add(`${r.skin_name}:${r.condition}`);

  // Skip skins that persistently 403 (re-check after 24h)
  const errorSkins = new Set<string>();
  const errorRows = db.prepare(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE error_count >= 2 AND last_seen_at > datetime('now', '-24 hours')
  `).all() as { market_hash_name: string }[];
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  const toFetch = pairs.filter(
    p => !recentlyFetched.has(`${p.skinName}:${p.condition}`) && !errorSkins.has(p.marketHashName)
  );

  // Priority: 0 sales -> few sales -> no csfloat_sales price -> already covered
  toFetch.sort((a, b) => {
    const aSales = saleCounts.get(a.skinName) ?? 0;
    const bSales = saleCounts.get(b.skinName) ?? 0;
    // Zero sales first
    if (aSales === 0 && bSales > 0) return -1;
    if (bSales === 0 && aSales > 0) return 1;
    // Then by whether they have sale-based pricing
    const aHasPrice = hasSalePrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHasPrice = hasSalePrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    if (aHasPrice !== bHasPrice) return aHasPrice - bHasPrice;
    // Then fewer sales first
    return aSales - bSales;
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(`  Knife/glove sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${limited.length} to fetch`);

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;
  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing — ${consecutiveRateLimits} consecutive rate limits`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0;
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            const delay = 30000;
            console.log(`    Rate limited, waiting 30s...`);
            await new Promise((r) => setTimeout(r, delay));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;

      if (sales.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Store individual sales
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;
          insertSale.run(
            sale.id, pair.skinName, pair.condition,
            sale.price, sale.item.float_value, sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Save reference price if available
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate and store median sale price
      const validPrices = sales
        .filter(s => s.state === "sold" && !s.item.is_stattrak)
        .map(s => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median = validPrices.length % 2 === 0
          ? Math.round((validPrices[validPrices.length / 2 - 1] + validPrices[validPrices.length / 2]) / 2)
          : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(validPrices.reduce((s, p) => s + p, 0) / validPrices.length);
        const min = validPrices[0];

        insertPrice.run(pair.skinName, pair.condition, avg, median, min, validPrices.length);
        pricesUpdated++;
      }

      if (totalFetched % 25 === 0) {
        const msg = `Knife/glove sales: ${totalFetched}/${limited.length}, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error: ${pair.marketHashName}: ${err.message}`);
      if (err.status !== 429) totalFetched++;
      if (err.status === 403 || err.status === 404) {
        db.prepare(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES (?, ?)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = error_count + 1,
            last_seen_at = datetime('now')
        `).run(pair.marketHashName, err.status);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const msg = `Knife/glove sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}
