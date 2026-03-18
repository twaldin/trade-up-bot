import { Router } from "express";
import type Database from "better-sqlite3";
import { priceCache, priceSources } from "../engine.js";
import { fetchDMarketListings, isDMarketConfigured } from "../sync.js";
import { getTierConfig, type User } from "../auth.js";
import { cachedRoute, getRateLimit } from "../redis.js";
import { getActiveClaims } from "./claims.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome, InputSummary } from "../../shared/types.js";

export function tradeUpsRouter(db: Database.Database): Router {
  const router = Router();
  const rdb = db; // All reads from main DB (WAL mode + Redis cache handles concurrency)

  router.get("/api/filter-options", cachedRoute("filter_opts", 600, (_req, res) => {
    // All trade-ups are non-theoretical (theory removed), so skip the expensive
    // subquery filter. Direct DISTINCT on 2.35M-row trade_up_inputs is fast with index.
    const inputSkins = rdb.prepare(
      `SELECT DISTINCT skin_name as name FROM trade_up_inputs`
    ).all() as { name: string }[];

    const skinMap = new Map<string, { name: string; input: boolean; output: boolean }>();
    for (const s of inputSkins) {
      skinMap.set(s.name, { name: s.name, input: true, output: false });
    }
    // Output skins: trade_up_outcomes table is empty (data in outcomes_json).
    // Extracting from JSON is too expensive (260K rows). Input skins cover
    // the primary filter use case; output skin search still works via the
    // trade-ups query's outcomes_json LIKE filter.

    const collections = rdb.prepare(
      `SELECT collection_name as name, COUNT(*) as count FROM trade_up_inputs GROUP BY collection_name ORDER BY count DESC`
    ).all() as { name: string; count: number }[];

    const result = { skins: [...skinMap.values()], collections };
    res.json(result);
  }));

  // Free tier: 10 oldest stale profitable (or >25% chance) trade-ups per type.
  // Same set for ALL free users. Refreshed each daemon cycle.
  const FREE_PER_TYPE = 10;
  const freeCache = new Map<string, { rows: any[]; calcTs: string }>();

  function getFreeTierTradeUps(types: string[]): any[] {
    const calcRow = rdb.prepare("SELECT value FROM sync_meta WHERE key = 'last_calculation'").get() as { value: string } | undefined;
    const calcTs = calcRow?.value || "";

    const results: any[] = [];
    for (const t of types) {
      const cached = freeCache.get(t);
      if (cached && cached.calcTs === calcTs) {
        results.push(...cached.rows);
        continue;
      }
      // 10 oldest stale/partial trade-ups that are profitable or have >25% chance to profit
      const rows = rdb.prepare(`
        SELECT t.id, t.type, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
               t.roi_percentage, t.created_at, t.is_theoretical, t.listing_status,
               t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
               0 as outcome_count
        FROM trade_ups t
        WHERE t.is_theoretical = 0 AND t.type = ?
          AND (t.listing_status = 'stale' OR t.listing_status = 'partial')
          AND (t.profit_cents > 0 OR t.chance_to_profit >= 0.25)
        ORDER BY t.created_at ASC LIMIT ?
      `).all(t, FREE_PER_TYPE) as any[];
      freeCache.set(t, { rows, calcTs });
      results.push(...rows);
    }
    return results;
  }

  router.get("/api/trade-ups", cachedRoute((req) => {
    // Don't cache my_claims responses — they change on every claim/release and must be real-time
    if (req.query.my_claims === "true") return null;
    return "tu:" + JSON.stringify(req.query) + ((req.user as any)?.steam_id || "anon") + ((req.user as any)?.tier || "free");
  }, 600, async (req, res) => {
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
      const freeRows = getFreeTierTradeUps(freeTypes);

      // Batch-load inputs for all free tier trade-ups (fixes N+1)
      // Build input summaries for free tier (same lightweight approach as paid)
      const freeIds = freeRows.map((r: any) => r.id);
      const freeSummaryByTuId = new Map<number, InputSummary>();
      if (freeIds.length > 0) {
        const ph = freeIds.map(() => "?").join(",");
        const summaryRows = rdb.prepare(
          `SELECT trade_up_id, skin_name, condition, collection_name FROM trade_up_inputs WHERE trade_up_id IN (${ph})`
        ).all(...freeIds) as { trade_up_id: number; skin_name: string; condition: string; collection_name: string }[];
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
      try { myClaimCount = (rdb.prepare("SELECT COUNT(*) as c FROM trade_up_claims WHERE user_id = ? AND released_at IS NULL AND expires_at > datetime('now')").get(userId) as { c: number }).c; } catch {}

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

    // Basic tier: 30-min delay — only show trade-ups created 30+ min ago
    if (effectiveTier === "basic") {
      where += ` AND t.created_at <= datetime('now', '-1800 seconds')`;
    }

    // Load active claims from Redis (fast) — includes listing IDs for conflict detection
    const activeClaims = await getActiveClaims(db);
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
      where += ` AND t.id IN (${myClaimIds.map(() => "?").join(",")})`;
      params.push(...myClaimIds);
    } else if (type) {
      where += " AND t.type = ?";
      params.push(type);
    }

    if (min_profit) {
      where += " AND t.profit_cents >= ?";
      params.push(parseInt(min_profit));
    }
    if (max_profit) {
      where += " AND t.profit_cents <= ?";
      params.push(parseInt(max_profit));
    }
    if (min_roi) {
      where += " AND t.roi_percentage >= ?";
      params.push(parseFloat(min_roi));
    }
    if (max_roi) {
      where += " AND t.roi_percentage <= ?";
      params.push(parseFloat(max_roi));
    }
    if (max_cost) {
      where += " AND t.total_cost_cents <= ?";
      params.push(parseInt(max_cost));
    }
    if (min_cost) {
      where += " AND t.total_cost_cents >= ?";
      params.push(parseInt(min_cost));
    }
    if (min_chance) {
      where += " AND t.chance_to_profit >= ?";
      params.push(parseFloat(min_chance) / 100);
    }
    if (max_chance) {
      where += " AND t.chance_to_profit <= ?";
      params.push(parseFloat(max_chance) / 100);
    }

    // Skin name filter (exact match from autocomplete, or fuzzy search)
    if (skin) {
      const skinNames = skin.split("||").map(s => s.trim()).filter(Boolean);
      if (skinNames.length === 1 && !skinNames[0].includes("%")) {
        // Exact skin name match — check inputs table + outcomes_json LIKE
        where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name = ?) OR t.outcomes_json LIKE ?)`;
        params.push(skinNames[0], `%"skin_name":"${skinNames[0].replace(/"/g, '\\"')}"%`);
      } else if (skinNames.length > 1) {
        // Multiple exact skin names (OR) — check inputs + outcomes_json LIKE for each
        const inputPlaceholders = skinNames.map(() => "?").join(",");
        const outcomeLikes = skinNames.map(() => "t.outcomes_json LIKE ?").join(" OR ");
        where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name IN (${inputPlaceholders})) OR ${outcomeLikes})`;
        params.push(...skinNames, ...skinNames.map(s => `%"skin_name":"${s.replace(/"/g, '\\"')}"%`));
      } else {
        where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name LIKE ?) OR t.outcomes_json LIKE ?)`;
        const pattern = `%${skin}%`;
        params.push(pattern, pattern);
      }
    }

    // Collection filter
    if (collection) {
      const collNames = collection.split("|").map(s => s.trim()).filter(Boolean);
      const placeholders = collNames.map(() => "?").join(",");
      where += ` AND t.id IN (
        SELECT trade_up_id FROM trade_up_inputs WHERE collection_name IN (${placeholders})
      )`;
      params.push(...collNames);
    }

    // Max outcomes filter — count from outcomes_json array
    if (max_outcomes) {
      where += ` AND json_array_length(COALESCE(t.outcomes_json, '[]')) <= ?`;
      params.push(parseInt(max_outcomes));
    }

    // Max loss: worst case must be >= -maxLoss (user enters positive, we negate)
    if (max_loss) {
      where += ` AND t.worst_case_cents >= ?`;
      params.push(-Math.abs(parseInt(max_loss)));
    }

    // Min win: best case must be >= minWin
    if (min_win) {
      where += ` AND t.best_case_cents >= ?`;
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

    // Get total count + profitable count (same WHERE, so counts match filters exactly)
    const counts = rdb.prepare(
      `SELECT COUNT(*) as c, SUM(CASE WHEN t.profit_cents > 0 THEN 1 ELSE 0 END) as profitable FROM trade_ups t ${where}`
    ).get(...params) as { c: number; profitable: number };
    const total = counts.c;
    const totalProfitable = counts.profitable ?? 0;

    // Get trade-ups — exclude outcomes_json from list query (large TEXT blobs kill sort performance)
    const rows = rdb
      .prepare(
        `SELECT t.id, t.type, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
                t.roi_percentage, t.created_at, t.is_theoretical, t.listing_status,
                t.peak_profit_cents, t.profit_streak, t.preserved_at, t.previous_inputs,
                t.combo_key, t.chance_to_profit, t.best_case_cents, t.worst_case_cents,
                0 as outcome_count
         FROM trade_ups t ${where}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(...params, perPage, offset) as {
      id: number;
      type: string;
      total_cost_cents: number;
      expected_value_cents: number;
      profit_cents: number;
      roi_percentage: number;
      created_at: string;
      is_theoretical: number;
      listing_status: string | null;
      peak_profit_cents: number | null;
      profit_streak: number | null;
      preserved_at: string | null;
      previous_inputs: string | null;
      combo_key: string | null;
    }[];

    // Batch-load lightweight input summaries (skin_name, condition, collection_name only).
    // Full inputs are loaded on-demand when expanding a row via /api/trade-up/:id/inputs.
    const tuIds = rows.map(r => r.id);
    const summaryByTuId = new Map<number, InputSummary>();
    const inputCountByTuId = new Map<number, number>();
    if (tuIds.length > 0) {
      const placeholders = tuIds.map(() => "?").join(",");
      const summaryRows = rdb.prepare(
        `SELECT trade_up_id, skin_name, condition, collection_name FROM trade_up_inputs WHERE trade_up_id IN (${placeholders})`
      ).all(...tuIds) as { trade_up_id: number; skin_name: string; condition: string; collection_name: string }[];

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
    const nonActiveIds = rows.filter(r => r.listing_status !== 'active').map(r => r.id);
    // Check ALL returned trade-ups for missing inputs (not just non-active)
    // Catches: phantom stale (0 missing but marked stale) AND phantom active (has missing but marked active)
    const allIds = rows.map(r => r.id);
    const missingCountByTuId = new Map<number, number>();
    if (allIds.length > 0) {
      // Batch in chunks of 500 to avoid SQLite variable limit
      for (let i = 0; i < allIds.length; i += 500) {
        const chunk = allIds.slice(i, i + 500);
        const placeholders = chunk.map(() => "?").join(",");
        const missingRows = rdb.prepare(`
          SELECT tui.trade_up_id, COUNT(*) as cnt FROM trade_up_inputs tui
          LEFT JOIN listings l ON tui.listing_id = l.id
          WHERE tui.trade_up_id IN (${placeholders})
            AND l.id IS NULL AND tui.listing_id NOT LIKE 'theor%'
          GROUP BY tui.trade_up_id
        `).all(...chunk) as { trade_up_id: number; cnt: number }[];
        for (const r of missingRows) {
          missingCountByTuId.set(r.trade_up_id, r.cnt);
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

    const tradeUps: TradeUp[] = rows.map((row) => {
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
        is_theoretical: row.is_theoretical === 1,
        inputs: [], // loaded on-demand via /api/trade-up/:id/inputs
        input_summary: summary,
        outcomes: [],
        chance_to_profit: (row as any).chance_to_profit ?? 0,
        best_case_cents: (row as any).best_case_cents ?? 0,
        worst_case_cents: (row as any).worst_case_cents ?? 0,
        outcome_count: (row as any).outcome_count ?? 0,
        listing_status: (correctedStatus ?? row.listing_status ?? 'active') as TradeUp['listing_status'],
        missing_inputs: missingCount,
        profit_streak: row.profit_streak ?? 0,
        peak_profit_cents: row.peak_profit_cents ?? 0,
        preserved_at: correctedStatus === 'active' ? null : (row.preserved_at ?? null),
        previous_inputs: row.previous_inputs ? JSON.parse(row.previous_inputs) : null,
      };

      return { ...tu, claimed_by_me: claimedByMe.has(row.id), claimed_by_other: claimedByOthers.has(row.id) };
    });

    const result = {
      trade_ups: tradeUps,
      total,
      total_profitable: totalProfitable,
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

  router.get("/api/trade-ups/:id", (req, res) => {
    const row = rdb
      .prepare("SELECT * FROM trade_ups WHERE id = ?")
      .get(req.params.id) as {
      id: number;
      total_cost_cents: number;
      expected_value_cents: number;
      profit_cents: number;
      roi_percentage: number;
      created_at: string;
    } | undefined;

    if (!row) {
      res.status(404).json({ error: "Trade-up not found" });
      return;
    }

    const inputs = rdb
      .prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?")
      .all(row.id) as TradeUpInput[];
    const outcomes = JSON.parse((row as { outcomes_json?: string }).outcomes_json || '[]') as TradeUpOutcome[];

    res.json({ ...row, inputs, outcomes });
  });

  router.post("/api/verify-trade-up/:id", async (req, res) => {
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
    const userId = (req.user as any)?.steam_id || "anonymous";
    const userTier = (req.user as any)?.tier || "free";
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
    const inputs = db.prepare(
      "SELECT listing_id, skin_id, skin_name, price_cents, float_value, condition, source FROM trade_up_inputs WHERE trade_up_id = ?"
    ).all(tradeUpId) as { listing_id: string; skin_id: string; skin_name: string; price_cents: number; float_value: number; condition: string; source: string }[];

    if (inputs.length === 0) {
      res.status(404).json({ error: "Trade-up not found" });
      return;
    }

    const deleteListing = db.prepare("DELETE FROM listings WHERE id = ?");
    const updateListingPrice = db.prepare("UPDATE listings SET price_cents = ?, created_at = ? WHERE id = ?");
    const markChecked = db.prepare("UPDATE listings SET staleness_checked_at = datetime('now') WHERE id = ?");
    const deletedListingIds: string[] = []; // Track for cross-trade-up propagation
    const insertObservation = db.prepare(`
      INSERT OR IGNORE INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
      VALUES (?, ?, ?, 'sale', ?)
    `);

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
      inputs.filter(i => i.listing_id.startsWith("dmarket:")).map(i => i.skin_name)
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
            updateListingPrice.run(currentPrice, new Date().toISOString(), input.listing_id);
          }
          markChecked.run(input.listing_id);
          results.push({
            listing_id: input.listing_id,
            skin_name: input.skin_name,
            status: "active",
            current_price: currentPrice ?? input.price_cents,
            original_price: input.price_cents,
            price_changed: priceChanged,
          });
        } else {
          deleteListing.run(input.listing_id);
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
          deleteListing.run(input.listing_id);
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
            updateListingPrice.run(data.price, new Date().toISOString(), input.listing_id);
          }
          markChecked.run(input.listing_id);
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
          const phase = db.prepare("SELECT phase FROM listings WHERE id = ?").get(input.listing_id) as { phase: string | null } | undefined;
          const obsName = phase?.phase && input.skin_name.includes("Doppler")
            ? `${input.skin_name} ${phase.phase}`
            : input.skin_name;
          insertObservation.run(obsName, saleFloat, salePrice, soldAt);
          deleteListing.run(input.listing_id);
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
          deleteListing.run(input.listing_id);
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
      db.prepare(
        "UPDATE trade_ups SET listing_status = ?, preserved_at = COALESCE(preserved_at, datetime('now')) WHERE id = ?"
      ).run(newStatus, tradeUpId);
    } else if (allActive) {
      // If verify confirms all active, clear any stale/partial status
      db.prepare(
        "UPDATE trade_ups SET listing_status = 'active', preserved_at = NULL WHERE id = ? AND listing_status != 'active'"
      ).run(tradeUpId);
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
      const tu = db.prepare("SELECT expected_value_cents, outcomes_json FROM trade_ups WHERE id = ?").get(tradeUpId) as { expected_value_cents: number; outcomes_json: string | null } | undefined;
      if (tu) {
        const ev = tu.expected_value_cents;
        const profit = ev - newTotalCost;
        const roi = newTotalCost > 0 ? Math.round((profit / newTotalCost) * 10000) / 100 : 0;

        // Update DB with new cost
        db.prepare(
          "UPDATE trade_ups SET total_cost_cents = ?, profit_cents = ?, roi_percentage = ? WHERE id = ?"
        ).run(newTotalCost, profit, roi, tradeUpId);

        // Also update input prices in trade_up_inputs
        for (const r of results) {
          if (r.price_changed && r.current_price !== undefined) {
            db.prepare("UPDATE trade_up_inputs SET price_cents = ? WHERE trade_up_id = ? AND listing_id = ?")
              .run(r.current_price, tradeUpId, r.listing_id);
          }
        }

        updatedTradeUp = { total_cost_cents: newTotalCost, expected_value_cents: ev, profit_cents: profit, roi_percentage: roi };
      }
    }

    // Propagate sold/delisted status to ALL other trade-ups sharing deleted listings
    if (deletedListingIds.length > 0) {
      for (const lid of deletedListingIds) {
        const affected = db.prepare(
          "SELECT DISTINCT trade_up_id FROM trade_up_inputs WHERE listing_id = ? AND trade_up_id != ?"
        ).all(lid, tradeUpId) as { trade_up_id: number }[];
        if (affected.length > 0) {
          const ids = affected.map(r => r.trade_up_id);
          db.prepare(
            `UPDATE trade_ups SET listing_status = 'partial', preserved_at = COALESCE(preserved_at, datetime('now'))
             WHERE id IN (${ids.map(() => "?").join(",")}) AND listing_status = 'active'`
          ).run(...ids);
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
  router.get("/api/trade-up/:id/inputs", cachedRoute((req) => "tu_inputs:" + req.params.id, 120, (req, res) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const inputs = rdb.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?").all(id) as TradeUpInput[];
    if (inputs.length === 0) {
      // Check if trade-up exists
      const exists = rdb.prepare("SELECT id FROM trade_ups WHERE id = ?").get(id);
      if (!exists) { res.status(404).json({ error: "Not found" }); return; }
    }
    // Check for missing listings
    const missingIds = new Set<string>();
    if (inputs.length > 0) {
      const ph = inputs.map(() => "?").join(",");
      const missing = rdb.prepare(
        `SELECT tui.listing_id FROM trade_up_inputs tui LEFT JOIN listings l ON tui.listing_id = l.id WHERE tui.trade_up_id = ? AND l.id IS NULL`
      ).all(id) as { listing_id: string }[];
      for (const m of missing) missingIds.add(m.listing_id);
    }
    for (const inp of inputs) {
      if (missingIds.has(inp.listing_id)) (inp as any).missing = true;
    }
    res.json({ inputs });
  }));

  // Load outcomes on-demand (not included in list response to save bandwidth)
  router.get("/api/trade-up/:id/outcomes", cachedRoute((req) => "tu_outcomes:" + req.params.id, 120, (req, res) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const row = rdb.prepare("SELECT outcomes_json FROM trade_ups WHERE id = ?").get(id) as { outcomes_json: string | null } | undefined;
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ outcomes: JSON.parse(row.outcomes_json || "[]") });
  }));

  router.get("/api/price-details", cachedRoute((req) => "price:" + req.query.skin_name + ":" + req.query.condition, 60, (req, res) => {
    const { skin_name, condition } = req.query as Record<string, string>;
    if (!skin_name || !condition) {
      res.status(400).json({ error: "skin_name and condition required" });
      return;
    }

    const cacheKey = `${skin_name}:${condition}`;
    const cached = priceCache.get(cacheKey);
    const source = priceSources.get(cacheKey) ?? "unknown";

    // All price_data entries
    const priceDataRows = rdb.prepare(`
      SELECT source, median_price_cents, min_price_cents, volume, updated_at
      FROM price_data WHERE skin_name = ? AND condition = ?
      ORDER BY source
    `).all(skin_name, condition) as { source: string; median_price_cents: number; min_price_cents: number; volume: number; updated_at: string }[];

    // Listing floor
    const condBounds: Record<string, { min: number; max: number }> = {
      "Factory New": { min: 0.0, max: 0.07 },
      "Minimal Wear": { min: 0.07, max: 0.15 },
      "Field-Tested": { min: 0.15, max: 0.38 },
      "Well-Worn": { min: 0.38, max: 0.45 },
      "Battle-Scarred": { min: 0.45, max: 1.0 },
    };
    const bounds = condBounds[condition];
    const listings = bounds ? rdb.prepare(`
      SELECT l.price_cents, l.float_value, l.created_at
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE s.name = ? AND l.float_value >= ? AND l.float_value < ?
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      ORDER BY l.price_cents ASC LIMIT 5
    `).all(skin_name, bounds.min, bounds.max) as { price_cents: number; float_value: number; created_at: string }[] : [];

    // Sale history
    const hasTable = rdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_history'").get();
    const sales = hasTable && bounds ? rdb.prepare(`
      SELECT price_cents, float_value, sold_at
      FROM sale_history WHERE skin_name = ? AND float_value >= ? AND float_value < ?
      ORDER BY sold_at DESC LIMIT 10
    `).all(skin_name, bounds.min, bounds.max) as { price_cents: number; float_value: number; sold_at: string }[] : [];

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
  router.get("/api/outcome-stats", cachedRoute((req) => "outcome_stats:" + req.query.skins, 120, (req, res) => {
    const skins = ((req.query.skins as string) || "").split("||").filter(Boolean);
    if (skins.length === 0) { res.json({ stats: {} }); return; }

    const stats: Record<string, { listings: number; sales: number; sources: string[] }> = {};
    for (const name of skins.slice(0, 100)) {
      const listings = (rdb.prepare(
        "SELECT COUNT(*) as c FROM listings WHERE skin_id IN (SELECT id FROM skins WHERE name = ?) AND stattrak = 0"
      ).get(name) as { c: number }).c;
      const sales = (rdb.prepare(
        "SELECT COUNT(*) as c FROM price_observations WHERE skin_name = ? AND source = 'sale'"
      ).get(name) as { c: number }).c;
      const sources = rdb.prepare(
        "SELECT DISTINCT source FROM price_data WHERE skin_name = ?"
      ).all(name).map((r: any) => r.source as string);
      stats[name] = { listings, sales, sources };
    }
    res.json({ stats });
  }));

  return router;
}
