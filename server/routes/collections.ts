import { Router } from "express";
import type Database from "better-sqlite3";

type CollectionKnifePool = Map<string, { knifeTypes: string[]; gloveTypes: string[]; finishCount: number }>;

export function collectionsRouter(
  db: Database.Database,
  collectionKnifePool: CollectionKnifePool,
): Router {
  const router = Router();

  // Cache collections response — invalidates on daemon cycle change
  let collectionsCache: { data: any; calcTs: string; ts: number } | null = null;

  router.get("/api/collections", (_req, res) => {
    // Serve cache if fresh (< 60s and same daemon cycle)
    try {
      const row = db.prepare("SELECT value FROM sync_meta WHERE key = 'last_calculation'").get() as { value: string } | undefined;
      const calcTs = row?.value || "";
      if (collectionsCache && collectionsCache.calcTs === calcTs && Date.now() - collectionsCache.ts < 60_000) {
        res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        return res.json(collectionsCache.data);
      }
    } catch {
      if (collectionsCache) return res.json(collectionsCache.data);
    }

    try {
      // Batch query 1: base collection info (single GROUP BY, no correlated subqueries)
      const base = db.prepare(`
        SELECT c.id, c.name,
          COUNT(DISTINCT sc.skin_id) as skin_count,
          SUM(CASE WHEN s.rarity = 'Covert' AND s.name NOT LIKE '★%' THEN 1 ELSE 0 END) as covert_count
        FROM collections c
        JOIN skin_collections sc ON c.id = sc.collection_id
        JOIN skins s ON sc.skin_id = s.id AND s.stattrak = 0
        GROUP BY c.id, c.name
      `).all() as { id: string; name: string; skin_count: number; covert_count: number }[];

      // Batch query 2: listing counts per collection (single pass over listings)
      const listingCounts = new Map<string, number>();
      const lcRows = db.prepare(`
        SELECT sc.collection_id, COUNT(DISTINCT l.id) as cnt
        FROM listings l
        JOIN skins s ON l.skin_id = s.id
        JOIN skin_collections sc ON s.id = sc.skin_id
        WHERE l.stattrak = 0
        GROUP BY sc.collection_id
      `).all() as { collection_id: string; cnt: number }[];
      for (const r of lcRows) listingCounts.set(r.collection_id, r.cnt);

      // Batch query 3: profitable trade-up stats per collection name
      const profitStats = new Map<string, { cnt: number; best: number }>();
      const psRows = db.prepare(`
        SELECT i.collection_name, COUNT(DISTINCT t.id) as cnt, MAX(t.profit_cents) as best
        FROM trade_ups t
        JOIN trade_up_inputs i ON t.id = i.trade_up_id
        WHERE t.is_theoretical = 0 AND t.profit_cents > 0
        GROUP BY i.collection_name
      `).all() as { collection_name: string; cnt: number; best: number }[];
      for (const r of psRows) profitStats.set(r.collection_name, { cnt: r.cnt, best: r.best });

      // Merge in JS
      const collections = base.map(c => {
        const pool = collectionKnifePool.get(c.name);
        const ps = profitStats.get(c.name);
        return {
          name: c.name,
          skin_count: c.skin_count,
          covert_count: c.covert_count,
          listing_count: listingCounts.get(c.id) ?? 0,
          sale_count: 0, // skip sale_count query — low value, expensive
          profitable_count: ps?.cnt ?? 0,
          best_profit_cents: ps?.best ?? 0,
          knife_type_count: pool?.knifeTypes.length ?? 0,
          glove_type_count: pool?.gloveTypes.length ?? 0,
          finish_count: pool?.finishCount ?? 0,
          has_knives: (pool?.knifeTypes.length ?? 0) > 0,
          has_gloves: (pool?.gloveTypes.length ?? 0) > 0,
        };
      });

      collections.sort((a, b) => b.listing_count - a.listing_count);

      const calcTs = (db.prepare("SELECT value FROM sync_meta WHERE key = 'last_calculation'").get() as { value: string } | undefined)?.value || "";
      collectionsCache = { data: collections, calcTs, ts: Date.now() };
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json(collections);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Collection detail
  router.get("/api/collection/:name", (req, res) => {
    try {
      const collectionName = decodeURIComponent(req.params.name);
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
