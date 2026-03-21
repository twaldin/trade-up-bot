
import pg from "pg";
import { CSFLOAT_BASE, CONDITION_FROM_FLOAT } from "./types.js";
import type { CSFloatSaleEntry } from "./types.js";
import { getSyncMeta, setSyncMeta } from "../db.js";

/**
 * Store a sale as a price observation for KNN float-precise pricing.
 * Called from all sale history sync functions. Dedup handled by unique index.
 */
async function recordSaleObservation(pool: pg.Pool, skinName: string, floatValue: number, priceCents: number, soldAt: string) {
  await pool.query(
    "INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at) VALUES ($1, $2, $3, 'sale', $4) ON CONFLICT DO NOTHING",
    [skinName, floatValue, priceCents, soldAt]
  );
}

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
  pool: pg.Pool,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get all Covert skins that are actual trade-up outputs
  const { rows: skins } = await pool.query(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = false
      AND sc.collection_id IN (
        SELECT DISTINCT sc2.collection_id
        FROM skins s2
        JOIN skin_collections sc2 ON s2.id = sc2.skin_id
        WHERE s2.rarity = 'Classified'
      )
    ORDER BY s.name
  `) as { rows: { name: string; min_float: number; max_float: number }[] };

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
  const { rows: recentRows } = await pool.query(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > NOW() - INTERVAL '24 hours' AND source = 'csfloat'
  `);
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Coverage-aware: prioritize skins with fewer sales
  const saleCounts = new Map<string, number>();
  const { rows: saleCountRows } = await pool.query(`
    SELECT skin_name, COUNT(*) as cnt FROM sale_history
    WHERE skin_name NOT LIKE '★%'
    GROUP BY skin_name
  `);
  for (const r of saleCountRows) saleCounts.set(r.skin_name, Number(r.cnt));

  // Skip skins that persistently 403 (re-check after 24h)
  const errorSkins = new Set<string>();
  const { rows: errorRows } = await pool.query(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE (error_code != 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '24 hours')
       OR (error_code = 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '7 days')
  `);
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
        // Track empty result so we skip this skin for 7 days (saves budget)
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, 0)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName]);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Got results — clear any previous empty-result tracking
      await pool.query(`DELETE FROM sale_fetch_errors WHERE market_hash_name = $1 AND error_code = 0`, [pair.marketHashName]);

      // Store individual sales
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;

          const condition = pair.condition;
          await client.query(`
            INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
            VALUES ($1, $2, $3, $4, $5, $6, 'csfloat')
            ON CONFLICT DO NOTHING
          `, [sale.id, pair.skinName, condition, sale.price, sale.item.float_value, sale.created_at]);
          await recordSaleObservation(pool, pair.skinName, sale.item.float_value, sale.price, sale.created_at);
          totalSales++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Also save reference price if available (comes free with history)
      if (sales[0]?.reference?.base_price) {
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_ref', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0,
        ]);
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

        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_sales', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [pair.skinName, pair.condition, avg, median, min, validPrices.length]);
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
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, $2)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName, err.status]);
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
 * Sync sale history for StatTrak Covert skins (trade-up outputs for ST classified->covert).
 */
export async function syncStatTrakSaleHistory(
  pool: pg.Pool,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  const { rows: skins } = await pool.query(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = true
      AND sc.collection_id IN (
        SELECT DISTINCT sc2.collection_id
        FROM skins s2
        JOIN skin_collections sc2 ON s2.id = sc2.skin_id
        WHERE s2.rarity = 'Classified'
      )
    ORDER BY s.name
  `) as { rows: { name: string; min_float: number; max_float: number }[] };

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
  const { rows: recentRows } = await pool.query(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > NOW() - INTERVAL '48 hours' AND source = 'csfloat'
      AND skin_name LIKE 'StatTrak%'
  `);
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Prioritize skins without any sale price data
  const hasSalesPrice = new Set<string>();
  const { rows: salesRows } = await pool.query(`
    SELECT skin_name, condition FROM price_data
    WHERE source = 'csfloat_sales' AND skin_name LIKE 'StatTrak%'
  `);
  for (const r of salesRows) hasSalesPrice.add(`${r.skin_name}:${r.condition}`);

  const errorSkins = new Set<string>();
  const { rows: errorRows } = await pool.query(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE (error_code != 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '24 hours')
       OR (error_code = 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '7 days')
  `);
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
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, 0)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName]);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      await pool.query(`DELETE FROM sale_fetch_errors WHERE market_hash_name = $1 AND error_code = 0`, [pair.marketHashName]);

      // Store ST sales (don't filter out is_stattrak — that's what we want)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          await client.query(`
            INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
            VALUES ($1, $2, $3, $4, $5, $6, 'csfloat')
            ON CONFLICT DO NOTHING
          `, [sale.id, pair.skinName, pair.condition, sale.price, sale.item.float_value, sale.created_at]);
          await recordSaleObservation(pool, pair.skinName, sale.item.float_value, sale.price, sale.created_at);
          totalSales++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Save reference price if available
      if (sales[0]?.reference?.base_price) {
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_ref', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0,
        ]);
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
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_sales', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [pair.skinName, pair.condition, avg, median, min, validPrices.length]);
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
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, $2)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName, err.status]);
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
 * Sync sale history for skins of any rarity.
 */
export async function syncSaleHistoryForRarity(
  pool: pg.Pool,
  rarity: string,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  const { rows: skins } = await pool.query(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.rarity = $1 AND s.stattrak = false
    ORDER BY s.name
  `, [rarity]) as { rows: { name: string; min_float: number; max_float: number }[] };

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
  const { rows: recentRows } = await pool.query(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > NOW() - INTERVAL '6 hours' AND source = 'csfloat'
  `);
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  const hasSalesPrice = new Set<string>();
  const { rows: salesRows } = await pool.query(`SELECT skin_name, condition FROM price_data WHERE source = 'csfloat_sales'`);
  for (const r of salesRows) hasSalesPrice.add(`${r.skin_name}:${r.condition}`);

  // Observation-gap prioritization: fetch skins with fewest KNN observations first
  const obsCount = new Map<string, number>();
  const { rows: obsRows } = await pool.query(`
    SELECT skin_name, COUNT(*) as obs
    FROM price_observations
    WHERE source IN ('sale', 'skinport_sale')
      AND EXTRACT(EPOCH FROM NOW() - observed_at::timestamptz) / 86400.0 <= 45
    GROUP BY skin_name
  `);
  for (const r of obsRows) obsCount.set(r.skin_name, parseInt(r.obs, 10));

  const errorSkins = new Set<string>();
  const { rows: errorRows } = await pool.query(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE (error_code != 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '24 hours')
       OR (error_code = 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '7 days')
  `);
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  const toFetch = pairs.filter(
    (p) => !recentlyFetched.has(`${p.skinName}:${p.condition}`) && !errorSkins.has(p.marketHashName)
  );

  // Sort: skins without sales price first, then by fewest observations (feeds KNN gaps)
  toFetch.sort((a, b) => {
    const aHas = hasSalesPrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHas = hasSalesPrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas;
    return (obsCount.get(a.skinName) ?? 0) - (obsCount.get(b.skinName) ?? 0);
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(
    `  ${rarity} sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${hasSalesPrice.size} with sales data, ${limited.length} to fetch`
  );

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
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, 0)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName]);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      await pool.query(`DELETE FROM sale_fetch_errors WHERE market_hash_name = $1 AND error_code = 0`, [pair.marketHashName]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;
          await client.query(`
            INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
            VALUES ($1, $2, $3, $4, $5, $6, 'csfloat')
            ON CONFLICT DO NOTHING
          `, [sale.id, pair.skinName, pair.condition, sale.price, sale.item.float_value, sale.created_at]);
          await recordSaleObservation(pool, pair.skinName, sale.item.float_value, sale.price, sale.created_at);
          totalSales++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      if (sales[0]?.reference?.base_price) {
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_ref', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0,
        ]);
      }

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
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_sales', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [pair.skinName, pair.condition, avg, median, min, validPrices.length]);
        pricesUpdated++;
      }

      if (totalFetched % 10 === 0) {
        const msg = `${rarity} sales: ${totalFetched}/${limited.length}, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${pair.marketHashName}: ${err.message}`);
      if (err.status !== 429) totalFetched++;
      if (err.status === 403 || err.status === 404) {
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, $2)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName, err.status]);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const finalMsg = `${rarity} sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Fetch sale history for knife and glove skins from CSFloat.
 * These are trade-up outputs that need accurate pricing.
 */
export async function syncKnifeGloveSaleHistory(
  pool: pg.Pool,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  const { rows: skins } = await pool.query(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.stattrak = false
      AND (s.weapon LIKE '%Knife%' OR s.weapon LIKE '%Bayonet%'
        OR s.weapon LIKE '%Gloves%' OR s.weapon LIKE '%Wraps%'
        OR s.weapon = 'Shadow Daggers')
    ORDER BY s.name
  `) as { rows: { name: string; min_float: number; max_float: number }[] };

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

  const recentlyFetched = new Set<string>();
  const { rows: recentRows } = await pool.query(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > NOW() - INTERVAL '48 hours' AND source = 'csfloat'
  `);
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  const saleCounts = new Map<string, number>();
  const { rows: saleCountRows } = await pool.query(`
    SELECT skin_name, COUNT(*) as cnt FROM sale_history WHERE skin_name LIKE '★%' GROUP BY skin_name
  `);
  for (const r of saleCountRows) saleCounts.set(r.skin_name, Number(r.cnt));

  const hasSalePrice = new Set<string>();
  const { rows: salePriceRows } = await pool.query(`
    SELECT skin_name, condition FROM price_data WHERE source = 'csfloat_sales' AND median_price_cents > 0
  `);
  for (const r of salePriceRows) hasSalePrice.add(`${r.skin_name}:${r.condition}`);

  const errorSkins = new Set<string>();
  const { rows: errorRows } = await pool.query(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE (error_code != 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '24 hours')
       OR (error_code = 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '7 days')
  `);
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  const toFetch = pairs.filter(
    p => !recentlyFetched.has(`${p.skinName}:${p.condition}`) && !errorSkins.has(p.marketHashName)
  );

  toFetch.sort((a, b) => {
    const aSales = saleCounts.get(a.skinName) ?? 0;
    const bSales = saleCounts.get(b.skinName) ?? 0;
    if (aSales === 0 && bSales > 0) return -1;
    if (bSales === 0 && aSales > 0) return 1;
    const aHasPrice = hasSalePrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHasPrice = hasSalePrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    if (aHasPrice !== bHasPrice) return aHasPrice - bHasPrice;
    return aSales - bSales;
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(`  Knife/glove sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${limited.length} to fetch`);

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
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, 0)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName]);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      await pool.query(`DELETE FROM sale_fetch_errors WHERE market_hash_name = $1 AND error_code = 0`, [pair.marketHashName]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;
          await client.query(`
            INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
            VALUES ($1, $2, $3, $4, $5, $6, 'csfloat')
            ON CONFLICT DO NOTHING
          `, [sale.id, pair.skinName, pair.condition, sale.price, sale.item.float_value, sale.created_at]);
          await recordSaleObservation(pool, pair.skinName, sale.item.float_value, sale.price, sale.created_at);
          totalSales++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      if (sales[0]?.reference?.base_price) {
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_ref', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0,
        ]);
      }

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
        await pool.query(`
          INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_sales', NOW())
          ON CONFLICT (skin_name, condition, source) DO UPDATE SET
            avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
        `, [pair.skinName, pair.condition, avg, median, min, validPrices.length]);
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
        await pool.query(`
          INSERT INTO sale_fetch_errors (market_hash_name, error_code)
          VALUES ($1, $2)
          ON CONFLICT(market_hash_name) DO UPDATE SET
            error_count = sale_fetch_errors.error_count + 1,
            last_seen_at = NOW()
        `, [pair.marketHashName, err.status]);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const msg = `Knife/glove sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Round-robin sale history: cycles through ALL valid skin+condition pairs deterministically.
 * Grouped by skin — all conditions of one skin fetched consecutively before advancing.
 *
 * State persisted in sync_meta as cursor (skin index + loop count).
 * Skips pairs that returned empty on previous loop (reset on wrap).
 * CSFloat sale API requires condition in market_hash_name.
 */
export async function syncSaleHistoryRoundRobin(
  pool: pg.Pool,
  options: {
    apiKey: string;
    maxCalls: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number; loopCount: number }> {
  // Build sorted list: skins with zero sale observations FIRST, then rest alphabetically.
  // source='sale' covers both CSFloat sale history API and staleness checker sold detections.
  const { rows: allSkins } = await pool.query(`
    SELECT DISTINCT s.name, s.min_float, s.max_float,
      CASE WHEN EXISTS (
        SELECT 1 FROM price_observations po
        WHERE po.skin_name = s.name AND po.source = 'sale'
          AND EXTRACT(EPOCH FROM NOW() - po.observed_at::timestamptz) / 86400.0 <= 45
      ) THEN 1 ELSE 0 END as has_sales
    FROM skins s
    WHERE s.stattrak = false
    ORDER BY has_sales ASC, s.name
  `) as { rows: { name: string; min_float: number; max_float: number; has_sales: number }[] };

  if (allSkins.length === 0) return { fetched: 0, sales: 0, pricesUpdated: 0, loopCount: 0 };

  const uncoveredCount = allSkins.filter(s => s.has_sales === 0).length;

  // Load cursor (tracks skin index, not pair index)
  // Since sort order changes as skins gain coverage, reset cursor when uncovered skins remain
  const rawCursor = await getSyncMeta(pool, "sale_round_robin_cursor");
  let cursor: { index: number; loopCount: number; lastUpdated: string } = rawCursor
    ? JSON.parse(rawCursor)
    : { index: 0, loopCount: 0, lastUpdated: new Date().toISOString() };

  // If there are uncovered skins, always start from index 0 (they're sorted first)
  if (uncoveredCount > 0) {
    cursor.index = 0;
  } else if (cursor.index >= allSkins.length) {
    cursor.index = 0;
    cursor.loopCount++;
  }

  // Load empty-result skip set: market_hash_names that returned empty on this loop
  const rawSkips = await getSyncMeta(pool, "sale_round_robin_skips");
  const skipSet: Set<string> = rawSkips ? new Set(JSON.parse(rawSkips)) : new Set();

  // Load persistent error skins (403/404)
  const errorSkins = new Set<string>();
  const { rows: errorRows } = await pool.query(`
    SELECT market_hash_name FROM sale_fetch_errors
    WHERE (error_code != 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '24 hours')
       OR (error_code = 0 AND error_count >= 2 AND last_seen_at > NOW() - INTERVAL '7 days')
  `);
  for (const r of errorRows) errorSkins.add(r.market_hash_name);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;
  let consecutiveRateLimits = 0;
  let skipped = 0;

  // Count total pairs for logging
  let totalPairs = 0;
  for (const skin of allSkins) {
    for (const cond of CONDITION_FROM_FLOAT) {
      if (skin.min_float < cond.max && skin.max_float > cond.min) totalPairs++;
    }
  }

  console.log(`  Round-robin sales: ${allSkins.length} skins (${totalPairs} pairs, ${uncoveredCount} uncovered), starting at skin ${cursor.index} (loop ${cursor.loopCount}), budget ${options.maxCalls} calls, ${skipSet.size} empty-skips`);

  while (totalFetched < options.maxCalls) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing — ${consecutiveRateLimits} consecutive rate limits`);
      break;
    }

    const skin = allSkins[cursor.index];
    // Get valid conditions for this skin
    const validConditions = CONDITION_FROM_FLOAT.filter(c => skin.min_float < c.max && skin.max_float > c.min);

    // Check if we have enough budget for at least 1 condition of this skin
    if (totalFetched >= options.maxCalls) break;

    // Fetch each condition for this skin
    for (const cond of validConditions) {
      if (totalFetched >= options.maxCalls) break;
      if (consecutiveRateLimits >= 2) break;

      const marketHashName = `${skin.name} (${cond.name})`;

      // Skip if returned empty on this loop
      if (skipSet.has(marketHashName)) {
        skipped++;
        continue;
      }

      // Skip persistent errors
      if (errorSkins.has(marketHashName)) {
        skipped++;
        continue;
      }

      try {
        let sales: CSFloatSaleEntry[];
        let retries = 0;
        while (true) {
          try {
            sales = await fetchSaleHistory(marketHashName, options.apiKey);
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
          skipSet.add(marketHashName);
          await pool.query(`
            INSERT INTO sale_fetch_errors (market_hash_name, error_code)
            VALUES ($1, 0)
            ON CONFLICT(market_hash_name) DO UPDATE SET
              error_count = sale_fetch_errors.error_count + 1,
              last_seen_at = NOW()
          `, [marketHashName]);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        // Clear previous empty-result tracking
        await pool.query(`DELETE FROM sale_fetch_errors WHERE market_hash_name = $1 AND error_code = 0`, [marketHashName]);

        // Store individual sales
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const sale of sales) {
            if (sale.state !== "sold") continue;
            if (sale.item.is_stattrak) continue;

            await client.query(`
              INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
              VALUES ($1, $2, $3, $4, $5, $6, 'csfloat')
              ON CONFLICT DO NOTHING
            `, [sale.id, skin.name, cond.name, sale.price, sale.item.float_value, sale.created_at]);
            await recordSaleObservation(pool, skin.name, sale.item.float_value, sale.price, sale.created_at);
            totalSales++;
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        } finally {
          client.release();
        }

        // Save reference price if available
        if (sales[0]?.reference?.base_price) {
          await pool.query(`
            INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_ref', NOW())
            ON CONFLICT (skin_name, condition, source) DO UPDATE SET
              avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
          `, [
            skin.name, cond.name,
            sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
            sales[0].reference.quantity ?? 0,
          ]);
        }

        // Calculate median sale price and store in price_data
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
          await pool.query(`
            INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'csfloat_sales', NOW())
            ON CONFLICT (skin_name, condition, source) DO UPDATE SET
              avg_price_cents = $3, median_price_cents = $4, min_price_cents = $5, volume = $6, updated_at = NOW()
          `, [skin.name, cond.name, avg, median, min, validPrices.length]);
          pricesUpdated++;
        }

        await new Promise((r) => setTimeout(r, 1500));
      } catch (err: any) {
        console.log(`    Error fetching ${marketHashName}: ${err.message}`);
        if (err.status !== 429) totalFetched++;
        if (err.status === 403 || err.status === 404) {
          await pool.query(`
            INSERT INTO sale_fetch_errors (market_hash_name, error_code)
            VALUES ($1, $2)
            ON CONFLICT(market_hash_name) DO UPDATE SET
              error_count = sale_fetch_errors.error_count + 1,
              last_seen_at = NOW()
          `, [marketHashName, err.status]);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (totalFetched % 10 === 0 && totalFetched > 0) {
      const msg = `Round-robin sales: ${totalFetched}/${options.maxCalls} fetched, ${totalSales} sales, ${pricesUpdated} prices (loop ${cursor.loopCount})`;
      options.onProgress?.(msg);
      console.log(`  ${msg}`);
    }

    // Advance cursor (by skin — all conditions done)
    cursor.index++;
    if (cursor.index >= allSkins.length) {
      cursor.index = 0;
      cursor.loopCount++;
      skipSet.clear();
      console.log(`  Round-robin sales: completed loop ${cursor.loopCount - 1}, clearing empty-skips, wrapping to start`);
    }
  }

  // Save cursor and skip set
  // When uncovered skins remain, don't persist cursor (it resets to 0 each cycle since uncovered sort first)
  cursor.lastUpdated = new Date().toISOString();
  if (uncoveredCount === 0) {
    await setSyncMeta(pool, "sale_round_robin_cursor", JSON.stringify(cursor));
  }
  await setSyncMeta(pool, "sale_round_robin_skips", JSON.stringify([...skipSet]));

  const coverageNote = uncoveredCount > 0 ? `, ${uncoveredCount} uncovered remaining` : "";
  const finalMsg = `Round-robin sales done: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices, ${skipped} skipped (loop ${cursor.loopCount}, next skin ${cursor.index}/${allSkins.length}${coverageNote})`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated, loopCount: cursor.loopCount };
}
