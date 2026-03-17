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
    const rarity = (req.query.rarity as string) || "all";
    const collection = (req.query.collection as string) || "";
    const outputCollection = (req.query.outputCollection as string) || "";
    const stattrak = parseInt(req.query.stattrak as string || "0", 10) === 1 ? 1 : 0;

    // Rarity filter: specific rarity, "knife_glove" for ★ items, "all" for everything
    let rarityFilter = "";
    const queryParams: (string | number)[] = [];
    if (rarity === "all" || rarity === "") {
      rarityFilter = ""; // no filter — show all rarities
    } else if (rarity === "Covert") {
      rarityFilter = "AND s.rarity = 'Covert' AND s.name NOT LIKE '★%'";
    } else if (rarity === "knife_glove") {
      rarityFilter = "AND s.name LIKE '★%'";
    } else if (["Classified", "Restricted", "Mil-Spec", "Extraordinary", "Consumer Grade", "Industrial Grade"].includes(rarity)) {
      rarityFilter = "AND s.rarity = ?";
      queryParams.push(rarity);
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

    // Collection filter — use WHERE subquery instead of JOIN to keep param order correct
    let collectionJoin = "";
    let collectionWhere = "";
    if (collection) {
      collectionWhere = "AND s.id IN (SELECT scf.skin_id FROM skin_collections scf JOIN collections cf ON scf.collection_id = cf.id WHERE cf.name = ?)";
      queryParams.push(collection);
    }
    if (search) queryParams.push(`%${search}%`);

    // Get the last cycle start time for (+N) counts
    const lastCycle = db.prepare(`
      SELECT started_at FROM daemon_cycle_stats ORDER BY id DESC LIMIT 1
    `).get() as { started_at: string } | undefined;
    const cycleStart = lastCycle?.started_at || new Date(Date.now() - 600000).toISOString();

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = (page - 1) * limit;

    // Fast query — no correlated subqueries. Listing stats via simple JOIN + GROUP BY.
    const skins = db.prepare(`
      SELECT MIN(s.id) as id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, ? as stattrak,
        GROUP_CONCAT(DISTINCT c.name) as collection_names,
        COUNT(DISTINCT l.id) as listing_count,
        MIN(l.price_cents) as min_price,
        ROUND(AVG(l.price_cents)) as avg_price,
        MAX(l.price_cents) as max_price,
        MIN(l.float_value) as min_float_seen,
        MAX(l.float_value) as max_float_seen
      FROM skins s
      LEFT JOIN skin_collections sc ON s.id = sc.skin_id
      LEFT JOIN collections c ON sc.collection_id = c.id
      LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = ?
      WHERE s.stattrak = ? ${rarityFilter} ${outputWeaponFilter} ${collectionWhere}
        ${search ? "AND s.name LIKE ?" : ""}
      GROUP BY s.name
      ORDER BY listing_count DESC
      LIMIT ? OFFSET ?
    `).all(stattrak, stattrak, stattrak, ...queryParams, limit, offset) as {
      id: string; name: string; rarity: string; weapon: string;
      min_float: number; max_float: number; stattrak: number;
      collection_names: string | null; listing_count: number;
      min_price: number | null; avg_price: number | null; max_price: number | null;
      min_float_seen: number | null; max_float_seen: number | null;
    }[];

    // Batch load price_data for all returned skins in one query
    const skinNames = skins.map(s => s.name);
    const priceMap = new Map<string, Record<string, Record<string, number>>>();
    if (skinNames.length > 0) {
      const placeholders = skinNames.map(() => "?").join(",");
      const allPrices = db.prepare(`
        SELECT skin_name, source, condition, avg_price_cents
        FROM price_data WHERE skin_name IN (${placeholders}) AND avg_price_cents > 0
      `).all(...skinNames) as { skin_name: string; source: string; condition: string; avg_price_cents: number }[];
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
      const ph = skinNames.map(() => "?").join(",");
      const saleCounts = db.prepare(`
        SELECT skin_name, COUNT(*) as cnt FROM (
          SELECT skin_name FROM sale_history WHERE skin_name IN (${ph})
          UNION ALL
          SELECT skin_name FROM price_observations WHERE skin_name IN (${ph}) AND source = 'sale'
        ) GROUP BY skin_name
      `).all(...skinNames, ...skinNames) as { skin_name: string; cnt: number }[];
      for (const r of saleCounts) saleCountMap.set(r.skin_name, r.cnt);
    }

    const result = skins.map((s) => {
      let collectionName = s.collection_names;
      if (!collectionName && s.name.startsWith("★")) {
        const weapon = s.weapon || s.name.replace(/^★\s*/, "").split(" | ")[0];
        const cases = knifeTypeToCases.get(weapon);
        if (cases && cases.length > 0) collectionName = cases.join(", ");
      }
      return { ...s, collection_name: collectionName, prices: priceMap.get(s.name) || {}, sale_count: saleCountMap.get(s.name) ?? 0 };
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

    // Doppler phase-specific prices (Phase 1-4 + gems)
    let phasePrices: Record<string, typeof priceSourceRows> | undefined;
    if (skinName.includes("Doppler")) {
      phasePrices = {};
      const phaseRows = db.prepare(`
        SELECT skin_name, source, condition, avg_price_cents, volume
        FROM price_data
        WHERE skin_name LIKE ? AND skin_name != ? AND avg_price_cents > 0
        ORDER BY skin_name, CASE source WHEN 'csfloat_sales' THEN 1 WHEN 'csfloat_ref' THEN 2 ELSE 3 END
      `).all(`${skinName}%`, skinName) as { skin_name: string; source: string; condition: string; avg_price_cents: number; volume: number }[];
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
    const saleHistory = db.prepare(`
      SELECT price_cents, float_value, sold_at FROM sale_history
      WHERE skin_name = ? AND price_cents > 0
      UNION
      SELECT price_cents, float_value, observed_at as sold_at FROM price_observations
      WHERE skin_name = ? AND source IN ('sale', 'listing', 'listing_dmarket', 'listing_skinport') AND price_cents > 0
      ORDER BY sold_at DESC
      LIMIT 300
    `).all(skinName, skinName) as { price_cents: number; float_value: number; sold_at: string }[];

    // Doppler: also collect phase-specific observations for per-phase scatter plots
    let phaseSales: Record<string, typeof saleHistory> | undefined;
    if (skinName.includes("Doppler")) {
      phaseSales = {};
      const phaseObs = db.prepare(`
        SELECT skin_name, price_cents, float_value, observed_at as sold_at FROM price_observations
        WHERE skin_name LIKE ? AND skin_name != ? AND price_cents > 0
        ORDER BY observed_at DESC LIMIT 1000
      `).all(`${skinName}%`, skinName) as { skin_name: string; price_cents: number; float_value: number; sold_at: string }[];
      for (const r of phaseObs) {
        const phase = r.skin_name.replace(skinName, "").trim();
        if (phase) {
          if (!phaseSales[phase]) phaseSales[phase] = [];
          phaseSales[phase].push({ price_cents: r.price_cents, float_value: r.float_value, sold_at: r.sold_at });
        }
      }
    }

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
      phasePrices, // Doppler only: per-phase price data
      phaseSales,  // Doppler only: per-phase sale observations
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
