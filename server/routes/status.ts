import { Router } from "express";
import pg from "pg";
import fs from "fs";
import { getSyncMeta } from "../db.js";
import { cachedRoute } from "../redis.js";
import { buildStatusData } from "./status-helpers.js";

export function statusRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/api/status", cachedRoute("status", 1800, async (_req, res) => {
    const result = await buildStatusData(pool);
    res.json(result);
  }));

  // Global stats: Redis-first, DB fallback with 3s timeout.
  // The COUNT(*) on 1M+ row trade_ups table takes 50s+ during WAL contention.
  // Daemon pre-populates Redis every cycle. API should almost never hit DB.
  router.get("/api/global-stats", async (_req, res) => {
    try {
      // Try Redis first (populated by daemon every cycle)
      const { cacheGet } = await import("../redis.js");
      const cached = await cacheGet<Record<string, unknown>>("global_stats");
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached);
        return;
      }
    } catch { /* Redis unavailable */ }

    // Redis miss: fall back to DB
    try {
      const { rows: [stats] } = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM trade_ups WHERE is_theoretical = false) as total_tu,
          (SELECT SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) FROM trade_ups WHERE is_theoretical = false) as profitable_tu,
          (SELECT COUNT(*) FROM listings) as listings,
          (SELECT COUNT(*) FROM price_observations) as sale_obs,
          (SELECT COUNT(*) FROM sale_history) as sale_hist,
          (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as refs,
          (SELECT COUNT(*) FROM daemon_cycle_stats) as cycles
      `);

      const data = {
        total_trade_ups: parseInt(stats.total_tu),
        profitable_trade_ups: parseInt(stats.profitable_tu) ?? 0,
        total_data_points: parseInt(stats.listings) + parseInt(stats.sale_obs) + parseInt(stats.sale_hist) + parseInt(stats.refs),
        listings: parseInt(stats.listings),
        sale_observations: parseInt(stats.sale_obs),
        sale_history: parseInt(stats.sale_hist),
        ref_prices: parseInt(stats.refs),
        total_cycles: parseInt(stats.cycles),
      };

      // Cache in Redis for next request
      const { cacheSet } = await import("../redis.js");
      await cacheSet("global_stats", data, 60).catch(() => {});

      res.setHeader("X-Cache", "MISS");
      res.json(data);
    } catch {
      res.json({});
    }
  });

  router.get("/api/daemon-log", cachedRoute("daemon_log", 30, async (_req, res) => {
    const logPath = "/tmp/daemon.log";
    const MAX_LINES = 500;

    try {
      if (!fs.existsSync(logPath)) {
        res.json({ lines: [], currentPhase: "Unknown" });
        return;
      }

      const content = fs.readFileSync(logPath, "utf-8");
      const allLines = content.split("\n");
      const lines = allLines.slice(-MAX_LINES);

      // Parse current phase from log lines (search backwards)
      let currentPhase = "Unknown";
      const phasePatterns: { pattern: RegExp; label: string }[] = [
        { pattern: /Phase 1: Housekeeping/i, label: "Housekeeping" },
        { pattern: /Phase 3: API Probe/i, label: "API Probe" },
        { pattern: /Phase 4: Data Fetch/i, label: "Data Fetch" },
        { pattern: /Phase 5: Time-Bounded Engine/i, label: "Engine" },
        { pattern: /Super-batch \d+/i, label: "Engine" },
        { pattern: /Phase 5:/i, label: "Engine" },
        { pattern: /Engine done/i, label: "Engine" },
        { pattern: /Starting next cycle/i, label: "Idle" },
      ];

      for (let i = allLines.length - 1; i >= Math.max(0, allLines.length - 100); i--) {
        const line = allLines[i];
        for (const { pattern, label } of phasePatterns) {
          if (pattern.test(line)) {
            currentPhase = label;
            i = -1; // break outer loop
            break;
          }
        }
      }

      // Include rate limit data from daemon
      let rateLimits = null;
      try {
        const raw = await getSyncMeta(pool, "api_rate_limit");
        if (raw) rateLimits = JSON.parse(raw);
      } catch { /* malformed JSON */ }

      // CSFloat stats
      let csfloatStats = null;
      try {
        const { rows: [row] } = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM listings WHERE source IS NULL OR source = 'csfloat') as listings,
            (SELECT COUNT(*) FROM sale_history) as sales,
            (SELECT COUNT(*) FROM price_observations WHERE source = 'sale') as sale_observations
        `);
        csfloatStats = {
          listingsStored: parseInt(row.listings),
          totalSales: parseInt(row.sales),
          saleObservations: parseInt(row.sale_observations),
        };
      } catch { /* DB may be locked */ }

      // DMarket stats
      let dmarketStats = null;
      try {
        const { rows: [row] } = await pool.query(
          "SELECT COUNT(*) as cnt FROM listings WHERE source = 'dmarket'"
        );
        const lastFetch = await getSyncMeta(pool, "last_dmarket_fetch");
        dmarketStats = {
          configured: !!(process.env.DMARKET_PUBLIC_KEY && process.env.DMARKET_SECRET_KEY),
          listingsStored: parseInt(row.cnt),
          lastFetchAt: lastFetch || null,
        };
      } catch { /* DB may be locked */ }

      // Buff.market stats (admin-only, read from sync_meta)
      let buffStats = null;
      try {
        const rawBuffStatus = await getSyncMeta(pool, "buff_fetcher_status");
        if (rawBuffStatus) {
          const parsed = JSON.parse(rawBuffStatus);
          buffStats = {
            cookieHealthy: parsed.cookieHealthy ?? false,
            totalListingsStored: parsed.totalListingsStored ?? 0,
            totalSalesStored: parsed.totalSalesStored ?? 0,
            totalObservationsStored: parsed.totalObservationsStored ?? 0,
            lastSuccessAt: parsed.lastSuccessAt ?? null,
            lastError: parsed.lastError ?? null,
            cycleCount: parsed.cycleCount ?? 0,
            updatedAt: parsed.updatedAt ?? null,
          };
        }
      } catch { /* malformed JSON or no data */ }

      // BitSkins stats (admin-only, read from sync_meta)
      let bitskinsStats = null;
      try {
        const rawBsStatus = await getSyncMeta(pool, "bitskins_fetcher_status");
        if (rawBsStatus) {
          const parsed = JSON.parse(rawBsStatus);
          bitskinsStats = {
            totalListingsStored: parsed.totalListingsStored ?? 0,
            totalSalesStored: parsed.totalSalesStored ?? 0,
            totalObservationsStored: parsed.totalObservationsStored ?? 0,
            totalFloatsEnriched: parsed.totalFloatsEnriched ?? 0,
            wsConnected: parsed.wsConnected ?? false,
            lastSuccessAt: parsed.lastSuccessAt ?? null,
            lastError: parsed.lastError ?? null,
            cycleCount: parsed.cycleCount ?? 0,
            updatedAt: parsed.updatedAt ?? null,
          };
        }
      } catch { /* malformed JSON or no data */ }

      // Listing staleness stats
      let stalenessStats = null;
      try {
        const { rows: [row] } = await pool.query(`
          SELECT
            ROUND(AVG(EXTRACT(EPOCH FROM NOW() - COALESCE(staleness_checked_at, created_at)) / 3600)::numeric, 1)
              FILTER (WHERE source IS NULL OR source = 'csfloat') as csfloat_avg_hours,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM NOW() - COALESCE(staleness_checked_at, created_at)) / 3600
            ) FILTER (WHERE source IS NULL OR source = 'csfloat'))::numeric, 1) as csfloat_median_hours,
            ROUND(AVG(EXTRACT(EPOCH FROM NOW() - COALESCE(staleness_checked_at, created_at)) / 3600)::numeric, 1)
              FILTER (WHERE source = 'dmarket') as dmarket_avg_hours,
            COUNT(*) FILTER (WHERE staleness_checked_at > NOW() - INTERVAL '24 hours') as checked_24h,
            COUNT(*) as total_listings
          FROM listings WHERE stattrak = false
        `);
        stalenessStats = {
          csfloat_avg_hours: row.csfloat_avg_hours ? parseFloat(row.csfloat_avg_hours) : null,
          csfloat_median_hours: row.csfloat_median_hours ? parseFloat(row.csfloat_median_hours) : null,
          dmarket_avg_hours: row.dmarket_avg_hours ? parseFloat(row.dmarket_avg_hours) : null,
          checked_24h: parseInt(row.checked_24h),
          total_listings: parseInt(row.total_listings),
        };
      } catch { /* DB may be locked */ }

      res.json({ lines, currentPhase, rateLimits, csfloatStats, dmarketStats, stalenessStats, buffStats, bitskinsStats });
    } catch (err) {
      res.json({ lines: [`Error reading log: ${err}`], currentPhase: "Error", rateLimits: null, csfloatStats: null, dmarketStats: null, stalenessStats: null, buffStats: null, bitskinsStats: null });
    }
  }));

  router.get("/api/daemon-cycles", cachedRoute(
    (req) => `daemon_cycles:${req.query.limit || 50}:${req.query.offset || 0}`,
    300,
    async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    try {
      const { rows } = await pool.query(`
        SELECT cycle, started_at, duration_ms, api_calls_used, api_limit_detected,
               api_available, knife_tradeups_total, knife_profitable,
               theories_generated, theories_profitable, gaps_filled,
               cooldown_passes, cooldown_new_found, cooldown_improved,
               top_profit_cents, avg_profit_cents,
               classified_total, classified_profitable,
               classified_theories, classified_theories_profitable
        FROM daemon_cycle_stats
        WHERE daemon_version = 'knife-v2'
        ORDER BY id DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      const { rows: [totalRow] } = await pool.query(
        "SELECT COUNT(*) as cnt FROM daemon_cycle_stats WHERE daemon_version = 'knife-v2'"
      );

      res.json({ cycles: rows, total: parseInt(totalRow.cnt) });
    } catch (err) {
      res.json({ cycles: [], total: 0 });
    }
  }));

  router.get("/api/daemon-stats", cachedRoute("daemon_stats", 300, async (_req, res) => {
    // Check if table exists
    const { rows: tableCheck } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'daemon_cycle_stats'"
    );
    if (tableCheck.length === 0) {
      res.json({ cycles: [], summary: null });
      return;
    }

    const { rows: cycles } = await pool.query(`
      SELECT * FROM daemon_cycle_stats
      ORDER BY id DESC LIMIT 50
    `);

    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) as total_cycles,
        AVG(duration_ms) as avg_duration_ms,
        AVG(api_calls_used) as avg_api_calls,
        AVG(knife_profitable) as avg_profitable,
        AVG(top_profit_cents) as avg_top_profit,
        AVG(cooldown_new_found) as avg_new_found,
        AVG(cooldown_improved) as avg_improved,
        MAX(api_limit_detected) as detected_api_limit,
        SUM(cooldown_new_found) as total_new_found,
        SUM(cooldown_improved) as total_improved,
        MIN(started_at) as first_cycle,
        MAX(started_at) as last_cycle
      FROM daemon_cycle_stats
      WHERE daemon_version = 'knife-v2'
    `);

    // Detected rate limit info
    const rateLimitMeta = await (async () => {
      try {
        const raw = await getSyncMeta(pool, "api_rate_limit");
        return raw ? JSON.parse(raw) : null;
      } catch { /* malformed JSON */ return null; }
    })();

    res.json({ cycles, summary, rateLimitMeta });
  }));

  router.get("/api/daemon-events", cachedRoute(
    (req) => `daemon_events:${req.query.since || "all"}:${req.query.limit || 100}`,
    30,
    async (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      let events;
      if (since) {
        const { rows } = await pool.query(`
          SELECT id, event_type, summary, detail, created_at
          FROM daemon_events WHERE created_at > $1 ORDER BY id DESC LIMIT $2
        `, [since, limit]);
        events = rows;
      } else {
        const { rows } = await pool.query(`
          SELECT id, event_type, summary, detail, created_at
          FROM daemon_events ORDER BY id DESC LIMIT $1
        `, [limit]);
        events = rows;
      }
      res.json({ events: (events as { id: number; event_type: string; summary: string; detail: string; created_at: string }[]).reverse() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  }));

  return router;
}
