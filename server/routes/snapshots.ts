import { Router } from "express";
import pg from "pg";
import { cachedRoute } from "../redis.js";

export function snapshotsRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/api/snapshots", cachedRoute((req) => `snapshots:${req.query.since || ""}:${req.query.until || ""}:${req.query.type || ""}`, 86400, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const hours = parseInt(req.query.hours as string) || 24;

    const { rows: snapshots } = await pool.query(`
      SELECT * FROM market_snapshots
      WHERE snapshot_at > NOW() - $1 * INTERVAL '1 hour'
      ORDER BY snapshot_at DESC
      LIMIT $2
    `, [hours, limit]);

    res.json(snapshots);
  }));

  router.get("/api/snapshots/:id/tradeups", cachedRoute((req) => `snapshot_tu:${req.params.id}`, 86400, async (req, res) => {
    const snapshotId = parseInt(req.params.id as string);
    const { rows: tradeups } = await pool.query(`
      SELECT * FROM snapshot_tradeups
      WHERE snapshot_id = $1
      ORDER BY rank ASC
    `, [snapshotId]);

    res.json(tradeups);
  }));

  router.get("/api/snapshots/combo/:comboKey", cachedRoute((req) => `snapshot_combo:${req.params.comboKey}`, 43200, async (req, res) => {
    const comboKey = req.params.comboKey;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const { rows: history } = await pool.query(`
      SELECT st.*, ms.snapshot_at, ms.cycle
      FROM snapshot_tradeups st
      JOIN market_snapshots ms ON st.snapshot_id = ms.id
      WHERE st.combo_key = $1
      ORDER BY ms.snapshot_at DESC
      LIMIT $2
    `, [comboKey, limit]);

    res.json(history);
  }));

  return router;
}
