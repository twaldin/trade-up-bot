import { Router } from "express";
import pg from "pg";
import { batchInputValueRatios } from "../engine.js";
import { floatToCondition } from "../../shared/types.js";
import { cacheGet, cacheSet } from "../redis.js";

interface SniperListing {
  id: string;
  skin_name: string;
  condition: string;
  float_value: number;
  listed_price_cents: number;
  estimated_price_cents: number;
  diff_cents: number;
  diff_pct: number;
  source: string;
  marketplace_id: string | null;
  stattrak: boolean;
}

export function listingSniperRouter(pool: pg.Pool): Router {
  const router = Router();

  // Filter options for the sniper UI
  router.get("/api/listing-sniper/filter-options", async (_req, res) => {
    try {
      const cached = await cacheGet<{ skins: string[]; collections: string[] }>("sniper_filter_opts").catch(() => null);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached);
        return;
      }
      const [skinRows, collectionRows] = await Promise.all([
        pool.query<{ name: string }>(
          `SELECT DISTINCT s.name FROM listings l JOIN skins s ON s.id = l.skin_id ORDER BY s.name LIMIT 2000`
        ),
        pool.query<{ name: string }>(
          `SELECT DISTINCT c.name
           FROM listings l
           JOIN skin_collections sc ON sc.skin_id = l.skin_id
           JOIN collections c ON c.id = sc.collection_id
           ORDER BY c.name LIMIT 500`
        ),
      ]);
      const result = {
        skins: skinRows.rows.map(r => r.name),
        collections: collectionRows.rows.map(r => r.name),
      };
      await cacheSet("sniper_filter_opts", result, 3600).catch(() => {});
      res.json(result);
    } catch (err) {
      console.error("listing-sniper filter-options error:", err instanceof Error ? err.message : err);
      res.json({ skins: [], collections: [] });
    }
  });

  router.get("/api/listing-sniper", async (req, res) => {
    try {
      const {
        skin = "",
        collection = "",
        markets = "",
        min_diff = "0",
        sort = "diff_pct",
        order = "desc",
        page = "1",
        per_page = "50",
      } = req.query as Record<string, string>;

      const conditions: string[] = ["l.listing_type = 'buy_now'"];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (skin) {
        const skinList = skin.split("||").filter(Boolean);
        if (skinList.length === 1) {
          conditions.push(`s.name = $${paramIdx++}`);
          params.push(skinList[0]);
        } else if (skinList.length > 1) {
          const placeholders = skinList.map(() => `$${paramIdx++}`).join(", ");
          conditions.push(`s.name IN (${placeholders})`);
          params.push(...skinList);
        }
      }

      if (markets) {
        const marketList = markets.split(",").filter(Boolean);
        if (marketList.length > 0) {
          const placeholders = marketList.map(() => `$${paramIdx++}`).join(", ");
          conditions.push(`l.source IN (${placeholders})`);
          params.push(...marketList);
        }
      }

      if (collection) {
        const collectionList = collection.split("|").filter(Boolean);
        if (collectionList.length > 0) {
          const collPlaceholders = collectionList.map(() => `$${paramIdx++}`).join(", ");
          conditions.push(`EXISTS (
            SELECT 1 FROM skin_collections sc2
            JOIN collections c2 ON c2.id = sc2.collection_id
            WHERE sc2.skin_id = l.skin_id AND c2.name IN (${collPlaceholders})
          )`);
          params.push(...collectionList);
        }
      }

      const whereStr = `WHERE ${conditions.join(" AND ")}`;

      const { rows } = await pool.query<{
        id: string;
        skin_name: string;
        float_value: number;
        price_cents: number;
        source: string;
        marketplace_id: string | null;
        stattrak: boolean;
      }>(
        `SELECT l.id, s.name as skin_name, l.float_value, l.price_cents, l.source, l.marketplace_id, l.stattrak
         FROM listings l
         JOIN skins s ON s.id = l.skin_id
         ${whereStr}
         LIMIT 5000`,
        params
      );

      if (rows.length === 0) {
        res.json({ listings: [], total: 0, page: parseInt(page), per_page: parseInt(per_page) });
        return;
      }

      // Batch compute KNN value ratios in-memory (fast after cache warm)
      const ratios = await batchInputValueRatios(pool, rows.map(r => ({
        id: r.id,
        skin_name: r.skin_name,
        float_value: r.float_value,
        price_cents: r.price_cents,
      })));

      // min_diff arrives in cents
      const minDiffCents = parseInt(min_diff) || 0;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const perPageNum = Math.min(100, Math.max(1, parseInt(per_page) || 50));

      const results: SniperListing[] = [];
      for (const row of rows) {
        const ratio = ratios.get(row.id) ?? 1.0;
        if (ratio >= 1.0) continue; // Not underpriced or no KNN data

        const estimatedCents = Math.round(row.price_cents / ratio);
        const diffCents = estimatedCents - row.price_cents;

        if (diffCents < minDiffCents) continue;

        results.push({
          id: row.id,
          skin_name: row.skin_name,
          condition: floatToCondition(row.float_value),
          float_value: row.float_value,
          listed_price_cents: row.price_cents,
          estimated_price_cents: estimatedCents,
          diff_cents: diffCents,
          diff_pct: (diffCents / row.price_cents) * 100,
          source: row.source,
          marketplace_id: row.marketplace_id ?? null,
          stattrak: row.stattrak,
        });
      }

      // Sort in memory
      const direction = order === "asc" ? 1 : -1;
      results.sort((a, b) => {
        switch (sort) {
          case "diff_cents": return direction * (a.diff_cents - b.diff_cents);
          case "listed_price": return direction * (a.listed_price_cents - b.listed_price_cents);
          case "estimated_price": return direction * (a.estimated_price_cents - b.estimated_price_cents);
          case "float": return direction * (a.float_value - b.float_value);
          default: return direction * (a.diff_pct - b.diff_pct); // diff_pct
        }
      });

      const total = results.length;
      const offset = (pageNum - 1) * perPageNum;
      const paged = results.slice(offset, offset + perPageNum);

      res.json({ listings: paged, total, page: pageNum, per_page: perPageNum });
    } catch (err) {
      console.error("listing-sniper error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
