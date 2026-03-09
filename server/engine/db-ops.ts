/**
 * Database persistence: save trade-ups, update collection scores.
 */

import Database from "better-sqlite3";
import { setSyncMeta } from "../db.js";
import type { TradeUp } from "../../shared/types.js";

export function saveTradeUps(db: Database.Database, tradeUps: TradeUp[], clearFirst: boolean = true, type: string = "classified_covert") {
  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOutcome = db.prepare(`
    INSERT INTO trade_up_outcomes (trade_up_id, skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    if (clearFirst) {
      db.exec(`DELETE FROM trade_up_outcomes WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = '${type}')`);
      db.exec(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE type = '${type}')`);
      db.exec(`DELETE FROM trade_ups WHERE type = '${type}'`);
    }

    for (const tu of tradeUps) {
      const chanceToProfit = tu.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
      );

      const bestCase = tu.outcomes.length > 0
        ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
      const worstCase = tu.outcomes.length > 0
        ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;

      const result = insertTradeUp.run(
        tu.total_cost_cents,
        tu.expected_value_cents,
        tu.profit_cents,
        tu.roi_percentage,
        chanceToProfit,
        type,
        bestCase,
        worstCase
      );
      const tradeUpId = result.lastInsertRowid;

      for (const input of tu.inputs) {
        insertInput.run(
          tradeUpId,
          input.listing_id,
          input.skin_id,
          input.skin_name,
          input.collection_name,
          input.price_cents,
          input.float_value,
          input.condition
        );
      }

      for (const outcome of tu.outcomes) {
        insertOutcome.run(
          tradeUpId,
          outcome.skin_id,
          outcome.skin_name,
          outcome.collection_name,
          outcome.probability,
          outcome.predicted_float,
          outcome.predicted_condition,
          outcome.estimated_price_cents
        );
      }
    }
  });

  saveAll();
  setSyncMeta(db, "last_calculation", new Date().toISOString());
}

export function saveKnifeTradeUps(db: Database.Database, tradeUps: TradeUp[]) {
  saveTradeUps(db, tradeUps, true, "covert_knife");
}

export function updateCollectionScores(db: Database.Database) {
  const scores = db.prepare(`
    SELECT
      tui.collection_name,
      COUNT(DISTINCT tu.id) as total_tradeups,
      SUM(CASE WHEN tu.profit_cents > 500 THEN 1 ELSE 0 END) as profitable_count,
      AVG(CASE WHEN tu.profit_cents > 0 THEN tu.profit_cents ELSE NULL END) as avg_profit,
      MAX(tu.profit_cents) as max_profit,
      AVG(CASE WHEN tu.profit_cents > 0 THEN tu.roi_percentage ELSE NULL END) as avg_roi
    FROM trade_ups tu
    JOIN trade_up_inputs tui ON tu.id = tui.trade_up_id
    GROUP BY tui.collection_name
  `).all() as {
    collection_name: string;
    total_tradeups: number;
    profitable_count: number;
    avg_profit: number | null;
    max_profit: number;
    avg_roi: number | null;
  }[];

  const colIdLookup = new Map<string, string>();
  const colRows = db.prepare("SELECT id, name FROM collections").all() as { id: string; name: string }[];
  for (const r of colRows) colIdLookup.set(r.name, r.id);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO collection_scores
      (collection_id, collection_name, profitable_count, avg_profit_cents, max_profit_cents, avg_roi, total_tradeups, priority_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateAll = db.transaction(() => {
    db.exec("DELETE FROM collection_scores");

    for (const s of scores) {
      const colId = colIdLookup.get(s.collection_name);
      if (!colId) continue;

      const profitableWeight = Math.min(s.profitable_count, 50);
      const avgProfitWeight = Math.min((s.avg_profit ?? 0) / 100, 50);
      const roiWeight = Math.min((s.avg_roi ?? 0) / 5, 20);
      const priorityScore = profitableWeight * 2 + avgProfitWeight + roiWeight;

      upsert.run(
        colId,
        s.collection_name,
        s.profitable_count,
        Math.round(s.avg_profit ?? 0),
        s.max_profit,
        Math.round((s.avg_roi ?? 0) * 100) / 100,
        s.total_tradeups,
        Math.round(priorityScore * 100) / 100
      );
    }
  });

  updateAll();
  console.log(`  Updated ${scores.length} collection scores`);
}
