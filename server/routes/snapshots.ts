import { Router } from "express";
import type Database from "better-sqlite3";
import { cachedRoute } from "../redis.js";

export function snapshotsRouter(db: Database.Database): Router {
  const router = Router();

  router.get("/api/snapshots", cachedRoute((req) => `snapshots:${req.query.since || ""}:${req.query.until || ""}:${req.query.type || ""}`, 86400, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const hours = parseInt(req.query.hours as string) || 24;

    const snapshots = db.prepare(`
      SELECT * FROM market_snapshots
      WHERE snapshot_at > datetime('now', '-' || ? || ' hours')
      ORDER BY snapshot_at DESC
      LIMIT ?
    `).all(hours, limit);

    res.json(snapshots);
  }));

  router.get("/api/snapshots/:id/tradeups", cachedRoute((req) => `snapshot_tu:${req.params.id}`, 86400, (req, res) => {
    const snapshotId = parseInt(req.params.id as string);
    const tradeups = db.prepare(`
      SELECT * FROM snapshot_tradeups
      WHERE snapshot_id = ?
      ORDER BY rank ASC
    `).all(snapshotId);

    res.json(tradeups);
  }));

  router.get("/api/snapshots/combo/:comboKey", cachedRoute((req) => `snapshot_combo:${req.params.comboKey}`, 43200, (req, res) => {
    const comboKey = req.params.comboKey;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const history = db.prepare(`
      SELECT st.*, ms.snapshot_at, ms.cycle
      FROM snapshot_tradeups st
      JOIN market_snapshots ms ON st.snapshot_id = ms.id
      WHERE st.combo_key = ?
      ORDER BY ms.snapshot_at DESC
      LIMIT ?
    `).all(comboKey, limit);

    res.json(history);
  }));

  return router;
}
