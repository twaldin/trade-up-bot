/**
 * Cross-condition price multipliers for ★ skins, derived from SP median ratios.
 * Used to estimate a target condition price from an adjacent condition.
 * Only built when ≥10 ★ skins have SP data for both conditions.
 */
import pg from "pg";

// e.g. "Well-Worn→Field-Tested" → 3.2 (FT costs 3.2× WW for typical gloves)
export const conditionMultiplierCache = new Map<string, number>();

export async function buildConditionMultipliers(pool: pg.Pool): Promise<void> {
  conditionMultiplierCache.clear();

  const PAIRS: [string, string][] = [
    ["Well-Worn",     "Field-Tested"],
    ["Field-Tested",  "Minimal Wear"],
    ["Minimal Wear",  "Factory New"],
    ["Battle-Scarred","Well-Worn"],
    ["Field-Tested",  "Well-Worn"],    // reverse: WW from FT
    ["Minimal Wear",  "Field-Tested"], // reverse: FT from MW
  ];

  for (const [fromCond, toCond] of PAIRS) {
    const { rows } = await pool.query(`
      WITH ratios AS (
        SELECT a.median_price_cents::float / b.median_price_cents AS ratio
        FROM price_data a
        JOIN price_data b ON a.skin_name = b.skin_name
        WHERE a.condition = $1 AND b.condition = $2
          AND a.source = 'skinport' AND b.source = 'skinport'
          AND a.skin_name LIKE '★%'
          AND a.median_price_cents >= 100 AND b.median_price_cents >= 100
          AND a.median_price_cents::float / b.median_price_cents BETWEEN 0.1 AND 50
      )
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ratio) AS median_ratio,
             COUNT(*) AS n
      FROM ratios
    `, [toCond, fromCond]); // ratio = to / from

    const { median_ratio, n } = rows[0] ?? {};
    if (n >= 10 && median_ratio > 0) {
      conditionMultiplierCache.set(`${fromCond}→${toCond}`, Number(median_ratio));
    }
  }
  console.log(`  Condition multipliers: ${conditionMultiplierCache.size} pairs computed`);
}
