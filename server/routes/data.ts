import { Router } from "express";
import pg from "pg";
import { cachedRoute } from "../redis.js";

type CollectionKnifePool = Map<string, { knifeTypes: string[]; gloveTypes: string[]; finishCount: number }>;
type KnifeTypeToCases = Map<string, string[]>;

export function dataRouter(
  pool: pg.Pool,
  knifeTypeToCases: KnifeTypeToCases,
  collectionKnifePool: CollectionKnifePool,
): Router {
  const router = Router();

  // Skin browser: list all Covert skins with listing stats and pricing

  router.get("/api/skin-data", cachedRoute((req) => `skins:${req.query.rarity}:${req.query.collection || ""}:${req.query.outputCollection || ""}:${req.query.page || 1}:${req.query.stattrak || 0}`, 120, async (req, res) => {
    const search = (req.query.search as string) || "";
    const rarity = (req.query.rarity as string) || "all";
    const collection = (req.query.collection as string) || "";
    const outputCollection = (req.query.outputCollection as string) || "";
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

    // Build params array with numbered placeholders
    // First 3 params are always stattrak (for the literal column, the join, and the where)
    const params: (string | number)[] = [stattrak, stattrak, stattrak];
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
    let outputWeaponFilter = "";
    if (outputCollection) {
      const poolData = collectionKnifePool.get(outputCollection);
      if (poolData) {
        const weapons = [...poolData.knifeTypes, ...poolData.gloveTypes];
        if (weapons.length > 0) {
          const placeholders = weapons.map((_, i) => `s.weapon = $${paramIndex + i}`).join(" OR ");
          outputWeaponFilter = `AND s.name LIKE '★%' AND (${placeholders})`;
          params.push(...weapons);
          paramIndex += weapons.length;
          rarityFilter = ""; // override rarity filter for output skins
        }
      }
    }

    // Collection filter — use WHERE subquery instead of JOIN to keep param order correct
    let collectionWhere = "";
    if (collection) {
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

    // Get the last cycle start time for (+N) counts
    const { rows: cycleRows } = await pool.query(`
      SELECT started_at FROM daemon_cycle_stats ORDER BY id DESC LIMIT 1
    `);
    const cycleStart = cycleRows[0]?.started_at || new Date(Date.now() - 600000).toISOString();

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
      SELECT MIN(s.id) as id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, $1::int as stattrak,
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
      LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = $2::int
      WHERE s.stattrak = $3::int ${rarityFilter} ${outputWeaponFilter} ${collectionWhere}
        ${searchFilter}
      GROUP BY s.name, s.rarity, s.weapon, s.min_float, s.max_float
      ORDER BY listing_count DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, params);

    // Batch load price_data for all returned skins in one query
    const skinNames = skins.map((s: any) => s.name);
    const priceMap = new Map<string, Record<string, Record<string, number>>>();
    if (skinNames.length > 0) {
      const placeholders = skinNames.map((_: any, i: number) => `$${i + 1}`).join(",");
      const { rows: allPrices } = await pool.query(`
        SELECT skin_name, source, condition, avg_price_cents
        FROM price_data WHERE skin_name IN (${placeholders}) AND avg_price_cents > 0
      `, skinNames);
      for (const p of allPrices) {
        if (!priceMap.has(p.skin_name)) priceMap.set(p.skin_name, {});
        const byC = priceMap.get(p.skin_name)!;
        if (!byC[p.condition]) byC[p.condition] = {};
        byC[p.condition][p.source] = p.avg_price_cents;
      }
    }

    // Batch load sale counts (sale_history + price_observations)
    const saleCountMap = new Map<string, number>();
    if (skinNames.length > 0) {
      const ph = skinNames.map((_: any, i: number) => `$${i + 1}`).join(",");
      const ph2 = skinNames.map((_: any, i: number) => `$${skinNames.length + i + 1}`).join(",");
      const { rows: saleCounts } = await pool.query(`
        SELECT skin_name, COUNT(*) as cnt FROM (
          SELECT skin_name FROM sale_history WHERE skin_name IN (${ph})
          UNION ALL
          SELECT skin_name FROM price_observations WHERE skin_name IN (${ph2}) AND source = 'sale'
        ) sub GROUP BY skin_name
      `, [...skinNames, ...skinNames]);
      for (const r of saleCounts) saleCountMap.set(r.skin_name, parseInt(r.cnt));
    }

    const result = skins.map((s: any) => {
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

  router.get("/api/skin-data/:name", cachedRoute((req) => `skin_detail:${req.params.name}`, 60, async (req, res) => {
    const skinName = decodeURIComponent(req.params.name as string);
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

    // Listings (individual data points for scatter plot)
    const { rows: listings } = await pool.query(`
      SELECT l.id, l.price_cents, l.float_value, l.created_at, l.staleness_checked_at, l.phase, l.source
      FROM listings l
      JOIN skins s ON l.skin_id = s.id
      WHERE s.name = $1 AND l.stattrak = $2
      ORDER BY l.price_cents ASC
    `, [skinName, stattrak]);

    // Float price buckets (theory pricing)
    const { rows: floatBuckets } = await pool.query(`
      SELECT float_min, float_max, avg_price_cents, listing_count, last_checked
      FROM float_price_data
      WHERE skin_name = $1
      ORDER BY float_min
    `, [skinName]);

    // Price data (all sources)
    const { rows: priceSourceRows } = await pool.query(`
      SELECT source, condition, avg_price_cents, volume
      FROM price_data
      WHERE skin_name = $1 AND avg_price_cents > 0
      ORDER BY CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'listing' THEN 2 WHEN 'csfloat_ref' THEN 3 WHEN 'skinport' THEN 4 ELSE 5 END
    `, [skinName]);

    // Doppler phase-specific prices (Phase 1-4 + gems)
    let phasePrices: Record<string, typeof priceSourceRows> | undefined;
    if (skinName.includes("Doppler")) {
      phasePrices = {};
      const { rows: phaseRows } = await pool.query(`
        SELECT skin_name, source, condition, avg_price_cents, volume
        FROM price_data
        WHERE skin_name LIKE $1 AND skin_name != $2 AND avg_price_cents > 0
        ORDER BY skin_name, CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'csfloat_ref' THEN 2 ELSE 3 END
      `, [`${skinName}%`, skinName]);
      for (const r of phaseRows) {
        // Extract phase from name: "★ Bayonet | Doppler Phase 2" → "Phase 2"
        const phase = r.skin_name.replace(skinName, "").trim();
        if (phase) {
          if (!phasePrices[phase]) phasePrices[phase] = [];
          phasePrices[phase].push({ source: r.source, condition: r.condition, avg_price_cents: r.avg_price_cents, volume: r.volume });
        }
      }
    }

    // Sale history: combine CSFloat sales + sold listings + listing observations (deduplicated)
    const { rows: saleHistory } = await pool.query(`
      SELECT price_cents, float_value, sold_at FROM sale_history
      WHERE skin_name = $1 AND price_cents > 0
      UNION
      SELECT price_cents, float_value, observed_at as sold_at FROM price_observations
      WHERE skin_name = $1 AND source IN ('sale', 'listing', 'listing_dmarket', 'listing_skinport') AND price_cents > 0
      ORDER BY sold_at DESC
      LIMIT 300
    `, [skinName]);

    // Doppler: also collect phase-specific observations for per-phase scatter plots
    let phaseSales: Record<string, typeof saleHistory> | undefined;
    if (skinName.includes("Doppler")) {
      phaseSales = {};
      const { rows: phaseObs } = await pool.query(`
        SELECT skin_name, price_cents, float_value, observed_at as sold_at FROM price_observations
        WHERE skin_name LIKE $1 AND skin_name != $2 AND price_cents > 0
        ORDER BY observed_at DESC LIMIT 1000
      `, [`${skinName}%`, skinName]);
      for (const r of phaseObs) {
        const phase = r.skin_name.replace(skinName, "").trim();
        if (phase) {
          if (!phaseSales[phase]) phaseSales[phase] = [];
          phaseSales[phase].push({ price_cents: r.price_cents, float_value: r.float_value, sold_at: r.sold_at });
        }
      }
    }

    // Skin metadata
    const { rows: [skin] } = await pool.query(`
      SELECT s.id, s.name, s.rarity, s.weapon, s.min_float, s.max_float,
        c.name as collection_name
      FROM skins s
      LEFT JOIN skin_collections sc ON s.id = sc.skin_id
      LEFT JOIN collections c ON sc.collection_id = c.id
      WHERE s.name = $1 AND s.stattrak = $2
      LIMIT 1
    `, [skinName, stattrak]);

    if (!skin) {
      res.status(404).json({ error: "Skin not found" });
      return;
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

    // Actual total sale count (not limited by the 300-row fetch)
    const { rows: [saleCountRow] } = await pool.query(`
      SELECT (SELECT COUNT(*) FROM sale_history WHERE skin_name = $1)
           + (SELECT COUNT(*) FROM price_observations WHERE skin_name = $1 AND source = 'sale')
           as cnt
    `, [skinName]);
    const totalSaleCount = parseInt(saleCountRow.cnt);

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

  router.get("/api/data-freshness", cachedRoute((req) => `freshness:${req.query.since || ""}:${req.query.rarity || ""}:${req.query.stattrak || 0}`, 15, async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const tab = req.query.tab as string || "Covert";
      const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

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

  return router;
}
