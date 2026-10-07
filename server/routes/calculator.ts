import { Router } from "express";
import pg from "pg";
import { cachedRoute } from "../redis.js";
import {
  ensureRequestPriceCache,
  evaluateTradeUp,
  evaluateKnifeTradeUp,
  buildKnifeFinishCache,
  getOutcomesForCollections,
  getNextRarity,
  computeChanceToProfit,
  computeBestWorstCase,
  runWithRequestCachePolicy,
} from "../engine.js";
import type { ListingWithCollection, DbSkinOutcome } from "../engine/types.js";
import { isPositiveIntegerCents } from "../../shared/calculator-example.js";
import { resolveCalculatorExample } from "./calculator-example.js";

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

export function calculatorRouter(pool: pg.Pool): Router {
  const router = Router();

  router.get("/api/calculator/example", async (_req, res) => {
    const example = await resolveCalculatorExample(pool);
    if (!example) {
      res.status(404).json({ error: "No example contract is available" });
      return;
    }
    res.json(example);
  });

  // --- Skin search autocomplete ---
  router.get("/api/calculator/search", cachedRoute((req) => req.query.q ? `calc_search:v2:${req.query.q}` : null, 300, async (req, res) => {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const pattern = `%${q}%`;
    const { rows: results } = await pool.query(`
      SELECT s.name, s.weapon, s.rarity, s.min_float, s.max_float, c.name as collection_name,
        MIN(CASE WHEN s.name LIKE $2 THEN 0 ELSE 1 END) as prefix_rank
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      JOIN collections c ON sc.collection_id = c.id
      WHERE s.name LIKE $1 AND s.stattrak = false
      GROUP BY s.name, s.weapon, s.rarity, s.min_float, s.max_float, c.name
      ORDER BY prefix_rank, s.rarity DESC, s.name ASC
      LIMIT 20
    `, [pattern, `${q}%`]);

    // Cheapest buy-now row per name. Price and float come from that one listing.
    const names = results.map((r: { name: string }) => r.name);
    const floors = new Map<string, { price: number; floatValue: number }>();
    if (names.length > 0) {
      const { rows: cheapest } = await pool.query(`
        SELECT DISTINCT ON (name)
          name,
          price_cents AS floor_price,
          float_value AS floor_float
        FROM (
          SELECT s.name, l.price_cents, l.float_value, l.id
          FROM listings l
          JOIN skins s ON l.skin_id = s.id
          WHERE s.name = ANY($1::text[])
            AND s.stattrak = false
            AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
            AND l.float_value IS NOT NULL
            AND l.price_cents > 0
        ) candidates
        ORDER BY name, price_cents, id
      `, [names]);
      for (const row of cheapest) {
        const price = Number(row.floor_price);
        const floatValue = Number(row.floor_float);
        if (!isPositiveIntegerCents(price) || !Number.isFinite(floatValue)) continue;
        floors.set(String(row.name), { price, floatValue });
      }
    }

    const withFloor = [];
    for (const r of results) {
      const floor = floors.get(r.name);
      withFloor.push({
        ...r,
        floor_price_cents: floor?.price ?? null,
        floor_float: floor?.floatValue ?? null,
      });
    }

    res.json({ results: withFloor });
  }));

  // --- Calculator evaluation ---
  router.post("/api/calculator", async (req, res) => {
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
    const resolvedInputs: (ListingWithCollection & { _inputIndex: number })[] = [];
    const errors: string[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (!inp.skinName || inp.floatValue === undefined || inp.priceCents === undefined) {
        errors.push(`Input ${i + 1}: skinName, floatValue, and priceCents are required`);
        continue;
      }
      if (!isPositiveIntegerCents(inp.priceCents)) {
        errors.push(`Input ${i + 1}: priceCents must be a positive integer`);
        continue;
      }

      const { rows: [skin] } = await pool.query(`
        SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
               sc.collection_id, c.name as collection_name
        FROM skins s
        JOIN skin_collections sc ON s.id = sc.skin_id
        JOIN collections c ON sc.collection_id = c.id
        WHERE s.name = $1 AND s.stattrak = false
        LIMIT 1
      `, [inp.skinName]);

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
        stattrak: false,
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

    // Price cache is stale-while-revalidate only on this request. KNN and the
    // float ceiling, which lookupOutputPrice reads next, follow the same policy.
    try {
    await runWithRequestCachePolicy(async () => {
      await ensureRequestPriceCache(pool);

      // Strip the helper field before passing to engine
      const engineInputs: ListingWithCollection[] = resolvedInputs.map(({ _inputIndex, ...rest }) => rest);

      let result;

      if (isKnifeTradeUp) {
        // Build knife finish cache
        const knifeFinishCache = await buildKnifeFinishCache(pool);

        result = await evaluateKnifeTradeUp(pool, engineInputs, knifeFinishCache);
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
        const outcomes: DbSkinOutcome[] = await getOutcomesForCollections(pool, collectionIds, outputRarity);
        if (outcomes.length === 0) {
          res.status(400).json({ error: `No ${outputRarity} outcomes found for the input collections` });
          return;
        }

        result = await evaluateTradeUp(pool, engineInputs, outcomes);

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
      const chanceToProfit = computeChanceToProfit(result.outcomes, result.total_cost_cents);
      const { bestCase, worstCase } = computeBestWorstCase(result.outcomes, result.total_cost_cents);

      res.json({
        trade_up: result,
        stats: {
          chance_to_profit: chanceToProfit,
          best_case_cents: bestCase,
          worst_case_cents: worstCase,
        },
      });
    });
    } catch (err) {
      console.error("[calculator] evaluation failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  return router;
}
