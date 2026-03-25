// Output curve classification: staircase / smooth / flat.
// Drives exploration strategy — staircase → cost-minimize, smooth → float-optimize.

import pg from "pg";

// Float boundaries must match CONDITION_BOUNDS in server/engine/types.ts:
// FN: 0.00-0.07, MW: 0.07-0.15, FT: 0.15-0.38, WW: 0.38-0.45, BS: 0.45-1.00

/** Per-condition price statistics for a single skin. */
export interface CurveData {
  fnAvg: number; fnStd: number; fnCount: number;
  mwAvg: number; mwStd: number; mwCount: number;
  ftAvg: number; ftStd: number; ftCount: number;
  wwAvg: number; wwStd: number; wwCount: number;
  bsAvg: number; bsStd: number; bsCount: number;
}

/** Classification scores for a skin's price curve. */
export interface CurveScore {
  conditionRatio: number;     // max(avg) / min(avg) across valid conditions
  intraConditionCV: number;   // mean CV (std/avg * 100) within conditions
}

/** Output skin with its probability and estimated price for combo scoring. */
export interface ComboOutcome {
  skinName: string;
  probability: number;
  estimatedPrice: number;
}

const MIN_OBS_PER_CONDITION = 5;
const MIN_CONDITIONS = 2;

/**
 * Classify a skin's price curve from per-condition stats.
 * Returns null if insufficient data (< 2 conditions with >= 5 observations and avg > 0).
 */
export function classifySkinCurve(data: CurveData): CurveScore | null {
  const conditions = [
    { avg: data.fnAvg, std: data.fnStd, count: data.fnCount },
    { avg: data.mwAvg, std: data.mwStd, count: data.mwCount },
    { avg: data.ftAvg, std: data.ftStd, count: data.ftCount },
    { avg: data.wwAvg, std: data.wwStd, count: data.wwCount },
    { avg: data.bsAvg, std: data.bsStd, count: data.bsCount },
  ];

  // Filter: >= MIN_OBS_PER_CONDITION observations AND avg > 0
  const valid = conditions.filter(c => c.count >= MIN_OBS_PER_CONDITION && c.avg > 0);
  if (valid.length < MIN_CONDITIONS) return null;

  const avgs = valid.map(c => c.avg);
  const conditionRatio = Math.max(...avgs) / Math.min(...avgs);

  const cvs = valid.map(c => (c.std / c.avg) * 100);
  const intraConditionCV = cvs.reduce((sum, cv) => sum + cv, 0) / cvs.length;

  return { conditionRatio, intraConditionCV };
}

// Module-level cache: skinName → CurveScore
export const curveCache = new Map<string, CurveScore>();
let curveCacheBuiltAt = 0;
const CURVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Build curve cache from price_observations. Returns number of skins cached. */
export async function buildCurveCache(pool: pg.Pool): Promise<number> {
  if (curveCacheBuiltAt > 0 && Date.now() - curveCacheBuiltAt < CURVE_CACHE_TTL_MS) {
    return curveCache.size;
  }

  curveCache.clear();

  // Float boundaries match CONDITION_BOUNDS in server/engine/types.ts
  const { rows } = await pool.query(`
    SELECT skin_name,
      AVG(CASE WHEN float_value < 0.07 THEN price_cents END) as fn_avg,
      STDDEV(CASE WHEN float_value < 0.07 THEN price_cents END) as fn_std,
      COUNT(*) FILTER (WHERE float_value < 0.07) as fn_cnt,
      AVG(CASE WHEN float_value >= 0.07 AND float_value < 0.15 THEN price_cents END) as mw_avg,
      STDDEV(CASE WHEN float_value >= 0.07 AND float_value < 0.15 THEN price_cents END) as mw_std,
      COUNT(*) FILTER (WHERE float_value >= 0.07 AND float_value < 0.15) as mw_cnt,
      AVG(CASE WHEN float_value >= 0.15 AND float_value < 0.38 THEN price_cents END) as ft_avg,
      STDDEV(CASE WHEN float_value >= 0.15 AND float_value < 0.38 THEN price_cents END) as ft_std,
      COUNT(*) FILTER (WHERE float_value >= 0.15 AND float_value < 0.38) as ft_cnt,
      AVG(CASE WHEN float_value >= 0.38 AND float_value < 0.45 THEN price_cents END) as ww_avg,
      STDDEV(CASE WHEN float_value >= 0.38 AND float_value < 0.45 THEN price_cents END) as ww_std,
      COUNT(*) FILTER (WHERE float_value >= 0.38 AND float_value < 0.45) as ww_cnt,
      AVG(CASE WHEN float_value >= 0.45 THEN price_cents END) as bs_avg,
      STDDEV(CASE WHEN float_value >= 0.45 THEN price_cents END) as bs_std,
      COUNT(*) FILTER (WHERE float_value >= 0.45) as bs_cnt
    FROM price_observations
    WHERE source IN ('sale', 'buff_sale', 'skinport_sale')
    GROUP BY skin_name
    HAVING COUNT(*) >= 10
  `);

  for (const row of rows) {
    const data: CurveData = {
      fnAvg: Number(row.fn_avg) || 0,
      fnStd: Number(row.fn_std) || 0,
      fnCount: Number(row.fn_cnt) || 0,
      mwAvg: Number(row.mw_avg) || 0,
      mwStd: Number(row.mw_std) || 0,
      mwCount: Number(row.mw_cnt) || 0,
      ftAvg: Number(row.ft_avg) || 0,
      ftStd: Number(row.ft_std) || 0,
      ftCount: Number(row.ft_cnt) || 0,
      wwAvg: Number(row.ww_avg) || 0,
      wwStd: Number(row.ww_std) || 0,
      wwCount: Number(row.ww_cnt) || 0,
      bsAvg: Number(row.bs_avg) || 0,
      bsStd: Number(row.bs_std) || 0,
      bsCount: Number(row.bs_cnt) || 0,
    };

    const score = classifySkinCurve(data);
    if (score) {
      curveCache.set(row.skin_name, score);
    }
  }

  curveCacheBuiltAt = Date.now();
  console.log(`  Curve cache: ${curveCache.size} skins classified`);
  return curveCache.size;
}

/**
 * EV-weighted average curve score across trade-up output outcomes.
 * Weight = probability * estimatedPrice (higher-EV outcomes matter more).
 * Returns null if no outcomes have cached curve data.
 */
export function comboCurveScore(outcomes: ComboOutcome[]): CurveScore | null {
  let totalWeight = 0;
  let weightedRatio = 0;
  let weightedCV = 0;

  for (const o of outcomes) {
    const cached = curveCache.get(o.skinName);
    if (!cached) continue;

    const weight = o.probability * o.estimatedPrice;
    totalWeight += weight;
    weightedRatio += weight * cached.conditionRatio;
    weightedCV += weight * cached.intraConditionCV;
  }

  if (totalWeight === 0) return null;

  return {
    conditionRatio: weightedRatio / totalWeight,
    intraConditionCV: weightedCV / totalWeight,
  };
}

/**
 * Strategy gate: should this trade-up use value-ratio (float-optimized) selection?
 * - true: intraConditionCV > 30 → float precision pays off (smooth curves like gloves)
 * - false: cost-minimize (staircase/flat curves)
 * - null: insufficient data → use default balanced approach
 */
export function shouldUseValueRatio(score: CurveScore | null): boolean | null {
  if (score === null) return null;
  return score.intraConditionCV > 30;
}
