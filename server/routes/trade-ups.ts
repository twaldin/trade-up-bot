import { Router } from "express";
import pg from "pg";
import { priceCache, priceSources } from "../engine.js";
import { fetchDMarketListings, isDMarketConfigured } from "../sync.js";
import { getTierConfig, type User } from "../auth.js";
import { cachedRoute, getRateLimit } from "../redis.js";
import { getActiveClaims } from "./claims.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome, InputSummary } from "../../shared/types.js";

export function tradeUpsRouter(pool: pg.Pool): Router {
  const router = Router();

  // Filter options: Redis-first (daemon pre-populates every cycle).
  // The DISTINCT + GROUP BY queries on 10M+ trade_up_inputs rows block the
  // event loop for 20-50s (better-sqlite3 is synchronous). MUST come from cache.
  router.get("/api/filter-options", async (_req, res) => {
    try {
      const { cacheGet } = await import("../redis.js");
      const cached = await cacheGet<Record<string, unknown>>("filter_opts");
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached);
        return;
      }
    } catch { /* Redis unavailable */ }

    // Redis miss: fall back to DB
    try {
      const { rows: inputSkins } = await pool.query(
        `SELECT DISTINCT skin_name as name FROM trade_up_inputs`
      );
      const skinMap = inputSkins.map((s: any) => ({ name: s.name, input: true, output: false }));
      const { rows: collections } = await pool.query(
        `SELECT collection_name as name, COUNT(*) as count FROM trade_up_inputs GROUP BY collection_name ORDER BY count DESC`
      );

      const result = { skins: skinMap, collections };

      const { cacheSet } = await import("../redis.js");
      await cacheSet("filter_opts", result, 600).catch(() => {});

      res.setHeader("X-Cache", "MISS");
      res.json(result);
    } catch {
      res.json({ skins: [], collections: [] });
    }
  });

  // Free tier: 10 diverse active trade-ups per type across price buckets.
  // Same set for ALL free users. Refreshed each daemon cycle.
  // 3-hour delay: only shows trade-ups created 3+ hours ago.
  const FREE_PER_TYPE = 10;
  const freeCache = new Map<string, { rows: any[]; calcTs: string }>();

  // Price bucket configs per trade-up type
  const KNIFE_BUCKETS = [
    { max: 50000, count: 3 },    // cheap: $0-500
    { max: 150000, count: 4 },   // mid: $500-1500
    { max: Infinity, count: 3 }, // expensive: $1500+
  ];
  const GUN_BUCKETS = [
    { max: 2000, count: 3 },     // cheap: $0-20
    { max: 10000, count: 4 },    // mid: $20-100
    { max: Infinity, count: 3 }, // expensive: $100+
  ];

  async function getFreeTierTradeUps(types: string[]): Promise<any[]> {
    const { rows: calcRows } = await pool.query("SELECT value FROM sync_meta WHERE key = 'last_calculation'");
    const calcTs = calcRows[0]?.value || "";

    const results: any[] = [];
    for (const t of types) {
      const cached = freeCache.get(t);
      if (cached && cached.calcTs === calcTs) {
        results.push(...cached.rows);
        continue;
      }

      const buckets = t === "covert_knife" ? KNIFE_BUCKETS : GUN_BUCKETS;
      const rows: any[] = [];
      let prevMax = 0;

      for (const bucket of buckets) {
        const costFilter = bucket.max === Infinity
          ? `AND t.total_cost_cents >= ${prevMax}`
          : `AND t.total_cost_cents >= ${prevMax} AND t.total_cost_cents < ${bucket.max}`;

        const { rows: bucketRows } = await pool.query(`
          SELECT t.id, t.type, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
                 t.roi_percentage, t.created_at, t.is_theoretical, t.listing_status,
                 t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
                 0 as outcome_count
          FROM trade_ups t
          WHERE t.is_theoretical = 0 AND t.type = $1
            AND t.listing_status = 'active'
            AND t.created_at <= NOW() - INTERVAL '10800 seconds'
            AND (t.profit_cents > 0 OR t.chance_to_profit >= 0.25)
            ${costFilter}
          ORDER BY t.chance_to_profit DESC, t.profit_cents DESC
          LIMIT $2
        `, [t, bucket.count]);
        rows.push(...bucketRows);
        prevMax = bucket.max === Infinity ? prevMax : bucket.max;
      }

      // Backfill if buckets didn't fill to 10 — grab best remaining
      if (rows.length < FREE_PER_TYPE) {
        const existingIds = new Set(rows.map((r: any) => r.id));
        const { rows: backfill } = await pool.query(`
          SELECT t.id, t.type, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
                 t.roi_percentage, t.created_at, t.is_theoretical, t.listing_status,
                 t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
                 0 as outcome_count
          FROM trade_ups t
          WHERE t.is_theoretical = 0 AND t.type = $1
            AND t.listing_status = 'active'
            AND t.created_at <= NOW() - INTERVAL '10800 seconds'
            AND (t.profit_cents > 0 OR t.chance_to_profit >= 0.25)
          ORDER BY t.chance_to_profit DESC, t.profit_cents DESC
          LIMIT $2
        `, [t, FREE_PER_TYPE * 2]);
        for (const r of backfill) {
          if (rows.length >= FREE_PER_TYPE) break;
          if (!existingIds.has(r.id)) rows.push(r);
        }
      }

      freeCache.set(t, { rows, calcTs });
      results.push(...rows);
    }
    return results;
  }

  router.get("/api/trade-ups", cachedRoute((req) => {
    // Don't cache my_claims responses — they change on every claim/release and must be real-time
    if (req.query.my_claims === "true") return null;
    return "tu:" + JSON.stringify(req.query) + ((req.user as any)?.steam_id || "anon") + ((req.user as any)?.tier || "free");
  }, 1800, async (req, res) => { // 30 min TTL — matches cycle time, daemon invalidates after each cycle
    const {
      sort = "profit",
      order = "desc",
      page = "1",
      per_page = "50",
      min_profit,
      max_profit,
      min_roi,
      max_roi,
      max_cost,
      min_cost,
      min_chance,
      max_chance,
      max_outcomes,
      skin,
      collection,
      type,
      max_loss,
      min_win,
      my_claims,
    } = req.query as Record<string, string>;

    // Tier gating
    const tierConfig = getTierConfig(req);
    const user = req.user as User | undefined;
    const userId = user?.steam_id || "anonymous";
    const effectiveTier = user?.tier || "free";

    // === FREE TIER: return fixed 10 oldest stale per type, no filters/pagination ===
    // Free users see full trade-up data (inputs, outcomes, prices) but no listing links
    if (effectiveTier === "free") {
      const freeTypes = type && type !== "all"
        ? [type]
        : ["covert_knife", "classified_covert", "restricted_classified", "milspec_restricted", "industrial_milspec"];
      const freeRows = await getFreeTierTradeUps(freeTypes);

      // Batch-load inputs for all free tier trade-ups (fixes N+1)
      // Build input summaries for free tier (same lightweight approach as paid)
      const freeIds = freeRows.map((r: any) => r.id);
      const freeSummaryByTuId = new Map<number, InputSummary>();
      if (freeIds.length > 0) {
        const ph = freeIds.map((_: any, i: number) => `$${i + 1}`).join(",");
        const { rows: summaryRows } = await pool.query(
          `SELECT trade_up_id, skin_name, condition, collection_name FROM trade_up_inputs WHERE trade_up_id IN (${ph})`,
          freeIds
        );
        const grouped = new Map<number, typeof summaryRows>();
        for (const r of summaryRows) {
          const list = grouped.get(r.trade_up_id) ?? [];
          list.push(r);
          grouped.set(r.trade_up_id, list);
        }
        for (const [tuId, inputs] of grouped) {
          const skinCounts = new Map<string, { count: number; condition: string }>();
          const collections = new Set<string>();
          for (const inp of inputs) {
            const existing = skinCounts.get(inp.skin_name);
            if (existing) existing.count++;
            else skinCounts.set(inp.skin_name, { count: 1, condition: inp.condition });
            collections.add(inp.collection_name);
          }
          freeSummaryByTuId.set(tuId, {
            skins: [...skinCounts.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, info]) => ({ name, count: info.count, condition: info.condition })),
            collections: [...collections],
            input_count: inputs.length,
          });
        }
      }

      const tradeUps: TradeUp[] = freeRows.map((row: any) => {
        return {
          id: row.id,
          type: row.type,
          total_cost_cents: row.total_cost_cents,
          expected_value_cents: row.expected_value_cents,
          profit_cents: row.profit_cents,
          roi_percentage: row.roi_percentage,
          created_at: row.created_at,
          is_theoretical: false,
          inputs: [],
          input_summary: freeSummaryByTuId.get(row.id) ?? { skins: [], collections: [], input_count: 0 },
          outcomes: [],
          chance_to_profit: row.chance_to_profit ?? 0,
          best_case_cents: row.best_case_cents ?? 0,
          worst_case_cents: row.worst_case_cents ?? 0,
          outcome_count: row.outcome_count ?? 0,
          listing_status: 'active' as const, // Don't reveal stale status
          missing_inputs: 0,
          profit_streak: 0,
          peak_profit_cents: 0,
          preserved_at: null,
          previous_inputs: null,
        };
      });

      let myClaimCount = 0;
      try {
        const { rows: [claimRow] } = await pool.query(
          "SELECT COUNT(*) as c FROM trade_up_claims WHERE user_id = $1 AND released_at IS NULL AND expires_at > NOW()",
          [userId]
        );
        myClaimCount = parseInt(claimRow.c);
      } catch {}

      const result = {
        trade_ups: tradeUps,
        total: tradeUps.length,
        page: 1,
        per_page: tradeUps.length,
        tier: "free",
        tier_config: tierConfig,
        my_claim_count: myClaimCount,
      };
      res.json(result);
      return;
    }

    const pageNum = parseInt(page);
    const perPage = Math.min(parseInt(per_page), 500);
    const offset = (pageNum - 1) * perPage;

    const includeStale = req.query.include_stale === "true";
    let where: string;
    if (includeStale) {
      where = `WHERE t.is_theoretical = 0 AND (t.listing_status = 'active' OR t.preserved_at IS NOT NULL)`;
    } else {
      where = `WHERE t.is_theoretical = 0 AND t.listing_status = 'active'`;
    }
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Basic tier: 30-min delay — only show trade-ups created 30+ min ago
    if (effectiveTier === "basic") {
      where += ` AND t.created_at <= NOW() - INTERVAL '1800 seconds'`;
    }

    // Load active claims from Redis (fast) — includes listing IDs for conflict detection
    const activeClaims = await getActiveClaims(pool);
    const claimedByOthers = new Set<number>();
    const claimedByMe = new Set<number>();
    const claimedListingIds = new Set<string>(); // all listing IDs locked by other users' claims
    for (const c of activeClaims) {
      if (c.user_id === userId) {
        claimedByMe.add(c.trade_up_id);
      } else {
        claimedByOthers.add(c.trade_up_id);
        // Collect all listing IDs from other users' claims — trade-ups sharing these are hidden
        for (const lid of c.listing_ids) claimedListingIds.add(lid);
      }
    }

    // "My Claims" filter: use Redis active_claims
    const myClaimCount = activeClaims.filter(c => c.user_id === userId).length;
    if (my_claims === "true") {
      const myClaimIds = activeClaims.filter(c => c.user_id === userId).map(c => c.trade_up_id);
      if (myClaimIds.length === 0) {
        res.json({ trade_ups: [], total: 0, my_claim_count: myClaimCount });
        return;
      }
      const claimPlaceholders = myClaimIds.map((_) => `$${paramIndex++}`).join(",");
      where += ` AND t.id IN (${claimPlaceholders})`;
      params.push(...myClaimIds);
    } else if (type) {
      where += ` AND t.type = $${paramIndex++}`;
      params.push(type);
    }

    if (min_profit) {
      where += ` AND t.profit_cents >= $${paramIndex++}`;
      params.push(parseInt(min_profit));
    }
    if (max_profit) {
      where += ` AND t.profit_cents <= $${paramIndex++}`;
      params.push(parseInt(max_profit));
    }
    if (min_roi) {
      where += ` AND t.roi_percentage >= $${paramIndex++}`;
      params.push(parseFloat(min_roi));
    }
    if (max_roi) {
      where += ` AND t.roi_percentage <= $${paramIndex++}`;
      params.push(parseFloat(max_roi));
    }
    if (max_cost) {
      where += ` AND t.total_cost_cents <= $${paramIndex++}`;
      params.push(parseInt(max_cost));
    }
    if (min_cost) {
      where += ` AND t.total_cost_cents >= $${paramIndex++}`;
      params.push(parseInt(min_cost));
    }
    if (min_chance) {
      where += ` AND t.chance_to_profit >= $${paramIndex++}`;
      params.push(parseFloat(min_chance) / 100);
    }
    if (max_chance) {
      where += ` AND t.chance_to_profit <= $${paramIndex++}`;
      params.push(parseFloat(max_chance) / 100);
    }

    // Skin name filter (exact match from autocomplete, or fuzzy search)
    if (skin) {
      const skinNames = skin.split("||").map(s => s.trim()).filter(Boolean);
      if (skinNames.length === 1 && !skinNames[0].includes("%")) {
        // Exact skin name match — check inputs table + outcomes_json LIKE
        where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name = $${paramIndex}) OR t.outcomes_json LIKE $${paramIndex + 1})`;
        params.push(skinNames[0], `%"skin_name":"${skinNames[0].replace(/"/g, '\\"')}"%`);
        paramIndex += 2;
      } else if (skinNames.length > 1) {
        // Multiple exact skin names (OR) — check inputs + outcomes_json LIKE for each
        const inputPlaceholders = skinNames.map(() => `$${paramIndex++}`).join(",");
        const outcomeLikes = skinNames.map(() => `t.outcomes_json LIKE $${paramIndex++}`).join(" OR ");
        where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name IN (${inputPlaceholders})) OR ${outcomeLikes})`;
        params.push(...skinNames, ...skinNames.map(s => `%"skin_name":"${s.replace(/"/g, '\\"')}"%`));
      } else {
        where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name LIKE $${paramIndex}) OR t.outcomes_json LIKE $${paramIndex + 1})`;
        const pattern = `%${skin}%`;
        params.push(pattern, pattern);
        paramIndex += 2;
      }
    }

    // Collection filter
    if (collection) {
      const collNames = collection.split("|").map(s => s.trim()).filter(Boolean);
      const placeholders = collNames.map(() => `$${paramIndex++}`).join(",");
      where += ` AND t.id IN (
        SELECT trade_up_id FROM trade_up_inputs WHERE collection_name IN (${placeholders})
      )`;
      params.push(...collNames);
    }

    // Max outcomes filter — count from outcomes_json array
    if (max_outcomes) {
      where += ` AND json_array_length(COALESCE(t.outcomes_json, '[]')::json) <= $${paramIndex++}`;
      params.push(parseInt(max_outcomes));
    }

    // Max loss: worst case must be >= -maxLoss (user enters positive, we negate)
    if (max_loss) {
      where += ` AND t.worst_case_cents >= $${paramIndex++}`;
      params.push(-Math.abs(parseInt(max_loss)));
    }

    // Min win: best case must be >= minWin
    if (min_win) {
      where += ` AND t.best_case_cents >= $${paramIndex++}`;
      params.push(parseInt(min_win));
    }

    const sortMap: Record<string, string> = {
      profit: "t.profit_cents",
      roi: "t.roi_percentage",
      chance: "t.chance_to_profit",
      cost: "t.total_cost_cents",
      ev: "t.expected_value_cents",
      created: "t.created_at",
      best: "t.best_case_cents",
      worst: "t.worst_case_cents",
    };
    const sortCol = sortMap[sort] ?? "t.profit_cents";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    // Fast path: for default queries (type filter only, no extra filters), use Redis-cached
    // counts per type. The daemon pre-populates these every cycle. Avoids COUNT on 300K-664K rows.
    const hasExtraFilters = !!(min_profit || max_profit || min_roi || max_roi || max_cost || min_cost ||
      min_chance || max_chance || max_outcomes || skin || collection || max_loss || min_win || my_claims === "true");

    const limitParam = paramIndex++;
    const offsetParam = paramIndex++;

    // Data query always runs (fast: index scan + LIMIT)
    const dataPromise = pool.query(
      `SELECT t.id, t.type, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
              t.roi_percentage, t.created_at, t.is_theoretical, t.listing_status,
              t.peak_profit_cents, t.profit_streak, t.preserved_at, t.previous_inputs,
              t.combo_key, t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
              0 as outcome_count
       FROM trade_ups t ${where}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, perPage, offset]
    );

    let total: number;
    let totalProfitable: number;

    if (!hasExtraFilters && type) {
      // Try Redis-cached counts first (populated by daemon every cycle + API startup)
      const { cacheGet, cacheSet } = await import("../redis.js");
      const cachedCounts = await cacheGet<Record<string, { total: number; profitable: number }>>("type_counts");
      const typeCounts = cachedCounts?.[type];

      if (typeCounts) {
        total = typeCounts.total;
        totalProfitable = typeCounts.profitable;
      } else {
        // Cache miss: compute and cache for all types at once (one query, amortized)
        const { rows: countRows } = await pool.query(`
          SELECT type, COUNT(*) as c, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
          FROM trade_ups WHERE is_theoretical = 0 AND listing_status = 'active'
          GROUP BY type
        `);
        const counts: Record<string, { total: number; profitable: number }> = {};
        for (const r of countRows) {
          counts[r.type] = { total: parseInt(r.c), profitable: parseInt(r.profitable) || 0 };
        }
        await cacheSet("type_counts", counts, 1800); // 30 min, refreshed by daemon
        total = counts[type]?.total ?? 0;
        totalProfitable = counts[type]?.profitable ?? 0;
      }
    } else {
      // Extra filters: must COUNT from DB (accurate count for filtered results)
      const { rows: [countRow] } = await pool.query(
        `SELECT COUNT(*) as c, SUM(CASE WHEN t.profit_cents > 0 THEN 1 ELSE 0 END) as profitable FROM trade_ups t ${where}`,
        params
      );
      total = parseInt(countRow?.c) || 0;
      totalProfitable = parseInt(countRow?.profitable) || 0;
    }

    const rows = (await dataPromise).rows;

    // Batch-load lightweight input summaries (skin_name, condition, collection_name only).
    // Full inputs are loaded on-demand when expanding a row via /api/trade-up/:id/inputs.
    const tuIds = rows.map((r: any) => r.id);
    const summaryByTuId = new Map<number, InputSummary>();
    const inputCountByTuId = new Map<number, number>();
    if (tuIds.length > 0) {
      const placeholders = tuIds.map((_: any, i: number) => `$${i + 1}`).join(",");
      const { rows: summaryRows } = await pool.query(
        `SELECT trade_up_id, skin_name, condition, collection_name FROM trade_up_inputs WHERE trade_up_id IN (${placeholders})`,
        tuIds
      );

      // Group by trade_up_id and compute summaries
      const grouped = new Map<number, typeof summaryRows>();
      for (const r of summaryRows) {
        const list = grouped.get(r.trade_up_id) ?? [];
        list.push(r);
        grouped.set(r.trade_up_id, list);
      }
      for (const [tuId, inputs] of grouped) {
        const skinCounts = new Map<string, { count: number; condition: string }>();
        const collections = new Set<string>();
        for (const inp of inputs) {
          const existing = skinCounts.get(inp.skin_name);
          if (existing) existing.count++;
          else skinCounts.set(inp.skin_name, { count: 1, condition: inp.condition });
          collections.add(inp.collection_name);
        }
        summaryByTuId.set(tuId, {
          skins: [...skinCounts.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .map(([name, info]) => ({ name, count: info.count, condition: info.condition })),
          collections: [...collections],
          input_count: inputs.length,
        });
        inputCountByTuId.set(tuId, inputs.length);
      }
    }

    // Batch-load missing input counts for non-active trade-ups
    // Check ALL returned trade-ups for missing inputs (not just non-active)
    // Catches: phantom stale (0 missing but marked stale) AND phantom active (has missing but marked active)
    const allIds = rows.map((r: any) => r.id);
    const missingCountByTuId = new Map<number, number>();
    if (allIds.length > 0) {
      // Batch in chunks of 500 to avoid param limit issues
      for (let i = 0; i < allIds.length; i += 500) {
        const chunk = allIds.slice(i, i + 500);
        const placeholders = chunk.map((_: any, j: number) => `$${j + 1}`).join(",");
        const { rows: missingRows } = await pool.query(`
          SELECT tui.trade_up_id, COUNT(*) as cnt FROM trade_up_inputs tui
          LEFT JOIN listings l ON tui.listing_id = l.id
          WHERE tui.trade_up_id IN (${placeholders})
            AND l.id IS NULL AND tui.listing_id NOT LIKE 'theor%'
          GROUP BY tui.trade_up_id
        `, chunk);
        for (const r of missingRows) {
          missingCountByTuId.set(r.trade_up_id, parseInt(r.cnt));
        }
      }
    }

    // Auto-correct listing_status based on actual missing count
    const statusFixes = new Map<number, string>();
    for (const row of rows) {
      const missing = missingCountByTuId.get(row.id) ?? 0;
      const totalInputs = inputCountByTuId.get(row.id) ?? 0;
      if (missing === 0 && row.listing_status !== 'active') {
        statusFixes.set(row.id, 'active');
      } else if (missing > 0 && row.listing_status === 'active') {
        statusFixes.set(row.id, missing >= totalInputs ? 'stale' : 'partial');
      } else if (missing > 0 && row.listing_status === 'stale' && missing < totalInputs) {
        statusFixes.set(row.id, 'partial');
      }
    }

    const tradeUps: TradeUp[] = rows.map((row: any) => {
      const summary = summaryByTuId.get(row.id) ?? { skins: [], collections: [], input_count: 0 };
      const missingCount = missingCountByTuId.get(row.id) ?? 0;
      const correctedStatus = statusFixes.get(row.id);

      const tu: TradeUp = {
        id: row.id,
        type: row.type,
        total_cost_cents: row.total_cost_cents,
        expected_value_cents: row.expected_value_cents,
        profit_cents: row.profit_cents,
        roi_percentage: row.roi_percentage,
        created_at: row.created_at,
        is_theoretical: row.is_theoretical === true || row.is_theoretical === 1,
        inputs: [], // loaded on-demand via /api/trade-up/:id/inputs
        input_summary: summary,
        outcomes: [],
        chance_to_profit: row.chance_to_profit ?? 0,
        best_case_cents: row.best_case_cents ?? 0,
        worst_case_cents: row.worst_case_cents ?? 0,
        outcome_count: row.outcome_count ?? 0,
        listing_status: (correctedStatus ?? row.listing_status ?? 'active') as TradeUp['listing_status'],
        missing_inputs: missingCount,
        profit_streak: row.profit_streak ?? 0,
        peak_profit_cents: row.peak_profit_cents ?? 0,
        preserved_at: correctedStatus === 'active' ? null : (row.preserved_at ?? null),
        previous_inputs: row.previous_inputs ? JSON.parse(row.previous_inputs) : null,
      };

      return { ...tu, claimed_by_me: claimedByMe.has(row.id), claimed_by_other: claimedByOthers.has(row.id) };
    });

    // Filter out trade-ups that auto-corrected to partial/stale when "Show stale" is off
    const filteredTradeUps = includeStale
      ? tradeUps
      : tradeUps.filter(tu => tu.listing_status === 'active');

    // Adjust counts for filtered results
    const filteredTotal = includeStale ? total : total - (tradeUps.length - filteredTradeUps.length);
    const filteredProfitable = includeStale
      ? totalProfitable
      : totalProfitable - tradeUps.filter(tu => tu.listing_status !== 'active' && tu.profit_cents > 0).length;

    const result = {
      trade_ups: filteredTradeUps,
      total: filteredTotal,
      total_profitable: filteredProfitable,
      page: pageNum,
      per_page: perPage,
      tier: effectiveTier,
      tier_config: { delay: tierConfig.delay, limit: tierConfig.limit, showListingIds: tierConfig.showListingIds },
      my_claim_count: myClaimCount,
      claim_limit: (effectiveTier as string) === "pro" || (effectiveTier as string) === "admin" ? await getRateLimit(userId, "claim", 10) : null,
      verify_limit: await getRateLimit(userId, "verify", (effectiveTier as string) === "pro" || (effectiveTier as string) === "admin" ? 20 : 10),
    };
    res.json(result);
  }));

  router.get("/api/trade-ups/:id", async (req, res) => {
    const { rows: [row] } = await pool.query(
      "SELECT * FROM trade_ups WHERE id = $1",
      [req.params.id]
    );

    if (!row) {
      res.status(404).json({ error: "Trade-up not found" });
      return;
    }

    const { rows: inputs } = await pool.query(
      "SELECT * FROM trade_up_inputs WHERE trade_up_id = $1",
      [row.id]
    );
    const outcomes = JSON.parse(row.outcomes_json || '[]') as TradeUpOutcome[];

    res.json({ ...row, inputs, outcomes });
  });

  router.post("/api/verify-trade-up/:id", async (req, res) => {
    // Verify requires authentication (basic+ tier)
    const userId = (req.user as any)?.steam_id;
    const userTier = (req.user as any)?.tier || "free";
    if (!userId || userTier === "free") {
      res.status(403).json({ error: "Verify requires Basic or Pro plan" });
      return;
    }

    const apiKey = process.env.CSFLOAT_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "No API key configured" });
      return;
    }

    const tradeUpId = parseInt(req.params.id);
    if (isNaN(tradeUpId)) {
      res.status(400).json({ error: "Invalid trade-up ID" });
      return;
    }

    // Rate limit: basic 10/hr, pro 20/hr
    const verifyMax = userTier === "pro" || userTier === "admin" ? 20 : 10;
    const { checkRateLimit: checkRL } = await import("../redis.js");
    const verifyRateLimit = await checkRL(userId, "verify", verifyMax, 3600);
    if (!verifyRateLimit.allowed) {
      res.status(429).json({
        error: `Verify limit reached (${verifyMax}/hour). Resets in ${Math.ceil(verifyRateLimit.resetIn! / 60)} min.`,
        rate_limit: verifyRateLimit,
      });
      return;
    }

    // Load inputs for this trade-up
    const { rows: inputs } = await pool.query(
      "SELECT listing_id, skin_id, skin_name, price_cents, float_value, condition, source FROM trade_up_inputs WHERE trade_up_id = $1",
      [tradeUpId]
    );

    if (inputs.length === 0) {
      res.status(404).json({ error: "Trade-up not found" });
      return;
    }

    const deletedListingIds: string[] = []; // Track for cross-trade-up propagation

    const results: {
      listing_id: string;
      skin_name: string;
      status: "active" | "sold" | "delisted" | "theoretical" | "error";
      current_price?: number;
      original_price: number;
      price_changed?: boolean;
      sold_at?: string;
    }[] = [];

    // Pre-fetch DMarket listings by skin name (batch to minimize API calls)
    const dmSkinNames = new Set(
      inputs.filter((i: any) => i.listing_id.startsWith("dmarket:")).map((i: any) => i.skin_name)
    );
    const dmActiveIds = new Map<string, Set<string>>(); // skinName → set of active itemIds
    const dmPrices = new Map<string, number>(); // "dmarket:itemId" → current price
    if (dmSkinNames.size > 0 && isDMarketConfigured()) {
      for (const skinName of dmSkinNames) {
        try {
          const { items } = await fetchDMarketListings(skinName, { limit: 100 });
          const ids = new Set<string>();
          for (const item of items) {
            ids.add(`dmarket:${item.itemId}`);
            dmPrices.set(`dmarket:${item.itemId}`, parseInt(item.price?.USD ?? "0", 10));
          }
          dmActiveIds.set(skinName, ids);
        } catch {
          // DMarket unavailable — mark as error, don't delete
        }
      }
    }

    // Pre-fetch Skinport availability by skin name (one API call for all items)
    const spSkinNames = new Set(
      inputs.filter((i: any) => i.listing_id.startsWith("skinport:")).map((i: any) => {
        // Skinport API uses market_hash_name which includes condition
        const condition = i.condition || "Field-Tested";
        return `${i.skin_name} (${condition})`;
      })
    );
    const spAvailability = new Map<string, { quantity: number; minPrice: number }>(); // market_hash_name → availability
    if (spSkinNames.size > 0) {
      try {
        const spRes = await fetch("https://api.skinport.com/v1/items?app_id=730&currency=USD", {
          headers: { "Accept-Encoding": "br, gzip" },
        });
        if (spRes.ok) {
          const spItems = await spRes.json() as { market_hash_name: string; quantity: number; min_price: number | null }[];
          for (const item of spItems) {
            if (spSkinNames.has(item.market_hash_name)) {
              spAvailability.set(item.market_hash_name, {
                quantity: item.quantity,
                minPrice: Math.round((item.min_price ?? 0) * 100), // convert to cents
              });
            }
          }
        }
      } catch { /* Skinport API unavailable — will mark as error */ }
    }

    for (const input of inputs) {
      // Skip theoretical inputs
      if (input.listing_id === "theoretical" || input.listing_id.startsWith("theory")) {
        results.push({
          listing_id: input.listing_id,
          skin_name: input.skin_name,
          status: "theoretical",
          original_price: input.price_cents,
        });
        continue;
      }

      // DMarket listings — check against pre-fetched active set
      if (input.listing_id.startsWith("dmarket:")) {
        const activeSet = dmActiveIds.get(input.skin_name);
        if (!activeSet) {
          // DMarket fetch failed or not configured
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "error",
            original_price: input.price_cents,
          });
          continue;
        }
        if (activeSet.has(input.listing_id)) {
          const currentPrice = dmPrices.get(input.listing_id);
          const priceChanged = currentPrice !== undefined && currentPrice !== input.price_cents;
          if (priceChanged && currentPrice !== undefined) {
            await pool.query(
              "UPDATE listings SET price_cents = $1, created_at = $2, price_updated_at = NOW() WHERE id = $3",
              [currentPrice, new Date().toISOString(), input.listing_id]
            );
          }
          await pool.query("UPDATE listings SET staleness_checked_at = NOW() WHERE id = $1", [input.listing_id]);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "active",
            current_price: currentPrice ?? input.price_cents,
            original_price: input.price_cents,
            price_changed: priceChanged,
          });
        } else {
          await pool.query("DELETE FROM listings WHERE id = $1", [input.listing_id]);
          deletedListingIds.push(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "delisted",
            original_price: input.price_cents,
          });
        }
        continue;
      }

      // Skinport listings — verify via price proximity check (no individual listing API)
      if (input.listing_id.startsWith("skinport:")) {
        const condition = input.condition || "Field-Tested";
        const marketHashName = `${input.skin_name} (${condition})`;
        const spInfo = spAvailability.get(marketHashName);

        if (!spInfo) {
          // Skinport API didn't return this skin — can't verify
          await pool.query("UPDATE listings SET staleness_checked_at = NOW() WHERE id = $1", [input.listing_id]);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "error",
            original_price: input.price_cents,
          });
          continue;
        }

        if (spInfo.quantity === 0) {
          // No listings at all for this skin+condition — definitely sold
          await pool.query("DELETE FROM listings WHERE id = $1", [input.listing_id]);
          deletedListingIds.push(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "sold",
            original_price: input.price_cents,
          });
          continue;
        }

        // Price proximity: if min_price is >20% higher than our listing, likely sold (ours was cheapest)
        const priceDrift = spInfo.minPrice > 0 ? (spInfo.minPrice - input.price_cents) / input.price_cents : 0;
        if (priceDrift > 0.20) {
          // Current cheapest is significantly more expensive — our listing was probably bought
          await pool.query("DELETE FROM listings WHERE id = $1", [input.listing_id]);
          deletedListingIds.push(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "sold",
            original_price: input.price_cents,
            current_price: spInfo.minPrice,
            price_changed: true,
          });
          continue;
        }

        // Price is close — listing likely still available. Update price if changed.
        const priceChanged = spInfo.minPrice > 0 && Math.abs(spInfo.minPrice - input.price_cents) > 5;
        if (priceChanged) {
          await pool.query(
            "UPDATE listings SET price_cents = $1, created_at = $2, price_updated_at = NOW() WHERE id = $3",
            [spInfo.minPrice, new Date().toISOString(), input.listing_id]
          );
        }
        await pool.query("UPDATE listings SET staleness_checked_at = NOW() WHERE id = $1", [input.listing_id]);
        results.push({
          listing_id: input.listing_id,
          skin_name: input.skin_name,
          status: "active",
          current_price: spInfo.minPrice > 0 ? spInfo.minPrice : input.price_cents,
          original_price: input.price_cents,
          price_changed: priceChanged,
        });
        continue;
      }

      try {
        const apiRes = await fetch(`https://csfloat.com/api/v1/listings/${input.listing_id}`, {
          headers: { Authorization: apiKey, Accept: "application/json" },
        });

        if (apiRes.status === 429) {
          // Rate limited — stop checking, return partial results
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "error",
            original_price: input.price_cents,
          });
          break;
        }

        if (!apiRes.ok) {
          // 404 or other — listing gone
          await pool.query("DELETE FROM listings WHERE id = $1", [input.listing_id]);
          deletedListingIds.push(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "delisted",
            original_price: input.price_cents,
          });
          continue;
        }

        const data = await apiRes.json() as {
          state: string;
          price: number;
          sold_at?: string;
          created_at?: string;
          item?: { float_value?: number };
        };

        if (data.state === "listed") {
          const priceChanged = data.price !== input.price_cents;
          if (priceChanged) {
            await pool.query(
              "UPDATE listings SET price_cents = $1, created_at = $2, price_updated_at = NOW() WHERE id = $3",
              [data.price, new Date().toISOString(), input.listing_id]
            );
          }
          await pool.query("UPDATE listings SET staleness_checked_at = NOW() WHERE id = $1", [input.listing_id]);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "active",
            current_price: data.price,
            original_price: input.price_cents,
            price_changed: priceChanged,
          });
        } else if (data.state === "sold") {
          const salePrice = data.price || input.price_cents;
          const saleFloat = data.item?.float_value || input.float_value;
          const soldAt = data.sold_at || data.created_at || new Date().toISOString();
          // Phase-qualify Doppler names for accurate per-phase pricing data
          const { rows: [phaseRow] } = await pool.query("SELECT phase FROM listings WHERE id = $1", [input.listing_id]);
          const obsName = phaseRow?.phase && input.skin_name.includes("Doppler")
            ? `${input.skin_name} ${phaseRow.phase}`
            : input.skin_name;
          await pool.query(
            `INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
             VALUES ($1, $2, $3, 'sale', $4)
             ON CONFLICT DO NOTHING`,
            [obsName, saleFloat, salePrice, soldAt]
          );
          await pool.query("DELETE FROM listings WHERE id = $1", [input.listing_id]);
          deletedListingIds.push(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "sold",
            current_price: salePrice,
            original_price: input.price_cents,
            sold_at: soldAt,
          });
        } else {
          // delisted, refunded, etc.
          await pool.query("DELETE FROM listings WHERE id = $1", [input.listing_id]);
          deletedListingIds.push(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "delisted",
            original_price: input.price_cents,
          });
        }

        // Brief pause between API calls
        await new Promise(r => setTimeout(r, 100));
      } catch { /* network error — non-critical */
        results.push({
          listing_id: input.listing_id,
          skin_name: input.skin_name,
          status: "error",
          original_price: input.price_cents,
        });
      }
    }

    const allActive = results.every(r => r.status === "active" || r.status === "theoretical");
    const anyUnavailable = results.some(r => r.status === "sold" || r.status === "delisted");
    const anyPriceChanged = results.some(r => r.price_changed);

    // Update trade-up listing_status based on verify results
    if (anyUnavailable) {
      const unavailCount = results.filter(r => r.status === "sold" || r.status === "delisted").length;
      const totalReal = results.filter(r => r.status !== "theoretical").length;
      const newStatus = unavailCount >= totalReal ? "stale" : "partial";
      await pool.query(
        "UPDATE trade_ups SET listing_status = $1, preserved_at = COALESCE(preserved_at, NOW()) WHERE id = $2",
        [newStatus, tradeUpId]
      );
    } else if (allActive) {
      // If verify confirms all active, clear any stale/partial status
      await pool.query(
        "UPDATE trade_ups SET listing_status = 'active', preserved_at = NULL WHERE id = $1 AND listing_status != 'active'",
        [tradeUpId]
      );
    }

    // Recalculate trade-up if prices changed
    let updatedTradeUp: { total_cost_cents: number; expected_value_cents: number; profit_cents: number; roi_percentage: number } | null = null;
    if (anyPriceChanged && allActive) {
      // Sum up current prices (use verified price if available, else original)
      const newTotalCost = results.reduce((sum, r) => {
        const price = r.current_price ?? r.original_price;
        return sum + price;
      }, 0);

      // Get current EV from outcomes
      const { rows: [tu] } = await pool.query(
        "SELECT expected_value_cents, outcomes_json FROM trade_ups WHERE id = $1",
        [tradeUpId]
      );
      if (tu) {
        const ev = tu.expected_value_cents;
        const profit = ev - newTotalCost;
        const roi = newTotalCost > 0 ? Math.round((profit / newTotalCost) * 10000) / 100 : 0;

        // Update DB with new cost
        await pool.query(
          "UPDATE trade_ups SET total_cost_cents = $1, profit_cents = $2, roi_percentage = $3 WHERE id = $4",
          [newTotalCost, profit, roi, tradeUpId]
        );

        // Also update input prices in trade_up_inputs
        for (const r of results) {
          if (r.price_changed && r.current_price !== undefined) {
            await pool.query(
              "UPDATE trade_up_inputs SET price_cents = $1 WHERE trade_up_id = $2 AND listing_id = $3",
              [r.current_price, tradeUpId, r.listing_id]
            );
          }
        }

        updatedTradeUp = { total_cost_cents: newTotalCost, expected_value_cents: ev, profit_cents: profit, roi_percentage: roi };
      }
    }

    // Propagate sold/delisted status to ALL other trade-ups sharing deleted listings
    if (deletedListingIds.length > 0) {
      for (const lid of deletedListingIds) {
        const { rows: affected } = await pool.query(
          "SELECT DISTINCT trade_up_id FROM trade_up_inputs WHERE listing_id = $1 AND trade_up_id != $2",
          [lid, tradeUpId]
        );
        if (affected.length > 0) {
          const ids = affected.map((r: any) => r.trade_up_id);
          const placeholders = ids.map((_: any, i: number) => `$${i + 1}`).join(",");
          await pool.query(
            `UPDATE trade_ups SET listing_status = 'partial', preserved_at = COALESCE(preserved_at, NOW())
             WHERE id IN (${placeholders}) AND listing_status = 'active'`,
            ids
          );
        }
      }
    }

    // Track verify API calls in Redis so daemon can adjust staleness budget
    const csfloatCallCount = results.filter(r => r.status !== "theoretical" && !r.listing_id.startsWith("dmarket:")).length;
    if (csfloatCallCount > 0) {
      import("../redis.js").then(({ getRedis }) => {
        getRedis()?.incrby("verify_api_calls", csfloatCallCount).catch(() => {});
      }).catch(() => {});
    }

    // Await Redis invalidation before responding so next request sees fresh data
    if (anyUnavailable || anyPriceChanged) {
      const { cacheInvalidatePrefix } = await import("../redis.js");
      await cacheInvalidatePrefix("tu:");
      await cacheInvalidatePrefix("tu_inputs:" + tradeUpId);
    }

    res.json({
      trade_up_id: tradeUpId,
      inputs: results,
      all_active: allActive,
      any_unavailable: anyUnavailable,
      any_price_changed: anyPriceChanged,
      updated_trade_up: updatedTradeUp,
      rate_limit: verifyRateLimit,
    });
  });

  // Load inputs on-demand (not included in list response to save bandwidth)
  router.get("/api/trade-up/:id/inputs", cachedRoute((req) => "tu_inputs:" + req.params.id, 120, async (req, res) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const { rows: inputs } = await pool.query("SELECT * FROM trade_up_inputs WHERE trade_up_id = $1", [id]);
    if (inputs.length === 0) {
      // Check if trade-up exists
      const { rows: [exists] } = await pool.query("SELECT id FROM trade_ups WHERE id = $1", [id]);
      if (!exists) { res.status(404).json({ error: "Not found" }); return; }
    }
    // Check for missing listings
    const missingIds = new Set<string>();
    if (inputs.length > 0) {
      const { rows: missing } = await pool.query(
        `SELECT tui.listing_id FROM trade_up_inputs tui LEFT JOIN listings l ON tui.listing_id = l.id WHERE tui.trade_up_id = $1 AND l.id IS NULL`,
        [id]
      );
      for (const m of missing) missingIds.add(m.listing_id);
    }
    for (const inp of inputs) {
      if (missingIds.has(inp.listing_id)) (inp as any).missing = true;
    }
    res.json({ inputs });
  }));

  // Load outcomes on-demand (not included in list response to save bandwidth)
  router.get("/api/trade-up/:id/outcomes", cachedRoute((req) => "tu_outcomes:" + req.params.id, 120, async (req, res) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const { rows: [row] } = await pool.query("SELECT outcomes_json FROM trade_ups WHERE id = $1", [id]);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ outcomes: JSON.parse(row.outcomes_json || "[]") });
  }));

  router.get("/api/price-details", cachedRoute((req) => "price:" + req.query.skin_name + ":" + req.query.condition, 60, async (req, res) => {
    const { skin_name, condition } = req.query as Record<string, string>;
    if (!skin_name || !condition) {
      res.status(400).json({ error: "skin_name and condition required" });
      return;
    }

    const cacheKey = `${skin_name}:${condition}`;
    const cached = priceCache.get(cacheKey);
    const source = priceSources.get(cacheKey) ?? "unknown";

    // All price_data entries
    const { rows: priceDataRows } = await pool.query(`
      SELECT source, median_price_cents, min_price_cents, volume, updated_at
      FROM price_data WHERE skin_name = $1 AND condition = $2
      ORDER BY source
    `, [skin_name, condition]);

    // Listing floor
    const condBounds: Record<string, { min: number; max: number }> = {
      "Factory New": { min: 0.0, max: 0.07 },
      "Minimal Wear": { min: 0.07, max: 0.15 },
      "Field-Tested": { min: 0.15, max: 0.38 },
      "Well-Worn": { min: 0.38, max: 0.45 },
      "Battle-Scarred": { min: 0.45, max: 1.0 },
    };
    const bounds = condBounds[condition];
    let listings: any[] = [];
    if (bounds) {
      const { rows } = await pool.query(`
        SELECT l.price_cents, l.float_value, l.created_at
        FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE s.name = $1 AND l.float_value >= $2 AND l.float_value < $3
          AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
        ORDER BY l.price_cents ASC LIMIT 5
      `, [skin_name, bounds.min, bounds.max]);
      listings = rows;
    }

    // Sale history
    let sales: any[] = [];
    const { rows: tableCheck } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sale_history'"
    );
    if (tableCheck.length > 0 && bounds) {
      const { rows } = await pool.query(`
        SELECT price_cents, float_value, sold_at
        FROM sale_history WHERE skin_name = $1 AND float_value >= $2 AND float_value < $3
        ORDER BY sold_at DESC LIMIT 10
      `, [skin_name, bounds.min, bounds.max]);
      sales = rows;
    }

    res.json({
      skin_name,
      condition,
      cached_price: cached !== undefined ? { price: cached, source } : null,
      price_data: priceDataRows,
      listings,
      recent_sales: sales,
    });
  }));

  // Outcome skin stats — listings, sales, price data sources per skin
  router.get("/api/outcome-stats", cachedRoute((req) => "outcome_stats:" + req.query.skins, 120, async (req, res) => {
    const skins = ((req.query.skins as string) || "").split("||").filter(Boolean);
    if (skins.length === 0) { res.json({ stats: {} }); return; }

    const stats: Record<string, { listings: number; sales: number; sources: string[] }> = {};
    for (const name of skins.slice(0, 100)) {
      const { rows: [listingRow] } = await pool.query(
        "SELECT COUNT(*) as c FROM listings WHERE skin_id IN (SELECT id FROM skins WHERE name = $1) AND stattrak = 0",
        [name]
      );
      const { rows: [saleRow] } = await pool.query(
        "SELECT COUNT(*) as c FROM price_observations WHERE skin_name = $1 AND source = 'sale'",
        [name]
      );
      const { rows: sourceRows } = await pool.query(
        "SELECT DISTINCT source FROM price_data WHERE skin_name = $1",
        [name]
      );
      stats[name] = { listings: parseInt(listingRow.c), sales: parseInt(saleRow.c), sources: sourceRows.map((r: any) => r.source as string) };
    }
    res.json({ stats });
  }));

  return router;
}
