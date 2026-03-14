import { Router } from "express";
import type Database from "better-sqlite3";

type CollectionKnifePool = Map<string, { knifeTypes: string[]; gloveTypes: string[]; finishCount: number }>;
type KnifeTypeToCases = Map<string, string[]>;

export function dataRouter(
  db: Database.Database,
  knifeTypeToCases: KnifeTypeToCases,
  collectionKnifePool: CollectionKnifePool,
): Router {
  const router = Router();

  // Skin browser: list all Covert skins with listing stats and pricing

  router.get("/api/skin-data", (req, res) => {
    const search = (req.query.search as string) || "";
    const rarity = (req.query.rarity as string) || "Covert";
    const collection = (req.query.collection as string) || "";
    const outputCollection = (req.query.outputCollection as string) || "";
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

    // "Covert" = gun skins only, "knife_glove" = ★ items, "" = all
    let rarityFilter = "";
    const queryParams: (string | number)[] = [];
    if (rarity === "Covert") {
      rarityFilter = "AND s.rarity = 'Covert' AND s.name NOT LIKE '★%'";
    } else if (rarity === "Classified") {
      rarityFilter = "AND s.rarity = 'Classified'";
    } else if (rarity === "knife_glove") {
      rarityFilter = "AND s.name LIKE '★%'";
    }

    // Output collection filter: find knives/gloves from a specific case's pool
    let outputWeaponFilter = "";
    if (outputCollection) {
      const pool = collectionKnifePool.get(outputCollection);
      if (pool) {
        const weapons = [...pool.knifeTypes, ...pool.gloveTypes];
        if (weapons.length > 0) {
          const placeholders = weapons.map(() => "s.weapon = ?").join(" OR ");
          outputWeaponFilter = `AND s.name LIKE '★%' AND (${placeholders})`;
          queryParams.push(...weapons);
          rarityFilter = ""; // override rarity filter for output skins
        }
      }
    }

    // Collection filter
    let collectionJoin = "";
    let collectionFilter = "";
    if (collection) {
      collectionJoin = "JOIN skin_collections scf ON s.id = scf.skin_id JOIN collections cf ON scf.collection_id = cf.id AND cf.name = ?";
      queryParams.push(collection);
    }
    if (search) queryParams.push(`%${search}%`);

    // Get the last cycle start time for (+N) counts
    const lastCycle = db.prepare(`
      SELECT started_at FROM daemon_cycle_stats ORDER BY id DESC LIMIT 1
    `).get() as { started_at: string } | undefined;
    const cycleStart = lastCycle?.started_at || new Date(Date.now() - 600000).toISOString();

    // Deduplicate by skin name (Doppler skins have multiple IDs for phases)
    const skins = db.prepare(`
      SELECT MIN(s.id) as id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, ? as stattrak,
        GROUP_CONCAT(DISTINCT c.name) as collection_names,
        COUNT(DISTINCT l.id) as listing_count,
        MIN(l.price_cents) as min_price,
        ROUND(AVG(l.price_cents)) as avg_price,
        MAX(l.price_cents) as max_price,
        MIN(l.float_value) as min_float_seen,
        MAX(l.float_value) as max_float_seen,
        COALESCE((SELECT COUNT(*) FROM sale_history sh WHERE sh.skin_name = s.name), 0)
          + COALESCE((SELECT COUNT(*) FROM price_observations po WHERE po.skin_name = s.name AND po.source = 'sale'), 0) as sale_count,
        (SELECT COUNT(*) FROM listings nl JOIN skins ns ON nl.skin_id = ns.id
          WHERE ns.name = s.name AND nl.stattrak = ? AND nl.created_at > ?) as new_listings,
        (SELECT COUNT(*) FROM sale_history nsh WHERE nsh.skin_name = s.name AND nsh.sold_at > ?) as new_sales
      FROM skins s
      LEFT JOIN skin_collections sc ON s.id = sc.skin_id
      LEFT JOIN collections c ON sc.collection_id = c.id
      LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = ?
      ${collectionJoin}
      WHERE s.stattrak = ? ${rarityFilter} ${outputWeaponFilter}
        ${search ? "AND s.name LIKE ?" : ""}
      GROUP BY s.name
      ORDER BY listing_count DESC
    `).all(stattrak, stattrak, cycleStart, cycleStart, stattrak, stattrak, ...queryParams) as {
      id: string; name: string; rarity: string; weapon: string;
      min_float: number; max_float: number; stattrak: number;
      collection_names: string | null; listing_count: number;
      min_price: number | null; avg_price: number | null; max_price: number | null;
      min_float_seen: number | null; max_float_seen: number | null;
      sale_count: number; new_listings: number; new_sales: number;
    }[];

    // Attach price_data summary per skin
    const priceDataStmt = db.prepare(`
      SELECT source, condition, avg_price_cents, volume
      FROM price_data WHERE skin_name = ? AND avg_price_cents > 0
      ORDER BY CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'listing' THEN 2 WHEN 'csfloat_ref' THEN 3 WHEN 'skinport' THEN 4 ELSE 5 END
    `);

    const result = skins.map((s) => {
      const prices = priceDataStmt.all(s.name) as { source: string; condition: string; avg_price_cents: number; volume: number }[];
      const byCondition: Record<string, Record<string, number>> = {};
      for (const p of prices) {
        if (!byCondition[p.condition]) byCondition[p.condition] = {};
        byCondition[p.condition][p.source] = p.avg_price_cents;
      }
      // Resolve collection name(s)
      let collectionName = s.collection_names;
      if (!collectionName && s.name.startsWith("★")) {
        const weapon = s.weapon || s.name.replace(/^★\s*/, "").split(" | ")[0];
        const cases = knifeTypeToCases.get(weapon);
        if (cases && cases.length > 0) {
          collectionName = cases.join(", ");
        }
      }
      return { ...s, collection_name: collectionName, prices: byCondition };
    });

    res.json(result);
  });

  // Detailed skin data: listings, float price buckets, price observations

  router.get("/api/skin-data/:name", (req, res) => {
    const skinName = decodeURIComponent(req.params.name);
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

    // Listings (individual data points for scatter plot)
    const listings = db.prepare(`
      SELECT l.id, l.price_cents, l.float_value, l.created_at, l.staleness_checked_at, l.phase, l.source
      FROM listings l
      JOIN skins s ON l.skin_id = s.id
      WHERE s.name = ? AND l.stattrak = ?
      ORDER BY l.price_cents ASC
    `).all(skinName, stattrak) as { id: string; price_cents: number; float_value: number; created_at: string; staleness_checked_at: string | null; phase: string | null; source: string }[];

    // Float price buckets (theory pricing)
    const floatBuckets = db.prepare(`
      SELECT float_min, float_max, avg_price_cents, listing_count, last_checked
      FROM float_price_data
      WHERE skin_name = ?
      ORDER BY float_min
    `).all(skinName) as { float_min: number; float_max: number; avg_price_cents: number; listing_count: number; last_checked: string }[];

    // Price data (all sources)
    const priceSourceRows = db.prepare(`
      SELECT source, condition, avg_price_cents, volume
      FROM price_data
      WHERE skin_name = ? AND avg_price_cents > 0
      ORDER BY CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'listing' THEN 2 WHEN 'csfloat_ref' THEN 3 WHEN 'skinport' THEN 4 ELSE 5 END
    `).all(skinName) as { source: string; condition: string; avg_price_cents: number; volume: number }[];

    // Sale history: combine CSFloat sales + sold listings (deduplicated)
    const saleHistory = db.prepare(`
      SELECT price_cents, float_value, sold_at FROM sale_history
      WHERE skin_name = ? AND price_cents > 0
      UNION
      SELECT price_cents, float_value, observed_at as sold_at FROM price_observations
      WHERE skin_name = ? AND source = 'sale' AND price_cents > 0
      ORDER BY sold_at DESC
      LIMIT 300
    `).all(skinName, skinName) as { price_cents: number; float_value: number; sold_at: string }[];

    // Skin metadata
    const skin = db.prepare(`
      SELECT s.id, s.name, s.rarity, s.weapon, s.min_float, s.max_float,
        c.name as collection_name
      FROM skins s
      LEFT JOIN skin_collections sc ON s.id = sc.skin_id
      LEFT JOIN collections c ON sc.collection_id = c.id
      WHERE s.name = ? AND s.stattrak = ?
      LIMIT 1
    `).get(skinName, stattrak) as { id: string; name: string; rarity: string; weapon: string; min_float: number; max_float: number; collection_name: string | null } | undefined;

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
    const totalSaleCount = (db.prepare(`
      SELECT (SELECT COUNT(*) FROM sale_history WHERE skin_name = ?)
           + (SELECT COUNT(*) FROM price_observations WHERE skin_name = ? AND source = 'sale')
           as cnt
    `).get(skinName, skinName) as { cnt: number }).cnt;

    res.json({
      skin: { ...skin, collection_name: resolvedCollectionName },
      listings,
      floatBuckets,
      priceSources: priceSourceRows,
      saleHistory,
      stats: {
        totalListings: listings.length,
        checkedListings: listings.filter(l => l.staleness_checked_at).length,
        minPrice: listings.length > 0 ? listings[0].price_cents : null,
        maxPrice: listings.length > 0 ? listings[listings.length - 1].price_cents : null,
        saleCount: totalSaleCount,
      },
    });
  });

  router.get("/api/data-freshness", (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const tab = req.query.tab as string || "Covert";
      const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

      let filter = "";
      if (tab === "Covert") filter = "AND s.rarity = 'Covert' AND s.name NOT LIKE '★%'";
      else if (tab === "knife_glove") filter = "AND s.name LIKE '★%'";

      const total = (db.prepare(`
        SELECT COUNT(*) as cnt FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE s.stattrak = ? AND l.stattrak = ? ${filter}
      `).get(stattrak, stattrak) as { cnt: number }).cnt;

      let newSince = 0;
      let newSales = 0;
      if (since) {
        newSince = (db.prepare(`
          SELECT COUNT(*) as cnt FROM listings l JOIN skins s ON l.skin_id = s.id
          WHERE l.created_at > ? AND s.stattrak = ? AND l.stattrak = ? ${filter}
        `).get(since, stattrak, stattrak) as { cnt: number }).cnt;

        newSales = (db.prepare(`
          SELECT COUNT(*) as cnt FROM sale_history
          WHERE sold_at > ?
          ${tab === "knife_glove" ? "AND skin_name LIKE '★%'" : tab === "Covert" ? "AND skin_name NOT LIKE '★%'" : ""}
        `).get(since) as { cnt: number }).cnt;
      }

      res.json({ totalListings: total, newListings: newSince, newSales });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
