import { Router } from "express";
import pg from "pg";
import { cachedRoute } from "../redis.js";

type CollectionKnifePool = Map<string, { knifeTypes: string[]; gloveTypes: string[]; knifeFinishes: string[]; gloveFinishes: string[]; finishCount: number }>;

export function collectionsRouter(
  pool: pg.Pool,
  collectionKnifePool: CollectionKnifePool,
): Router {
  const router = Router();

  router.get("/api/collections", cachedRoute("collections", 300, async (_req, res) => {
    try {
      // Run all 3 independent queries in parallel
      const [{ rows: base }, { rows: lcRows }, { rows: psRows }] = await Promise.all([
        pool.query(`
          SELECT c.id, c.name,
            COUNT(DISTINCT sc.skin_id) as skin_count,
            SUM(CASE WHEN s.rarity = 'Covert' AND s.name NOT LIKE '★%' THEN 1 ELSE 0 END) as covert_count
          FROM collections c
          JOIN skin_collections sc ON c.id = sc.collection_id
          JOIN skins s ON sc.skin_id = s.id AND s.stattrak = false
          GROUP BY c.id, c.name
        `),
        pool.query(`
          SELECT sc.collection_id, COUNT(DISTINCT l.id) as cnt
          FROM listings l
          JOIN skins s ON l.skin_id = s.id
          JOIN skin_collections sc ON s.id = sc.skin_id
          WHERE l.stattrak = false
          GROUP BY sc.collection_id
        `),
        pool.query(`
          SELECT i.collection_name, COUNT(DISTINCT t.id) as cnt, MAX(t.profit_cents) as best
          FROM trade_ups t
          JOIN trade_up_inputs i ON t.id = i.trade_up_id
          WHERE t.is_theoretical = false AND t.profit_cents > 0
          GROUP BY i.collection_name
        `),
      ]);

      const listingCounts = new Map<string, number>();
      for (const r of lcRows) listingCounts.set(r.collection_id, parseInt(r.cnt));

      const profitStats = new Map<string, { cnt: number; best: number }>();
      for (const r of psRows) profitStats.set(r.collection_name, { cnt: parseInt(r.cnt), best: parseInt(r.best) });

      // Merge in JS
      const collections = base.map((c: any) => {
        const pool2 = collectionKnifePool.get(c.name);
        const ps = profitStats.get(c.name);
        return {
          name: c.name,
          skin_count: parseInt(c.skin_count),
          covert_count: parseInt(c.covert_count),
          listing_count: listingCounts.get(c.id) ?? 0,
          sale_count: 0, // skip sale_count query — low value, expensive
          profitable_count: ps?.cnt ?? 0,
          best_profit_cents: ps?.best ?? 0,
          knife_type_count: pool2?.knifeTypes.length ?? 0,
          glove_type_count: pool2?.gloveTypes.length ?? 0,
          finish_count: pool2?.finishCount ?? 0,
          has_knives: (pool2?.knifeTypes.length ?? 0) > 0,
          has_gloves: (pool2?.gloveTypes.length ?? 0) > 0,
        };
      });

      collections.sort((a: any, b: any) => b.listing_count - a.listing_count);

      res.json(collections);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  }));

  // Collection detail
  router.get("/api/collection/:name", (req, res) => {
    try {
      const collectionName = decodeURIComponent(req.params.name);
      const pool2 = collectionKnifePool.get(collectionName);
      const knifePool = pool2 ? {
        knifeTypes: pool2.knifeTypes,
        gloveTypes: pool2.gloveTypes,
        knifeFinishes: pool2.knifeFinishes,
        gloveFinishes: pool2.gloveFinishes,
        finishCount: pool2.finishCount,
      } : null;

      res.json({ collection: collectionName, knifePool });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
