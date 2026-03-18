import { Router } from "express";
import type Database from "better-sqlite3";
import { cachedRoute } from "../redis.js";
import {
  buildPriceCache,
  evaluateTradeUp,
  evaluateKnifeTradeUp,
  getKnifeFinishesWithPrices,
  getOutcomesForCollections,
  getNextRarity,
  CASE_KNIFE_MAP,
  GLOVE_GEN_SKINS,
} from "../engine.js";
import type { ListingWithCollection, DbSkinOutcome } from "../engine/types.js";
import type { FinishData } from "../engine/knife-data.js";

interface CalculatorInput {
  skinName: string;
  floatValue: number;
  priceCents: number;
}

interface SkinRow {
  id: string;
  name: string;
  weapon: string;
  min_float: number;
  max_float: number;
  rarity: string;
  collection_id: string;
  collection_name: string;
}

export function calculatorRouter(db: Database.Database): Router {
  const router = Router();

  // --- Skin search autocomplete ---
  router.get("/api/calculator/search", cachedRoute((req) => req.query.q ? `calc_search:${req.query.q}` : null, 300, (req, res) => {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const pattern = `%${q}%`;
    const results = db.prepare(`
      SELECT DISTINCT s.name, s.weapon, s.rarity, s.min_float, s.max_float, c.name as collection_name
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      JOIN collections c ON sc.collection_id = c.id
      WHERE s.name LIKE ? AND s.stattrak = 0
      ORDER BY
        CASE WHEN s.name LIKE ? THEN 0 ELSE 1 END,
        s.rarity DESC,
        s.name ASC
      LIMIT 20
    `).all(pattern, `${q}%`) as {
      name: string;
      weapon: string;
      rarity: string;
      min_float: number;
      max_float: number;
      collection_name: string;
    }[];

    // Also fetch listing floor for each result
    const withFloor = results.map(r => {
      const floor = db.prepare(`
        SELECT MIN(l.price_cents) as floor_price
        FROM listings l
        JOIN skins s ON l.skin_id = s.id
        WHERE s.name = ? AND s.stattrak = 0
          AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      `).get(r.name) as { floor_price: number | null } | undefined;

      return {
        ...r,
        floor_price_cents: floor?.floor_price ?? null,
      };
    });

    res.json({ results: withFloor });
  }));

  // --- Calculator evaluation ---
  router.post("/api/calculator", (req, res) => {
    const { inputs } = req.body as { inputs: CalculatorInput[] };

    if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
      res.status(400).json({ error: "inputs array is required" });
      return;
    }

    if (inputs.length > 10) {
      res.status(400).json({ error: "Maximum 10 inputs allowed" });
      return;
    }

    // Look up each skin in the DB
    const skinLookup = db.prepare(`
      SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
             sc.collection_id, c.name as collection_name
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      JOIN collections c ON sc.collection_id = c.id
      WHERE s.name = ? AND s.stattrak = 0
      LIMIT 1
    `);

    const resolvedInputs: (ListingWithCollection & { _inputIndex: number })[] = [];
    const errors: string[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (!inp.skinName || inp.floatValue === undefined || inp.priceCents === undefined) {
        errors.push(`Input ${i + 1}: skinName, floatValue, and priceCents are required`);
        continue;
      }

      const skin = skinLookup.get(inp.skinName) as SkinRow | undefined;
      if (!skin) {
        errors.push(`Input ${i + 1}: skin "${inp.skinName}" not found`);
        continue;
      }

      // Validate float is within skin's range
      if (inp.floatValue < skin.min_float || inp.floatValue > skin.max_float) {
        errors.push(`Input ${i + 1}: float ${inp.floatValue} is outside ${skin.name}'s range [${skin.min_float}, ${skin.max_float}]`);
        continue;
      }

      resolvedInputs.push({
        id: `calculator:${i}`,
        skin_id: skin.id,
        skin_name: skin.name,
        weapon: skin.weapon,
        price_cents: inp.priceCents,
        float_value: inp.floatValue,
        paint_seed: null,
        stattrak: 0,
        min_float: skin.min_float,
        max_float: skin.max_float,
        rarity: skin.rarity,
        source: "calculator",
        collection_id: skin.collection_id,
        collection_name: skin.collection_name,
        _inputIndex: i,
      });
    }

    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    // Validate all inputs are same rarity
    const rarities = new Set(resolvedInputs.map(i => i.rarity));
    if (rarities.size > 1) {
      res.status(400).json({ error: `All inputs must be the same rarity. Found: ${[...rarities].join(", ")}` });
      return;
    }

    const inputRarity = resolvedInputs[0].rarity;
    const isKnifeTradeUp = inputRarity === "Covert" && resolvedInputs.length === 5;
    const isGunTradeUp = resolvedInputs.length === 10;

    if (!isKnifeTradeUp && !isGunTradeUp) {
      // Allow partial evaluation too — just validate count
      if (resolvedInputs.length < 5) {
        res.status(400).json({ error: `Need at least 5 inputs for a knife trade-up or 10 for a gun trade-up. Got ${resolvedInputs.length}.` });
        return;
      }
      if (resolvedInputs.length > 5 && resolvedInputs.length < 10) {
        res.status(400).json({ error: `Need exactly 5 inputs (Covert knife trade-up) or 10 inputs (gun trade-up). Got ${resolvedInputs.length}.` });
        return;
      }
    }

    // Build price cache for output pricing
    buildPriceCache(db);

    // Strip the helper field before passing to engine
    const engineInputs: ListingWithCollection[] = resolvedInputs.map(({ _inputIndex, ...rest }) => rest);

    let result;

    if (isKnifeTradeUp) {
      // Build knife finish cache (same as knife-discovery.ts)
      const knifeFinishCache = new Map<string, FinishData[]>();
      const allItemTypes = new Set<string>();
      for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
        for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
        if (caseInfo.gloveGen) {
          const genSkins = GLOVE_GEN_SKINS[caseInfo.gloveGen];
          if (genSkins) {
            for (const gloveType of Object.keys(genSkins)) allItemTypes.add(gloveType);
          }
        }
      }
      for (const itemType of allItemTypes) {
        const finishes = getKnifeFinishesWithPrices(db, itemType);
        if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
      }

      result = evaluateKnifeTradeUp(db, engineInputs, knifeFinishCache);
      if (result) result.type = "covert_knife";
    } else {
      // Gun trade-up: determine output rarity
      const outputRarity = getNextRarity(inputRarity);
      if (!outputRarity) {
        res.status(400).json({ error: `No higher rarity exists above "${inputRarity}"` });
        return;
      }

      // Get collection IDs from inputs
      const collectionIds = [...new Set(engineInputs.map(i => i.collection_id))];

      // Get possible outcomes
      const outcomes: DbSkinOutcome[] = getOutcomesForCollections(db, collectionIds, outputRarity);
      if (outcomes.length === 0) {
        res.status(400).json({ error: `No ${outputRarity} outcomes found for the input collections` });
        return;
      }

      result = evaluateTradeUp(db, engineInputs, outcomes);

      if (result) {
        // Determine type from rarity
        if (inputRarity === "Classified") result.type = "classified_covert";
        else if (inputRarity === "Restricted") result.type = "restricted_classified";
        else if (inputRarity === "Mil-Spec") result.type = "milspec_restricted";
        else result.type = inputRarity.toLowerCase();
      }
    }

    if (!result) {
      res.status(400).json({ error: "Could not evaluate trade-up. Output prices may be missing." });
      return;
    }

    // Compute additional stats
    const chanceToProfit = result.outcomes.reduce(
      (sum, o) => sum + (o.estimated_price_cents > result!.total_cost_cents ? o.probability : 0),
      0
    );
    const bestCase = result.outcomes.length > 0
      ? Math.max(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents
      : -result.total_cost_cents;
    const worstCase = result.outcomes.length > 0
      ? Math.min(...result.outcomes.map(o => o.estimated_price_cents)) - result.total_cost_cents
      : -result.total_cost_cents;

    res.json({
      trade_up: result,
      stats: {
        chance_to_profit: chanceToProfit,
        best_case_cents: bestCase,
        worst_case_cents: worstCase,
      },
    });
  });

  return router;
}
