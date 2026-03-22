import pg from "pg";
import { getSyncMeta } from "../db.js";
import { CASE_KNIFE_MAP } from "../engine.js";
import type { SyncStatus } from "../../shared/types.js";

export async function buildStatusData(pool: pg.Pool): Promise<SyncStatus> {
  const listingStats = async (rarity: string, excludeKnives = false) => {
    const knifeFilter = excludeKnives ? "AND s.name NOT LIKE '★%'" : "";
    const knifeFilterNoAlias = excludeKnives ? "AND name NOT LIKE '★%'" : "";
    const [{ rows: [r] }, { rows: [totalRow] }] = await Promise.all([
      pool.query(`
        SELECT COUNT(l.id) as total_listings, COUNT(DISTINCT s.name) as skins_with_listings
        FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE s.rarity = $1 AND s.stattrak = false ${knifeFilter}
      `, [rarity]),
      pool.query(
        `SELECT COUNT(DISTINCT name) as c FROM skins WHERE rarity = $1 AND stattrak = false ${knifeFilterNoAlias}`,
        [rarity]
      ),
    ]);
    return { listings: parseInt(r.total_listings), skins: parseInt(r.skins_with_listings), total: parseInt(totalRow.c) };
  };

  const [classified, covert, covertPricesResult, tuStatsResult, knifeTu,
         topCollectionsResult, totalSkinsResult, totalListingsResult,
         knifeGloveSkinsResult, knifeGloveWithListingsResult, knifeGloveListingsResult,
         collectionCountResult] = await Promise.all([
    listingStats("Classified"),
    listingStats("Covert", true),
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_sales') as sale_prices,
        (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as ref_prices,
        (SELECT COUNT(*) FROM sale_history) as total_sales
    `),
    pool.query(`
      SELECT type,
        COUNT(*) as cnt,
        SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
      FROM trade_ups GROUP BY type
    `),
    (async () => {
      try {
        const { rows: [row] } = await pool.query(`
          SELECT COUNT(*) as cnt,
            SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable,
            SUM(CASE WHEN listing_status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN listing_status = 'partial' THEN 1 ELSE 0 END) as partial,
            SUM(CASE WHEN listing_status = 'stale' THEN 1 ELSE 0 END) as stale
          FROM trade_ups WHERE type = 'covert_knife' AND is_theoretical = false
        `);
        return {
          cnt: parseInt(row.cnt) || 0,
          profitable: parseInt(row.profitable) || 0,
          active: parseInt(row.active) || 0,
          partial: parseInt(row.partial) || 0,
          stale: parseInt(row.stale) || 0,
        };
      } catch { return { cnt: 0, profitable: 0, active: 0, partial: 0, stale: 0 }; }
    })(),
    pool.query(`
      SELECT collection_name, priority_score, profitable_count, avg_profit_cents
      FROM collection_scores ORDER BY priority_score DESC LIMIT 5
    `),
    pool.query("SELECT COUNT(DISTINCT name) as c FROM skins WHERE stattrak = false"),
    pool.query("SELECT COUNT(*) as c FROM listings"),
    pool.query("SELECT COUNT(DISTINCT name) as c FROM skins WHERE name LIKE '★%' AND stattrak = false"),
    pool.query("SELECT COUNT(DISTINCT s.name) as c FROM skins s JOIN listings l ON s.id = l.skin_id WHERE s.name LIKE '★%' AND s.stattrak = false"),
    pool.query("SELECT COUNT(*) as c FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name LIKE '★%' AND s.stattrak = false"),
    pool.query("SELECT COUNT(DISTINCT c.id) as c FROM collections c JOIN skin_collections sc ON c.id = sc.collection_id"),
  ]);

  const covertPrices = covertPricesResult.rows[0];
  const tuStats = tuStatsResult.rows;
  const topCollections = topCollectionsResult.rows;

  const covertTu = tuStats.find((r: any) => r.type === "classified_covert");
  const totalTu = tuStats.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const totalProfitable = tuStats.reduce((s: number, r: any) => s + parseInt(r.profitable), 0);

  return ({
    classified_listings: classified.listings,
    classified_skins: classified.skins,
    classified_total: classified.total,
    covert_listings: covert.listings,
    covert_skins: covert.skins,
    covert_total: covert.total,
    covert_sale_prices: parseInt(covertPrices.sale_prices),
    covert_ref_prices: parseInt(covertPrices.ref_prices),
    total_sales: parseInt(covertPrices.total_sales),
    knife_trade_ups: knifeTu?.cnt ?? 0,
    knife_profitable: knifeTu?.profitable ?? 0,
    knife_active: knifeTu?.active ?? 0,
    knife_partial: knifeTu?.partial ?? 0,
    knife_stale: knifeTu?.stale ?? 0,
    covert_trade_ups: covertTu ? parseInt(covertTu.cnt) : 0,
    covert_profitable: covertTu ? parseInt(covertTu.profitable) : 0,
    trade_ups_count: totalTu,
    profitable_count: totalProfitable,
    last_calculation: await getSyncMeta(pool, "last_calculation"),
    daemon_status: await (async () => {
      try {
        const raw = await getSyncMeta(pool, "daemon_status");
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
    exploration_stats: await (async () => {
      try {
        const raw = await getSyncMeta(pool, "exploration_stats");
        return raw ? JSON.parse(raw) : null;
      } catch { /* malformed JSON */ return null; }
    })(),
    ref_coverage: null,
    total_skins: parseInt(totalSkinsResult.rows[0].c),
    total_listings: parseInt(totalListingsResult.rows[0].c),
    knife_glove_skins: parseInt(knifeGloveSkinsResult.rows[0].c),
    knife_glove_with_listings: parseInt(knifeGloveWithListingsResult.rows[0].c),
    knife_glove_listings: parseInt(knifeGloveListingsResult.rows[0].c),
    collection_count: parseInt(collectionCountResult.rows[0].c),
    collections_with_knives: Object.keys(CASE_KNIFE_MAP).length,
  } satisfies SyncStatus);
}
