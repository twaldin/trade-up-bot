import { Router } from "express";
import pg from "pg";
import { cachedRoute, cacheGet, cacheSet } from "../redis.js";
import { toSlug, collectionToSlug } from "../../shared/slugs.js";

type CollectionKnifePool = Map<string, { knifeTypes: string[]; gloveTypes: string[]; knifeFinishes: string[]; gloveFinishes: string[]; finishCount: number }>;
type KnifeTypeToCases = Map<string, string[]>;

export function dataRouter(
  pool: pg.Pool,
  knifeTypeToCases: KnifeTypeToCases,
  collectionKnifePool: CollectionKnifePool,
): Router {
  const router = Router();

  // Skin browser: list all Covert skins with listing stats and pricing

  router.get("/api/skin-data", cachedRoute((req) => `skins:${req.query.rarity}:${req.query.collection || ""}:${req.query.outputCollection || ""}:${req.query.page || 1}:${req.query.stattrak || 0}:${req.query.search || ""}`, 300, async (req, res) => {
    const search = (req.query.search as string) || "";
    const rarity = (req.query.rarity as string) || "all";
    const collection = (req.query.collection as string) || "";
    const outputCollection = (req.query.outputCollection as string) || "";
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1;

    // Build params array with numbered placeholders
    // First 3 params are always stattrak (for the literal column, the join, and the where)
    const params: (string | number | boolean)[] = [stattrak, stattrak, stattrak];
    let paramIndex = 4; // next available $N

    // Rarity filter: specific rarity, "knife_glove" for ★ items, "all" for everything
    let rarityFilter = "";
    if (rarity === "all" || rarity === "") {
      rarityFilter = ""; // no filter — show all rarities
    } else if (rarity === "Covert") {
      rarityFilter = "AND s.rarity = 'Covert' AND s.name NOT LIKE '★%'";
    } else if (rarity === "knife_glove") {
      rarityFilter = "AND s.name LIKE '★%'";
    } else if (["Classified", "Restricted", "Mil-Spec", "Extraordinary", "Consumer Grade", "Industrial Grade"].includes(rarity)) {
      rarityFilter = `AND s.rarity = $${paramIndex}`;
      params.push(rarity);
      paramIndex++;
    }

    // Output collection filter: find knives/gloves from a specific case's pool
    // Filters by BOTH weapon type AND finish to show only collection-specific skins
    let outputWeaponFilter = "";
    if (outputCollection) {
      const poolData = collectionKnifePool.get(outputCollection);
      if (poolData) {
        const weapons = [...poolData.knifeTypes, ...poolData.gloveTypes];
        if (weapons.length > 0) {
          const weaponPlaceholders = weapons.map((_, i) => `s.weapon = $${paramIndex + i}`).join(" OR ");
          params.push(...weapons);
          paramIndex += weapons.length;

          // Filter by finish names to show only this collection's specific finishes
          const finishes = [...poolData.knifeFinishes, ...poolData.gloveFinishes]
            .filter(f => f !== "Vanilla"); // Vanilla handled separately (no " | " in name)
          const hasVanilla = poolData.knifeFinishes.includes("Vanilla");

          let finishFilter = "";
          if (finishes.length > 0) {
            const finishPlaceholders = finishes.map((_, i) => `$${paramIndex + i}`).join(",");
            params.push(...finishes);
            paramIndex += finishes.length;
            if (hasVanilla) {
              finishFilter = `AND (split_part(s.name, ' | ', 2) IN (${finishPlaceholders}) OR s.name NOT LIKE '%|%')`;
            } else {
              finishFilter = `AND split_part(s.name, ' | ', 2) IN (${finishPlaceholders})`;
            }
          } else if (hasVanilla) {
            finishFilter = `AND s.name NOT LIKE '%|%'`;
          }

          outputWeaponFilter = `AND s.name LIKE '★%' AND (${weaponPlaceholders}) ${finishFilter}`;
          rarityFilter = ""; // override rarity filter for output skins
        }
      } else {
        console.warn(`outputCollection "${outputCollection}" not found in collectionKnifePool`);
        res.json([]);
        return;
      }
    }

    // Collection filter — use WHERE subquery instead of JOIN to keep param order correct
    // Skip when outputCollection is set: knives/gloves aren't in skin_collections,
    // they're linked via collectionKnifePool, and outputWeaponFilter already handles filtering.
    let collectionWhere = "";
    if (collection && !outputCollection) {
      collectionWhere = `AND s.id IN (SELECT scf.skin_id FROM skin_collections scf JOIN collections cf ON scf.collection_id = cf.id WHERE cf.name = $${paramIndex})`;
      params.push(collection);
      paramIndex++;
    }

    let searchFilter = "";
    if (search) {
      searchFilter = `AND s.name LIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = (page - 1) * limit;

    params.push(limit);
    const limitParam = paramIndex;
    paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex;
    paramIndex++;

    // Fast query — no correlated subqueries. Listing stats via simple JOIN + GROUP BY.
    const { rows: skins } = await pool.query(`
      SELECT MIN(s.id) as id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, $1::boolean as stattrak,
        STRING_AGG(DISTINCT c.name, ',') as collection_names,
        COUNT(DISTINCT l.id) as listing_count,
        MIN(l.price_cents) as min_price,
        ROUND(AVG(l.price_cents)) as avg_price,
        MAX(l.price_cents) as max_price,
        MIN(l.float_value) as min_float_seen,
        MAX(l.float_value) as max_float_seen
      FROM skins s
      LEFT JOIN skin_collections sc ON s.id = sc.skin_id
      LEFT JOIN collections c ON sc.collection_id = c.id
      LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = $2::boolean
      WHERE s.stattrak = $3::boolean ${rarityFilter} ${outputWeaponFilter} ${collectionWhere}
        ${searchFilter}
      GROUP BY s.name, s.rarity, s.weapon, s.min_float, s.max_float
      ORDER BY listing_count DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, params);

    // Merge knives from collection's case pool into "all" tab
    let allSkins = skins;
    if (collection && (!rarity || rarity === "all" || rarity === "")) {
      const poolData = collectionKnifePool.get(collection);
      if (poolData) {
        const weapons = [...poolData.knifeTypes, ...poolData.gloveTypes];
        if (weapons.length > 0) {
          // Build a separate knife query
          const knifeParams: (string | number | boolean)[] = [stattrak, stattrak, stattrak];
          let kpi = 4;
          const weaponPlaceholders = weapons.map((_, i) => `s.weapon = $${kpi + i}`).join(" OR ");
          knifeParams.push(...weapons);
          kpi += weapons.length;

          const finishes = [...poolData.knifeFinishes, ...poolData.gloveFinishes].filter(f => f !== "Vanilla");
          const hasVanilla = poolData.knifeFinishes.includes("Vanilla");
          let finishFilter = "";
          if (finishes.length > 0) {
            const fp = finishes.map((_, i) => `$${kpi + i}`).join(",");
            knifeParams.push(...finishes);
            kpi += finishes.length;
            finishFilter = hasVanilla
              ? `AND (split_part(s.name, ' | ', 2) IN (${fp}) OR s.name NOT LIKE '%|%')`
              : `AND split_part(s.name, ' | ', 2) IN (${fp})`;
          } else if (hasVanilla) {
            finishFilter = `AND s.name NOT LIKE '%|%'`;
          }

          const { rows: knifeSkins } = await pool.query(`
            SELECT MIN(s.id) as id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, $1::boolean as stattrak,
              STRING_AGG(DISTINCT c.name, ',') as collection_names,
              COUNT(DISTINCT l.id) as listing_count,
              MIN(l.price_cents) as min_price,
              ROUND(AVG(l.price_cents)) as avg_price,
              MAX(l.price_cents) as max_price,
              MIN(l.float_value) as min_float_seen,
              MAX(l.float_value) as max_float_seen
            FROM skins s
            LEFT JOIN skin_collections sc ON s.id = sc.skin_id
            LEFT JOIN collections c ON sc.collection_id = c.id
            LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = $2::boolean
            WHERE s.stattrak = $3::boolean AND s.name LIKE '★%'
              AND (${weaponPlaceholders}) ${finishFilter}
            GROUP BY s.name, s.rarity, s.weapon, s.min_float, s.max_float
            ORDER BY listing_count DESC
          `, knifeParams);

          // Knives first, then regular skins
          allSkins = [...knifeSkins, ...skins];
        }
      }
    }

    // Batch load price_data + sale counts in parallel (was sequential)
    const skinNames = allSkins.map((s: { name: string }) => s.name);
    const priceMap = new Map<string, Record<string, Record<string, number>>>();
    const saleCountMap = new Map<string, number>();
    if (skinNames.length > 0) {
      const placeholders = skinNames.map((_: string, i: number) => `$${i + 1}`).join(",");
      const ph2 = skinNames.map((_: string, i: number) => `$${skinNames.length + i + 1}`).join(",");
      const [{ rows: allPrices }, { rows: saleCounts }] = await Promise.all([
        pool.query(`
          SELECT skin_name, source, condition, avg_price_cents
          FROM price_data WHERE skin_name IN (${placeholders}) AND avg_price_cents > 0
        `, skinNames),
        pool.query(`
          SELECT skin_name, COUNT(*) as cnt FROM (
            SELECT skin_name FROM sale_history WHERE skin_name IN (${placeholders})
            UNION ALL
            SELECT skin_name FROM price_observations WHERE skin_name IN (${ph2}) AND source IN ('sale', 'skinport_sale', 'buff_sale')
          ) sub GROUP BY skin_name
        `, [...skinNames, ...skinNames]),
      ]);
      for (const p of allPrices) {
        if (!priceMap.has(p.skin_name)) priceMap.set(p.skin_name, {});
        const byC = priceMap.get(p.skin_name)!;
        if (!byC[p.condition]) byC[p.condition] = {};
        byC[p.condition][p.source] = p.avg_price_cents;
      }
      for (const r of saleCounts) saleCountMap.set(r.skin_name, parseInt(r.cnt));
    }

    const result = allSkins.map((s: { name: string; collection_names: string; weapon: string; listing_count: string }) => {
      let collectionName = s.collection_names;
      if (!collectionName && s.name.startsWith("★")) {
        const weapon = s.weapon || s.name.replace(/^★\s*/, "").split(" | ")[0];
        const cases = knifeTypeToCases.get(weapon);
        if (cases && cases.length > 0) collectionName = cases.join(", ");
      }
      return { ...s, listing_count: parseInt(s.listing_count), collection_name: collectionName, prices: priceMap.get(s.name) || {}, sale_count: saleCountMap.get(s.name) ?? 0 };
    });

    res.json(result);
  }));

  // Detailed skin data: listings, float price buckets, price observations

  router.get("/api/skin-data/:name", cachedRoute((req) => `skin_detail:${req.params.name}:${req.query.stattrak || 0}`, 60, async (req, res) => {
    const skinName = decodeURIComponent(req.params.name as string);
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1;
    const isDoppler = skinName.includes("Doppler");

    // Run ALL independent queries in parallel (was 5-8 sequential round-trips)
    const queries: Promise<pg.QueryResult>[] = [
      // 0: All listings for this skin (frontend paginates 25 at a time)
      pool.query(`
        SELECT l.id, l.price_cents, l.float_value, l.created_at, l.staleness_checked_at, l.phase, l.source
        FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE s.name = $1 AND l.stattrak = $2
        ORDER BY l.price_cents ASC
      `, [skinName, stattrak]),
      // 1: Float price buckets
      pool.query(`
        SELECT float_min, float_max, avg_price_cents, listing_count, last_checked
        FROM float_price_data WHERE skin_name = $1 ORDER BY float_min
      `, [skinName]),
      // 2: Price sources (price_data + buff sale aggregates from price_observations)
      pool.query(`
        SELECT source, condition, avg_price_cents, volume
        FROM price_data WHERE skin_name = $1 AND avg_price_cents > 0
        UNION ALL
        SELECT 'buff_sale' as source,
          CASE WHEN float_value < 0.07 THEN 'Factory New' WHEN float_value < 0.15 THEN 'Minimal Wear'
               WHEN float_value < 0.38 THEN 'Field-Tested' WHEN float_value < 0.45 THEN 'Well-Worn' ELSE 'Battle-Scarred' END as condition,
          ROUND(AVG(price_cents))::int as avg_price_cents, COUNT(*) as volume
        FROM price_observations
        WHERE skin_name = $1 AND source = 'buff_sale' AND price_cents > 0 AND float_value > 0
        GROUP BY 2
        HAVING COUNT(*) >= 2
        ORDER BY CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'listing' THEN 2 WHEN 'csfloat_ref' THEN 3 WHEN 'skinport' THEN 4 WHEN 'buff_sale' THEN 5 ELSE 6 END
      `, [skinName]),
      // 3: Sale history (UNION deduplicates — same CSFloat sales exist in both tables)
      pool.query(`
        SELECT price_cents, float_value, sold_at,
          CASE WHEN source = 'buff' THEN 'buff_sale' ELSE source END as source
        FROM sale_history
        WHERE skin_name = $1 AND price_cents > 0
        UNION
        SELECT price_cents, float_value, observed_at as sold_at, source FROM price_observations
        WHERE skin_name = $1 AND source IN ('sale', 'skinport_sale', 'buff_sale', 'listing', 'listing_dmarket', 'listing_skinport') AND price_cents > 0
        ORDER BY sold_at DESC LIMIT 1000
      `, [skinName]),
      // 4: Skin metadata
      pool.query(`
        SELECT s.id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, c.name as collection_name
        FROM skins s LEFT JOIN skin_collections sc ON s.id = sc.skin_id
        LEFT JOIN collections c ON sc.collection_id = c.id
        WHERE s.name = $1 AND s.stattrak = $2 LIMIT 1
      `, [skinName, stattrak]),
      // 5: Total sale count
      pool.query(`
        SELECT (SELECT COUNT(*) FROM sale_history WHERE skin_name = $1)
             + (SELECT COUNT(*) FROM price_observations WHERE skin_name = $1 AND source IN ('sale', 'skinport_sale', 'buff_sale')) as cnt
      `, [skinName]),
    ];

    // Doppler-specific queries (added conditionally)
    if (isDoppler) {
      queries.push(
        // 6: Phase prices
        pool.query(`
          SELECT skin_name, source, condition, avg_price_cents, volume
          FROM price_data WHERE skin_name LIKE $1 AND skin_name != $2 AND avg_price_cents > 0
          ORDER BY skin_name, CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'csfloat_ref' THEN 2 ELSE 3 END
        `, [`${skinName}%`, skinName]),
        // 7: Phase sales
        pool.query(`
          SELECT skin_name, price_cents, float_value, observed_at as sold_at FROM price_observations
          WHERE skin_name LIKE $1 AND skin_name != $2 AND price_cents > 0
          ORDER BY observed_at DESC LIMIT 1000
        `, [`${skinName}%`, skinName]),
      );
    }

    const results = await Promise.all(queries);
    const [listingsRes, floatBucketsRes, priceSourcesRes, saleHistoryRes, skinRes, saleCountRes] = results;
    const listings = listingsRes.rows;
    const floatBuckets = floatBucketsRes.rows;
    const priceSourceRows = priceSourcesRes.rows;
    const saleHistory = saleHistoryRes.rows;
    const skin = skinRes.rows[0];
    const totalSaleCount = parseInt(saleCountRes.rows[0]?.cnt ?? "0");

    if (!skin) {
      res.status(404).json({ error: "Skin not found" });
      return;
    }

    // Process Doppler phase data (indices 6 & 7 only present when isDoppler)
    let phasePrices: Record<string, { source: string; condition: string; avg_price_cents: number; volume: number }[]> | undefined;
    let phaseSales: Record<string, { price_cents: number; float_value: number; sold_at: string }[]> | undefined;
    if (isDoppler) {
      phasePrices = {};
      for (const r of results[6].rows) {
        const phase = r.skin_name.replace(skinName, "").trim();
        if (phase) {
          if (!phasePrices[phase]) phasePrices[phase] = [];
          phasePrices[phase].push({ source: r.source, condition: r.condition, avg_price_cents: r.avg_price_cents, volume: r.volume });
        }
      }
      phaseSales = {};
      for (const r of results[7].rows) {
        const phase = r.skin_name.replace(skinName, "").trim();
        if (phase) {
          if (!phaseSales[phase]) phaseSales[phase] = [];
          phaseSales[phase].push({ price_cents: r.price_cents, float_value: r.float_value, sold_at: r.sold_at });
        }
      }
    }

    // Resolve knife/glove collection from CASE_KNIFE_MAP
    let resolvedCollectionName = skin.collection_name;
    if (!resolvedCollectionName && skin.name.startsWith("★")) {
      const weapon = skin.weapon || skin.name.replace(/^★\s*/, "").split(" | ")[0];
      const cases = knifeTypeToCases.get(weapon);
      if (cases && cases.length > 0) {
        resolvedCollectionName = cases.join(", ");
      }
    }

    res.json({
      skin: { ...skin, collection_name: resolvedCollectionName },
      listings,
      floatBuckets,
      priceSources: priceSourceRows,
      phasePrices, // Doppler only: per-phase price data
      phaseSales,  // Doppler only: per-phase sale observations
      saleHistory,
      stats: {
        totalListings: listings.length,
        checkedListings: listings.filter((l: any) => l.staleness_checked_at).length,
        minPrice: listings.length > 0 ? listings[0].price_cents : null,
        maxPrice: listings.length > 0 ? listings[listings.length - 1].price_cents : null,
        saleCount: totalSaleCount,
      },
    });
  }));

  // Skin name autocomplete for search inputs

  router.get("/api/skin-suggestions", cachedRoute(
    (req) => `skin_suggest:${(req.query.q as string || "").toLowerCase()}`,
    60,
    async (req, res) => {
      const q = ((req.query.q as string) || "").trim();
      if (q.length < 2) {
        res.json({ results: [] });
        return;
      }

      // Normalize: strip star and pipe from query, split into words for matching
      const normalized = q.replace(/\u2605/g, "").replace(/\|/g, "").replace(/\s+/g, " ").trim();
      const words = normalized.toLowerCase().split(" ").filter(Boolean);
      if (words.length === 0) {
        res.json({ results: [] });
        return;
      }

      const params: string[] = [];
      let paramIndex = 1;
      const conditions = words.map(w => {
        params.push(`%${w}%`);
        return `LOWER(REPLACE(REPLACE(s.name, '\u2605', ''), '|', '')) LIKE $${paramIndex++}`;
      });

      const { rows } = await pool.query(`
        SELECT s.name, s.weapon, s.rarity,
          STRING_AGG(DISTINCT c.name, ',') as collection_name
        FROM skins s
        LEFT JOIN skin_collections sc ON s.id = sc.skin_id
        LEFT JOIN collections c ON sc.collection_id = c.id
        WHERE ${conditions.join(" AND ")} AND s.stattrak = false
        GROUP BY s.name, s.weapon, s.rarity
        ORDER BY CASE s.rarity
          WHEN 'Extraordinary' THEN 6 WHEN 'Covert' THEN 5
          WHEN 'Classified' THEN 4 WHEN 'Restricted' THEN 3
          WHEN 'Mil-Spec' THEN 2 WHEN 'Industrial Grade' THEN 1
          WHEN 'Consumer Grade' THEN 0 ELSE -1
        END DESC, s.name ASC
        LIMIT 15
      `, params);

      res.json({ results: rows });
    },
  ));

  router.get("/api/data-freshness", cachedRoute((req) => `freshness:${req.query.since || ""}:${req.query.rarity || ""}:${req.query.stattrak || 0}`, 15, async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const tab = req.query.tab as string || "Covert";
      const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1;

      let filter = "";
      if (tab === "Covert") filter = "AND s.rarity = 'Covert' AND s.name NOT LIKE '★%'";
      else if (tab === "knife_glove") filter = "AND s.name LIKE '★%'";

      const { rows: [totalRow] } = await pool.query(`
        SELECT COUNT(*) as cnt FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE s.stattrak = $1 AND l.stattrak = $2 ${filter}
      `, [stattrak, stattrak]);
      const total = parseInt(totalRow.cnt);

      let newSince = 0;
      let newSales = 0;
      if (since) {
        const { rows: [newRow] } = await pool.query(`
          SELECT COUNT(*) as cnt FROM listings l JOIN skins s ON l.skin_id = s.id
          WHERE l.created_at > $1 AND s.stattrak = $2 AND l.stattrak = $3 ${filter}
        `, [since, stattrak, stattrak]);
        newSince = parseInt(newRow.cnt);

        const saleFilter = tab === "knife_glove" ? "AND skin_name LIKE '★%'" : tab === "Covert" ? "AND skin_name NOT LIKE '★%'" : "";
        const { rows: [saleRow] } = await pool.query(`
          SELECT COUNT(*) as cnt FROM sale_history
          WHERE sold_at > $1 ${saleFilter}
        `, [since]);
        newSales = parseInt(saleRow.cnt);
      }

      res.json({ totalListings: total, newListings: newSince, newSales });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  }));

  router.get("/api/collection-by-slug/:slug", async (req, res) => {
    try {
      const slugMap = await getCollectionSlugMap(pool);
      const name = slugMap.get(req.params.slug);
      if (!name) { res.status(404).json({ error: "Collection not found" }); return; }
      res.json({ name });
    } catch {
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/api/skin-by-slug/:slug", async (req, res) => {
    try {
      const slugMap = await getSlugMap(pool);
      const name = slugMap.get(req.params.slug);
      if (!name) { res.status(404).json({ error: "Skin not found" }); return; }
      res.json({ name });
    } catch {
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}

export async function getCollectionSlugMap(pool: pg.Pool): Promise<Map<string, string>> {
  const cached = await cacheGet<Record<string, string>>("collection_slug_map");
  if (cached) return new Map(Object.entries(cached));

  const { rows } = await pool.query("SELECT name FROM collections ORDER BY name");
  const map = new Map<string, string>();
  for (const r of rows) map.set(collectionToSlug(r.name), r.name);
  await cacheSet("collection_slug_map", Object.fromEntries(map), 600);
  return map;
}

export async function getSlugMap(pool: pg.Pool): Promise<Map<string, string>> {
  const cached = await cacheGet<Record<string, string>>("slug_map");
  if (cached) return new Map(Object.entries(cached));

  const { rows } = await pool.query("SELECT name FROM skins WHERE stattrak = false ORDER BY name");
  const map = new Map<string, string>();
  for (const r of rows) map.set(toSlug(r.name), r.name);
  await cacheSet("slug_map", Object.fromEntries(map), 600);
  return map;
}
