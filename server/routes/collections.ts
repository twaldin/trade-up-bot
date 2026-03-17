import { Router } from "express";
import type Database from "better-sqlite3";

type CollectionKnifePool = Map<string, { knifeTypes: string[]; gloveTypes: string[]; finishCount: number }>;

export function collectionsRouter(
  db: Database.Database,
  collectionKnifePool: CollectionKnifePool,
): Router {
  const router = Router();

  // List all collections with skin counts and trade-up stats

  router.get("/api/collections", (_req, res) => {
    try {
      const collections = db.prepare(`
        SELECT c.name,
          COUNT(DISTINCT sc.skin_id) as skin_count,
          SUM(CASE WHEN s.rarity = 'Covert' AND s.name NOT LIKE '★%' THEN 1 ELSE 0 END) as covert_count,
          COALESCE((
            SELECT COUNT(DISTINCT l.id) FROM listings l
            JOIN skins s2 ON l.skin_id = s2.id
            JOIN skin_collections sc2 ON s2.id = sc2.skin_id
            WHERE sc2.collection_id = c.id AND l.stattrak = 0
          ), 0) as listing_count,
          COALESCE((
            SELECT COUNT(*) FROM sale_history sh
            JOIN skins s3 ON sh.skin_name = s3.name
            JOIN skin_collections sc3 ON s3.id = sc3.skin_id
            WHERE sc3.collection_id = c.id AND s3.stattrak = 0
          ), 0) as sale_count,
          COALESCE((
            SELECT COUNT(*) FROM trade_ups t
            JOIN trade_up_inputs i ON t.id = i.trade_up_id
            WHERE i.collection_name = c.name AND t.is_theoretical = 0 AND t.profit_cents > 0
          ), 0) as profitable_count,
          COALESCE((
            SELECT MAX(t.profit_cents) FROM trade_ups t
            JOIN trade_up_inputs i ON t.id = i.trade_up_id
            WHERE i.collection_name = c.name AND t.is_theoretical = 0 AND t.profit_cents > 0
          ), 0) as best_profit_cents
        FROM collections c
        JOIN skin_collections sc ON c.id = sc.collection_id
        JOIN skins s ON sc.skin_id = s.id AND s.stattrak = 0
        GROUP BY c.id, c.name
        ORDER BY listing_count DESC
      `).all() as {
        name: string; skin_count: number; covert_count: number;
        listing_count: number; sale_count: number;
        profitable_count: number; best_profit_cents: number;
      }[];

      // Enrich with knife/glove pool info
      const enriched = collections.map(c => {
        const pool = collectionKnifePool.get(c.name);
        return {
          ...c,
          knife_type_count: pool?.knifeTypes.length ?? 0,
          glove_type_count: pool?.gloveTypes.length ?? 0,
          finish_count: pool?.finishCount ?? 0,
          has_knives: (pool?.knifeTypes.length ?? 0) > 0,
          has_gloves: (pool?.gloveTypes.length ?? 0) > 0,
        };
      });

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Collection detail: trade-ups involving this collection

  router.get("/api/collection/:name", (req, res) => {
    try {
      const collectionName = decodeURIComponent(req.params.name);

      // Knife/glove pool from CASE_KNIFE_MAP
      const pool = collectionKnifePool.get(collectionName);
      const knifePool = pool ? {
        knifeTypes: pool.knifeTypes,
        gloveTypes: pool.gloveTypes,
        finishCount: pool.finishCount,
      } : null;

      res.json({ collection: collectionName, knifePool });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
