import { Router } from "express";
import pg from "pg";
import { requireTier, type User } from "../auth.js";
import { VALID_MARKETPLACES } from "../../shared/my-trade-ups-types.js";

export default function myTradeUpsRouter(pool: pg.Pool): Router {
  const router = Router();

  // ── GET /api/my-trade-ups/stats ────────────────────────────────────────
  // Must be registered BEFORE /:id to avoid Express shadowing.
  router.get("/api/my-trade-ups/stats", requireTier("basic", "pro"), async (req, res) => {
    const userId = (req.user as User).steam_id;

    const { rows: [sold] } = await pool.query(
      `SELECT
         COALESCE(SUM(actual_profit_cents), 0)::int AS all_time_profit_cents,
         COUNT(*)::int AS total_sold,
         COUNT(*) FILTER (WHERE actual_profit_cents > 0)::int AS win_count,
         CASE WHEN COUNT(*) = 0 THEN 0
              ELSE ROUND((COUNT(*) FILTER (WHERE actual_profit_cents > 0)::numeric / COUNT(*) * 100), 2)
         END AS win_rate,
         CASE WHEN COUNT(*) = 0 THEN 0
              ELSE ROUND(AVG(actual_profit_cents::numeric / total_cost_cents * 100), 2)
         END AS avg_roi
       FROM user_trade_ups
       WHERE user_id = $1 AND status = 'sold'`,
      [userId]
    );

    const { rows: [exec] } = await pool.query(
      `SELECT COUNT(*)::int AS total_executed
       FROM user_trade_ups
       WHERE user_id = $1 AND status IN ('executed', 'sold')`,
      [userId]
    );

    res.json({
      all_time_profit_cents: sold.all_time_profit_cents,
      total_executed: exec.total_executed,
      total_sold: sold.total_sold,
      win_count: sold.win_count,
      win_rate: parseFloat(sold.win_rate),
      avg_roi: parseFloat(sold.avg_roi),
    });
  });

  // ── GET /api/my-trade-ups ──────────────────────────────────────────────
  router.get("/api/my-trade-ups", requireTier("basic", "pro"), async (req, res) => {
    const userId = (req.user as User).steam_id;
    const statusFilter = req.query.status as string | undefined;

    let query = "SELECT * FROM user_trade_ups WHERE user_id = $1";
    const params: (string | string[])[] = [userId];

    if (statusFilter) {
      const statuses = statusFilter.split(",").map(s => s.trim());
      const placeholders = statuses.map((_, i) => `$${i + 2}`).join(", ");
      query += ` AND status IN (${placeholders})`;
      params.push(...statuses);
    }

    query += " ORDER BY purchased_at DESC";

    const { rows } = await pool.query(query, params);
    res.json({ trade_ups: rows });
  });

  // ── POST /api/my-trade-ups/:id/execute ─────────────────────────────────
  router.post("/api/my-trade-ups/:id/execute", requireTier("basic", "pro"), async (req, res) => {
    const utId = parseInt(String(req.params.id));
    if (isNaN(utId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const userId = (req.user as User).steam_id;
    const { outcome_index } = req.body;

    if (typeof outcome_index !== "number") {
      res.status(400).json({ error: "outcome_index is required and must be a number" });
      return;
    }

    // Load the entry
    const { rows: [entry] } = await pool.query(
      "SELECT * FROM user_trade_ups WHERE id = $1 AND user_id = $2",
      [utId, userId]
    );

    if (!entry) {
      res.status(404).json({ error: "Trade-up entry not found" });
      return;
    }

    if (entry.status !== "purchased") {
      res.status(400).json({ error: "Can only execute a purchased trade-up" });
      return;
    }

    const outcomes = entry.snapshot_outcomes;
    if (outcome_index < 0 || outcome_index >= outcomes.length) {
      res.status(400).json({ error: `Invalid outcome_index: must be 0–${outcomes.length - 1}` });
      return;
    }

    const outcome = outcomes[outcome_index];

    await pool.query(
      `UPDATE user_trade_ups
       SET status = 'executed',
           executed_at = NOW(),
           outcome_skin_id = $2,
           outcome_skin_name = $3,
           outcome_condition = $4,
           outcome_float = $5
       WHERE id = $1`,
      [utId, outcome.skin_id, outcome.skin_name, outcome.condition, outcome.predicted_float]
    );

    const { rows: [updated] } = await pool.query("SELECT * FROM user_trade_ups WHERE id = $1", [utId]);
    res.json(updated);
  });

  // ── POST /api/my-trade-ups/:id/sell ────────────────────────────────────
  router.post("/api/my-trade-ups/:id/sell", requireTier("basic", "pro"), async (req, res) => {
    const utId = parseInt(String(req.params.id));
    if (isNaN(utId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const userId = (req.user as User).steam_id;
    const { price_cents, marketplace } = req.body;

    if (typeof price_cents !== "number" || price_cents <= 0) {
      res.status(400).json({ error: "price_cents is required and must be a positive number" });
      return;
    }

    if (!marketplace || !(VALID_MARKETPLACES as readonly string[]).includes(marketplace)) {
      res.status(400).json({ error: `Invalid marketplace. Valid: ${VALID_MARKETPLACES.join(", ")}` });
      return;
    }

    // Load the entry
    const { rows: [entry] } = await pool.query(
      "SELECT * FROM user_trade_ups WHERE id = $1 AND user_id = $2",
      [utId, userId]
    );

    if (!entry) {
      res.status(404).json({ error: "Trade-up entry not found" });
      return;
    }

    if (entry.status !== "executed") {
      res.status(400).json({ error: "Can only sell an executed trade-up" });
      return;
    }

    const actualProfit = price_cents - entry.total_cost_cents;

    // Transaction: update entry + insert price observation
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE user_trade_ups
         SET status = 'sold',
             sold_at = NOW(),
             sold_price_cents = $2,
             sold_marketplace = $3,
             actual_profit_cents = $4
         WHERE id = $1`,
        [utId, price_cents, marketplace, actualProfit]
      );

      // User-reported sale price stored in user_trade_ups (sold_price_cents) only.
      // Not written to price_observations — user reports are unverified and can
      // contain outliers that pollute KNN pricing.

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows: [updated] } = await pool.query("SELECT * FROM user_trade_ups WHERE id = $1", [utId]);
    res.json(updated);
  });

  // ── DELETE /api/my-trade-ups/:id ───────────────────────────────────────
  router.delete("/api/my-trade-ups/:id", requireTier("basic", "pro"), async (req, res) => {
    const utId = parseInt(String(req.params.id));
    if (isNaN(utId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const userId = (req.user as User).steam_id;

    const result = await pool.query(
      "DELETE FROM user_trade_ups WHERE id = $1 AND user_id = $2",
      [utId, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Trade-up entry not found" });
      return;
    }

    res.json({ deleted: true });
  });

  return router;
}
