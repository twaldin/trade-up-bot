import { Router } from "express";
import type Database from "better-sqlite3";
import { priceCache, priceSources } from "../engine.js";
import { fetchDMarketListings, isDMarketConfigured } from "../sync.js";
import { getTierConfig, type User } from "../auth.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

export function tradeUpsRouter(db: Database.Database): Router {
  const router = Router();

  // Cache filter options for 60s
  let filterCache: { data: any; ts: number } | null = null;

  router.get("/api/filter-options", (_req, res) => {
    if (filterCache && Date.now() - filterCache.ts < 60_000) {
      return res.json(filterCache.data);
    }
    // Get input skin names from trade_up_inputs table
    const inputSkins = db.prepare(`
      SELECT DISTINCT skin_name as name
      FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE is_theoretical = 0)
    `).all() as { name: string }[];

    // Get output skin names from outcomes_json column
    const outputSkinRows = db.prepare(`
      SELECT DISTINCT json_extract(je.value, '$.skin_name') as name
      FROM trade_ups t, json_each(t.outcomes_json) je
      WHERE t.is_theoretical = 0 AND t.outcomes_json IS NOT NULL
    `).all() as { name: string }[];

    const skins: { name: string; role: string }[] = [
      ...inputSkins.map(s => ({ name: s.name, role: 'input' })),
      ...outputSkinRows.filter(s => s.name).map(s => ({ name: s.name, role: 'output' })),
    ];

    // Dedupe and tag roles
    const skinMap = new Map<string, { name: string; input: boolean; output: boolean }>();
    for (const s of skins) {
      const existing = skinMap.get(s.name);
      if (existing) {
        if (s.role === "input") existing.input = true;
        else existing.output = true;
      } else {
        skinMap.set(s.name, { name: s.name, input: s.role === "input", output: s.role === "output" });
      }
    }

    const collections = db.prepare(`
      SELECT DISTINCT collection_name as name, COUNT(*) as count
      FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE is_theoretical = 0)
      GROUP BY collection_name ORDER BY count DESC
    `).all() as { name: string; count: number }[];

    const result = { skins: [...skinMap.values()], collections };
    filterCache = { data: result, ts: Date.now() };
    res.json(result);
  });

  router.get("/api/trade-ups", (req, res) => {
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
    } = req.query as Record<string, string>;

    // Tier gating: apply delay, result limits, and listing ID visibility per user tier
    const tierConfig = getTierConfig(req);
    const user = req.user as User | undefined;
    const userId = user?.steam_id || "anonymous";

    const pageNum = parseInt(page);
    const perPage = tierConfig.limit > 0 ? Math.min(parseInt(per_page), tierConfig.limit) : Math.min(parseInt(per_page), 500);
    const offset = (pageNum - 1) * perPage;

    const includeStale = req.query.include_stale === "true";
    let where: string;
    if (includeStale) {
      where = `WHERE t.is_theoretical = 0 AND (t.listing_status = 'active' OR t.preserved_at IS NOT NULL)`;
    } else {
      where = `WHERE t.is_theoretical = 0 AND t.listing_status = 'active'`;
    }
    const params: (string | number)[] = [];

    // Tier delay: free users see 30-min delayed data, basic 5-min, pro/admin real-time
    if (tierConfig.delay > 0) {
      where += ` AND t.created_at <= datetime('now', '-${tierConfig.delay} seconds')`;
    }

    // Exclude trade-ups claimed by OTHER users
    where += ` AND t.id NOT IN (
      SELECT trade_up_id FROM trade_up_claims
      WHERE released_at IS NULL AND expires_at > datetime('now')
      AND user_id != ?
    )`;
    params.push(userId);

    if (type) {
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

    // Get total count
    const total = (
      db.prepare(`SELECT COUNT(*) as c FROM trade_ups t ${where}`).get(...params) as { c: number }
    ).c;

    // Get trade-ups
    const rows = db
      .prepare(
        `SELECT t.*, json_array_length(t.outcomes_json) as outcome_count FROM trade_ups t ${where}
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

    // Load inputs for each trade-up; outcomes come from outcomes_json column
    const getInputs = db.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?");

    // Always compute missing count for non-active trade-ups
    const countMissing = db.prepare(`
      SELECT COUNT(*) as cnt FROM trade_up_inputs tui
      LEFT JOIN listings l ON tui.listing_id = l.id
      WHERE tui.trade_up_id = ? AND l.id IS NULL
    `);

    const tradeUps: TradeUp[] = rows.map((row) => {
      const tu: TradeUp = {
        id: row.id,
        type: row.type,
        total_cost_cents: row.total_cost_cents,
        expected_value_cents: row.expected_value_cents,
        profit_cents: row.profit_cents,
        roi_percentage: row.roi_percentage,
        created_at: row.created_at,
        is_theoretical: row.is_theoretical === 1,
        inputs: getInputs.all(row.id) as TradeUpInput[],
        outcomes: [], // Outcomes loaded on-demand via /api/trade-up/:id/outcomes
        chance_to_profit: (row as any).chance_to_profit ?? 0,
        best_case_cents: (row as any).best_case_cents ?? 0,
        worst_case_cents: (row as any).worst_case_cents ?? 0,
        outcome_count: (row as any).outcome_count ?? 0,
        listing_status: (row.listing_status as TradeUp['listing_status']) ?? 'active',
        missing_inputs: row.listing_status !== 'active'
          ? (countMissing.get(row.id) as { cnt: number }).cnt : 0,
        profit_streak: row.profit_streak ?? 0,
        peak_profit_cents: row.peak_profit_cents ?? 0,
        preserved_at: row.preserved_at ?? null,
        previous_inputs: row.previous_inputs ? JSON.parse(row.previous_inputs) : null,
      };

      return tu;
    });

    // Redact listing IDs for free users (show skin name + price but not specific listing)
    if (!tierConfig.showListingIds) {
      for (const tu of tradeUps) {
        if (tu.inputs) {
          for (const inp of tu.inputs) {
            (inp as any).listing_id = "hidden";
          }
        }
      }
    }

    res.json({
      trade_ups: tradeUps,
      total,
      page: pageNum,
      per_page: perPage,
      tier: user?.tier || "free",
      tier_config: { delay: tierConfig.delay, limit: tierConfig.limit, showListingIds: tierConfig.showListingIds },
    });
  });

  router.get("/api/trade-ups/:id", (req, res) => {
    const row = db
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

    const inputs = db
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

    res.json({
      trade_up_id: tradeUpId,
      inputs: results,
      all_active: allActive,
      any_unavailable: anyUnavailable,
      any_price_changed: anyPriceChanged,
      updated_trade_up: updatedTradeUp,
    });
  });

  // Load outcomes on-demand (not included in list response to save bandwidth)
  router.get("/api/trade-up/:id/outcomes", (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const row = db.prepare("SELECT outcomes_json FROM trade_ups WHERE id = ?").get(id) as { outcomes_json: string | null } | undefined;
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ outcomes: JSON.parse(row.outcomes_json || "[]") });
  });

  router.get("/api/price-details", (req, res) => {
    const { skin_name, condition } = req.query as Record<string, string>;
    if (!skin_name || !condition) {
      res.status(400).json({ error: "skin_name and condition required" });
      return;
    }

    const cacheKey = `${skin_name}:${condition}`;
    const cached = priceCache.get(cacheKey);
    const source = priceSources.get(cacheKey) ?? "unknown";

    // All price_data entries
    const priceDataRows = db.prepare(`
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
    const listings = bounds ? db.prepare(`
      SELECT l.price_cents, l.float_value, l.created_at
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE s.name = ? AND l.float_value >= ? AND l.float_value < ?
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      ORDER BY l.price_cents ASC LIMIT 5
    `).all(skin_name, bounds.min, bounds.max) as { price_cents: number; float_value: number; created_at: string }[] : [];

    // Sale history
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_history'").get();
    const sales = hasTable && bounds ? db.prepare(`
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
  });

  // Outcome skin stats — listings, sales, price data sources per skin
  router.get("/api/outcome-stats", (req, res) => {
    const skins = ((req.query.skins as string) || "").split("||").filter(Boolean);
    if (skins.length === 0) { res.json({ stats: {} }); return; }

    const stats: Record<string, { listings: number; sales: number; sources: string[] }> = {};
    for (const name of skins.slice(0, 100)) {
      const listings = (db.prepare(
        "SELECT COUNT(*) as c FROM listings WHERE skin_id IN (SELECT id FROM skins WHERE name = ?) AND stattrak = 0"
      ).get(name) as { c: number }).c;
      const sales = (db.prepare(
        "SELECT COUNT(*) as c FROM price_observations WHERE skin_name = ? AND source = 'sale'"
      ).get(name) as { c: number }).c;
      const sources = db.prepare(
        "SELECT DISTINCT source FROM price_data WHERE skin_name = ?"
      ).all(name).map((r: any) => r.source as string);
      stats[name] = { listings, sales, sources };
    }
    res.json({ stats });
  });

  return router;
}
