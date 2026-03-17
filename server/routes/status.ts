import { Router } from "express";
import fs from "fs";
import type Database from "better-sqlite3";
import { getSyncMeta } from "../db.js";
import { CASE_KNIFE_MAP } from "../engine.js";
import type { SyncStatus } from "../../shared/types.js";

export function statusRouter(db: Database.Database): Router {
  const router = Router();

  // Cache status with 10s minimum TTL + invalidate on daemon cycle change
  let statusCache: { data: any; ts: number } | null = null;
  let statusLastCalc = "";

  router.get("/api/status", (_req, res) => {
    // Serve cache if under 10s old (avoids heavy queries on every 30s poll)
    if (statusCache && Date.now() - statusCache.ts < 10_000) {
      return res.json(statusCache.data);
    }
    try {
      const row = db.prepare("SELECT value FROM sync_meta WHERE key = 'last_calculation'").get() as { value: string } | undefined;
      const currentCalc = row?.value || "";
      if (statusCache && currentCalc === statusLastCalc) {
        statusCache.ts = Date.now(); // Refresh TTL
        return res.json(statusCache.data);
      }
      statusLastCalc = currentCalc;
    } catch {
      if (statusCache) return res.json(statusCache.data);
    }
    const listingStats = (rarity: string, excludeKnives = false) => {
      const knifeFilter = excludeKnives ? "AND s.name NOT LIKE '★%'" : "";
      const r = db.prepare(`
        SELECT COUNT(l.id) as total_listings, COUNT(DISTINCT s.name) as skins_with_listings
        FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE s.rarity = ? AND s.stattrak = 0 ${knifeFilter}
      `).get(rarity) as { total_listings: number; skins_with_listings: number };
      const knifeFilterNoAlias = excludeKnives ? "AND name NOT LIKE '★%'" : "";
      const total = (db.prepare(
        `SELECT COUNT(DISTINCT name) as c FROM skins WHERE rarity = ? AND stattrak = 0 ${knifeFilterNoAlias}`
      ).get(rarity) as { c: number }).c;
      return { listings: r.total_listings, skins: r.skins_with_listings, total };
    };

    const classified = listingStats("Classified");
    const covert = listingStats("Covert", true);

    const covertPrices = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_sales') as sale_prices,
        (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as ref_prices,
        (SELECT COUNT(*) FROM sale_history) as total_sales
    `).get() as { sale_prices: number; ref_prices: number; total_sales: number };

    const tuStats = db.prepare(`
      SELECT type,
        COUNT(*) as cnt,
        SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
      FROM trade_ups GROUP BY type
    `).all() as { type: string; cnt: number; profitable: number }[];

    // Real knife trade-ups (exclude theories which share type='covert_knife')
    const knifeTu = (() => {
      try {
        return db.prepare(`
          SELECT COUNT(*) as cnt,
            SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable,
            SUM(CASE WHEN listing_status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN listing_status = 'partial' THEN 1 ELSE 0 END) as partial,
            SUM(CASE WHEN listing_status = 'stale' THEN 1 ELSE 0 END) as stale
          FROM trade_ups WHERE type = 'covert_knife' AND is_theoretical = 0
        `).get() as { cnt: number; profitable: number; active: number; partial: number; stale: number };
      } catch { /* DB may be locked */ return { cnt: 0, profitable: 0, active: 0, partial: 0, stale: 0 }; }
    })();
    const covertTu = tuStats.find(r => r.type === "classified_covert");
    const totalTu = tuStats.reduce((s, r) => s + r.cnt, 0);
    const totalProfitable = tuStats.reduce((s, r) => s + r.profitable, 0);

    const topCollections = db.prepare(`
      SELECT collection_name, priority_score, profitable_count, avg_profit_cents
      FROM collection_scores ORDER BY priority_score DESC LIMIT 5
    `).all() as { collection_name: string; priority_score: number; profitable_count: number; avg_profit_cents: number }[];

    const result = ({
      classified_listings: classified.listings,
      classified_skins: classified.skins,
      classified_total: classified.total,
      covert_listings: covert.listings,
      covert_skins: covert.skins,
      covert_total: covert.total,
      covert_sale_prices: covertPrices.sale_prices,
      covert_ref_prices: covertPrices.ref_prices,
      total_sales: covertPrices.total_sales,
      knife_trade_ups: knifeTu?.cnt ?? 0,
      knife_profitable: knifeTu?.profitable ?? 0,
      knife_active: knifeTu?.active ?? 0,
      knife_partial: knifeTu?.partial ?? 0,
      knife_stale: knifeTu?.stale ?? 0,
      covert_trade_ups: covertTu?.cnt ?? 0,
      covert_profitable: covertTu?.profitable ?? 0,
      trade_ups_count: totalTu,
      profitable_count: totalProfitable,
      last_calculation: getSyncMeta(db, "last_calculation"),
      daemon_status: (() => {
        try {
          const raw = getSyncMeta(db, "daemon_status");
          if (!raw) return { phase: "idle" as const, detail: "Daemon not running", timestamp: new Date().toISOString() };
          const parsed = JSON.parse(raw);
          // Check if daemon status is stale (>25 min old = likely crashed/stopped)
          // Was 5 min but cooldown phase alone is 20 min — need more headroom
          const statusAge = Date.now() - new Date(parsed.timestamp).getTime();
          if (statusAge > 25 * 60 * 1000) {
            return { phase: "idle" as const, detail: "Daemon inactive", timestamp: parsed.timestamp };
          }
          return parsed;
        } catch { /* malformed JSON */ return { phase: "idle" as const, detail: "Daemon not running", timestamp: new Date().toISOString() }; }
      })(),
      top_collections: topCollections,
      exploration_stats: (() => {
        try {
          const raw = getSyncMeta(db, "exploration_stats");
          return raw ? JSON.parse(raw) : null;
        } catch { /* malformed JSON */ return null; }
      })(),
      ref_coverage: null,
      total_skins: (() => {
        const r = db.prepare("SELECT COUNT(DISTINCT name) as c FROM skins WHERE stattrak = 0").get() as { c: number };
        return r.c;
      })(),
      total_listings: (() => {
        const r = db.prepare("SELECT COUNT(*) as c FROM listings").get() as { c: number };
        return r.c;
      })(),
      knife_glove_skins: (() => {
        const r = db.prepare("SELECT COUNT(DISTINCT name) as c FROM skins WHERE name LIKE '★%' AND stattrak = 0").get() as { c: number };
        return r.c;
      })(),
      knife_glove_with_listings: (() => {
        const r = db.prepare("SELECT COUNT(DISTINCT s.name) as c FROM skins s JOIN listings l ON s.id = l.skin_id WHERE s.name LIKE '★%' AND s.stattrak = 0").get() as { c: number };
        return r.c;
      })(),
      knife_glove_listings: (() => {
        const r = db.prepare("SELECT COUNT(*) as c FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name LIKE '★%' AND s.stattrak = 0").get() as { c: number };
        return r.c;
      })(),
      collection_count: (() => {
        const r = db.prepare("SELECT COUNT(DISTINCT c.id) as c FROM collections c JOIN skin_collections sc ON c.id = sc.collection_id").get() as { c: number };
        return r.c;
      })(),
      collections_with_knives: Object.keys(CASE_KNIFE_MAP).length,
    } satisfies SyncStatus);

    statusCache = { data: result, ts: Date.now() };
    res.json(result);
  });

  // Global stats — lightweight, cached 60s, shown in header on every page
  let globalStatsCache: { data: any; ts: number } | null = null;
  router.get("/api/global-stats", (_req, res) => {
    if (globalStatsCache && Date.now() - globalStatsCache.ts < 60_000) {
      return res.json(globalStatsCache.data);
    }
    try {
      const tradeUps = db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable FROM trade_ups WHERE is_theoretical = 0"
      ).get() as { total: number; profitable: number };

      const listings = (db.prepare("SELECT COUNT(*) as c FROM listings").get() as { c: number }).c;

      const saleObs = (db.prepare("SELECT COUNT(*) as c FROM price_observations").get() as { c: number }).c;

      const refs = (db.prepare("SELECT COUNT(*) as c FROM price_data WHERE source = 'csfloat_ref'").get() as { c: number }).c;

      const saleHistory = (db.prepare("SELECT COUNT(*) as c FROM sale_history").get() as { c: number }).c;

      // Total data points = listings + sale observations + sale history + ref prices
      const totalDataPoints = listings + saleObs + saleHistory + refs;

      // Total cycles ever run (from daemon_cycle_stats table)
      const totalCycles = (db.prepare("SELECT COUNT(*) as c FROM daemon_cycle_stats").get() as { c: number }).c;

      const data = {
        total_trade_ups: tradeUps.total,
        profitable_trade_ups: tradeUps.profitable,
        total_data_points: totalDataPoints,
        listings,
        sale_observations: saleObs,
        sale_history: saleHistory,
        ref_prices: refs,
        total_cycles: totalCycles,
      };
      globalStatsCache = { data, ts: Date.now() };
      res.json(data);
    } catch {
      res.json(globalStatsCache?.data ?? {});
    }
  });

  router.get("/api/daemon-log", (_req, res) => {
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
        { pattern: /Phase 2: Theory/i, label: "Theory" },
        { pattern: /Phase 3: API Probe/i, label: "API Probe" },
        { pattern: /Phase 4: Data Fetch/i, label: "Data Fetch" },
        { pattern: /Phase 5c: Staircase/i, label: "Staircase" },
        { pattern: /Phase 5b: Classified/i, label: "Classified Calc" },
        { pattern: /Phase 5: Knife Calc/i, label: "Knife Calc" },
        { pattern: /Phase 2c: Staircase/i, label: "Staircase Theory" },
        { pattern: /Phase 2b: Classified/i, label: "Classified Theory" },
        { pattern: /Phase 6: Cooldown/i, label: "Cooldown" },
        { pattern: /Phase 7: Re-materialization/i, label: "Re-materialize" },
        { pattern: /Knife explore pass/i, label: "Cooldown" },
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
        const raw = getSyncMeta(db, "api_rate_limit");
        if (raw) rateLimits = JSON.parse(raw);
      } catch { /* malformed JSON */ }

      // CSFloat stats
      let csfloatStats = null;
      try {
        const row = db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM listings WHERE source IS NULL OR source = 'csfloat') as listings,
            (SELECT COUNT(*) FROM sale_history) as sales,
            (SELECT COUNT(*) FROM price_observations WHERE source = 'sale') as sale_observations
        `).get() as { listings: number; sales: number; sale_observations: number };
        csfloatStats = {
          listingsStored: row.listings,
          totalSales: row.sales,
          saleObservations: row.sale_observations,
        };
      } catch { /* DB may be locked */ }

      // DMarket stats
      let dmarketStats = null;
      try {
        const row = db.prepare(
          "SELECT COUNT(*) as cnt FROM listings WHERE source = 'dmarket'"
        ).get() as { cnt: number };
        const lastFetch = getSyncMeta(db, "last_dmarket_fetch");
        dmarketStats = {
          configured: !!(process.env.DMARKET_PUBLIC_KEY && process.env.DMARKET_SECRET_KEY),
          listingsStored: row.cnt,
          lastFetchAt: lastFetch || null,
        };
      } catch { /* DB may be locked */ }

      // Skinport WebSocket stats
      let skinportStats = null;
      try {
        const row = db.prepare(
          "SELECT COUNT(*) as cnt FROM listings WHERE source = 'skinport'"
        ).get() as { cnt: number };
        const obsRow = db.prepare(
          "SELECT COUNT(*) as cnt FROM price_observations WHERE source = 'skinport_sale'"
        ).get() as { cnt: number };
        skinportStats = {
          listingsStored: row.cnt,
          saleObservations: obsRow.cnt,
        };
      } catch { /* DB may be locked */ }

      res.json({ lines, currentPhase, rateLimits, csfloatStats, dmarketStats, skinportStats });
    } catch (err) {
      res.json({ lines: [`Error reading log: ${err}`], currentPhase: "Error", rateLimits: null, csfloatStats: null, dmarketStats: null, skinportStats: null });
    }
  });

  router.get("/api/daemon-cycles", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    try {
      const rows = db.prepare(`
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
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const total = (db.prepare(
        "SELECT COUNT(*) as cnt FROM daemon_cycle_stats WHERE daemon_version = 'knife-v2'"
      ).get() as { cnt: number }).cnt;

      res.json({ cycles: rows, total });
    } catch (err) {
      res.json({ cycles: [], total: 0 });
    }
  });

  router.get("/api/daemon-stats", (_req, res) => {
    // Check if table exists
    const hasTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='daemon_cycle_stats'"
    ).get();
    if (!hasTable) {
      res.json({ cycles: [], summary: null });
      return;
    }

    const cycles = db.prepare(`
      SELECT * FROM daemon_cycle_stats
      ORDER BY id DESC LIMIT 50
    `).all();

    const summary = db.prepare(`
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
    `).get();

    // Detected rate limit info
    const rateLimitMeta = (() => {
      try {
        const raw = getSyncMeta(db, "api_rate_limit");
        return raw ? JSON.parse(raw) : null;
      } catch { /* malformed JSON */ return null; }
    })();

    res.json({ cycles, summary, rateLimitMeta });
  });

  router.get("/api/daemon-events", (req, res) => {
    try {
      const since = req.query.since as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      let events;
      if (since) {
        events = db.prepare(`
          SELECT id, event_type, summary, detail, created_at
          FROM daemon_events WHERE created_at > ? ORDER BY id DESC LIMIT ?
        `).all(since, limit);
      } else {
        events = db.prepare(`
          SELECT id, event_type, summary, detail, created_at
          FROM daemon_events ORDER BY id DESC LIMIT ?
        `).all(limit);
      }
      res.json({ events: (events as { id: number; event_type: string; summary: string; detail: string; created_at: string }[]).reverse() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
