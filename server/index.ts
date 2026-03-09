import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, getSyncMeta } from "./db.js";
import { fullSync, syncListingsForRarity } from "./sync.js";
import { findProfitableTradeUps, saveTradeUps } from "./engine.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome, SyncStatus } from "../shared/types.js";

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = initDb();

// ─── GET /api/status ────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => {
  const listingStats = (rarity: string) => {
    const r = db.prepare(`
      SELECT COUNT(l.id) as total_listings, COUNT(DISTINCT l.skin_id) as skins_with_listings
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE s.rarity = ? AND s.stattrak = 0
    `).get(rarity) as { total_listings: number; skins_with_listings: number };
    const total = (db.prepare(
      "SELECT COUNT(*) as c FROM skins WHERE rarity = ? AND stattrak = 0"
    ).get(rarity) as { c: number }).c;
    return { listings: r.total_listings, skins: r.skins_with_listings, total };
  };

  const classified = listingStats("Classified");
  const covert = listingStats("Covert");

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

  const knifeTu = tuStats.find(r => r.type === "covert_knife");
  const covertTu = tuStats.find(r => r.type === "classified_covert");
  const totalTu = tuStats.reduce((s, r) => s + r.cnt, 0);
  const totalProfitable = tuStats.reduce((s, r) => s + r.profitable, 0);

  const topCollections = db.prepare(`
    SELECT collection_name, priority_score, profitable_count, avg_profit_cents
    FROM collection_scores ORDER BY priority_score DESC LIMIT 5
  `).all() as { collection_name: string; priority_score: number; profitable_count: number; avg_profit_cents: number }[];

  res.json({
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
    covert_trade_ups: covertTu?.cnt ?? 0,
    covert_profitable: covertTu?.profitable ?? 0,
    trade_ups_count: totalTu,
    profitable_count: totalProfitable,
    last_calculation: getSyncMeta(db, "last_calculation"),
    daemon_status: (() => {
      try {
        const raw = getSyncMeta(db, "daemon_status");
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    })(),
    top_collections: topCollections,
    exploration_stats: (() => {
      try {
        const raw = getSyncMeta(db, "exploration_stats");
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    })(),
  } satisfies SyncStatus);
});

// ─── GET /api/trade-ups ─────────────────────────────────────────────────────

app.get("/api/trade-ups", (req, res) => {
  const {
    sort = "profit",
    order = "desc",
    page = "1",
    per_page = "50",
    min_profit,
    min_roi,
    max_cost,
    min_chance,
    max_outcomes,
    skin,
    type,
    max_loss,
    min_win,
  } = req.query as Record<string, string>;

  const pageNum = parseInt(page);
  const perPage = Math.min(parseInt(per_page), 500);
  const offset = (pageNum - 1) * perPage;

  // Build query
  let where = "WHERE 1=1";
  const params: (string | number)[] = [];

  if (type) {
    where += " AND t.type = ?";
    params.push(type);
  }

  if (min_profit) {
    where += " AND t.profit_cents >= ?";
    params.push(parseInt(min_profit));
  }
  if (min_roi) {
    where += " AND t.roi_percentage >= ?";
    params.push(parseFloat(min_roi));
  }
  if (max_cost) {
    where += " AND t.total_cost_cents <= ?";
    params.push(parseInt(max_cost));
  }
  if (min_chance) {
    where += " AND t.chance_to_profit >= ?";
    params.push(parseFloat(min_chance) / 100);
  }

  // Skin name search (matches input or output skin names)
  if (skin) {
    where += ` AND t.id IN (
      SELECT trade_up_id FROM trade_up_inputs WHERE skin_name LIKE ?
      UNION
      SELECT trade_up_id FROM trade_up_outcomes WHERE skin_name LIKE ?
    )`;
    const pattern = `%${skin}%`;
    params.push(pattern, pattern);
  }

  // Max outcomes filter — needs a subquery
  if (max_outcomes) {
    where += ` AND (SELECT COUNT(*) FROM trade_up_outcomes WHERE trade_up_id = t.id) <= ?`;
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
      `SELECT t.* FROM trade_ups t ${where}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT ? OFFSET ?`
    )
    .all(...params, perPage, offset) as {
    id: number;
    total_cost_cents: number;
    expected_value_cents: number;
    profit_cents: number;
    roi_percentage: number;
    created_at: string;
  }[];

  // Load inputs and outcomes for each trade-up
  const getInputs = db.prepare("SELECT * FROM trade_up_inputs WHERE trade_up_id = ?");
  const getOutcomes = db.prepare("SELECT * FROM trade_up_outcomes WHERE trade_up_id = ?");

  const tradeUps: TradeUp[] = rows.map((row) => ({
    id: row.id,
    total_cost_cents: row.total_cost_cents,
    expected_value_cents: row.expected_value_cents,
    profit_cents: row.profit_cents,
    roi_percentage: row.roi_percentage,
    created_at: row.created_at,
    inputs: getInputs.all(row.id) as TradeUpInput[],
    outcomes: getOutcomes.all(row.id) as TradeUpOutcome[],
  }));

  res.json({ trade_ups: tradeUps, total, page: pageNum, per_page: perPage });
});

// ─── GET /api/trade-ups/:id ─────────────────────────────────────────────────

app.get("/api/trade-ups/:id", (req, res) => {
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
  const outcomes = db
    .prepare("SELECT * FROM trade_up_outcomes WHERE trade_up_id = ?")
    .all(row.id) as TradeUpOutcome[];

  res.json({ ...row, inputs, outcomes });
});

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Trade-Up Bot API running at http://localhost:${PORT}`);
});
