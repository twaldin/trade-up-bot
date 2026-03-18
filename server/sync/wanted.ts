
import pg from "pg";
import { getSyncMeta, setSyncMeta } from "../db.js";
import { syncListingsForSkin } from "./csfloat.js";

/**
 * Fetch listings for skins on the theory wanted list.
 * Each entry specifies a skin+float range that theory needs to test if the
 * trade-up is real. Deduplicates by skin, respects 2-hour cache per skin.
 */
export async function syncWantedListings(
  pool: pg.Pool,
  wanted: { skin_name: string; target_float: number; max_float: number; priority_score: number }[],
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number; skinsFetched: number }> {
  const maxCalls = options.maxCalls ?? 50;
  const rawFetchTimes = await getSyncMeta(pool, "wanted_fetch_times");
  const fetchTimes: Record<string, number> = rawFetchTimes ? JSON.parse(rawFetchTimes) : {};
  const now = Date.now();
  const SKIP_WINDOW = 30 * 60 * 1000; // 30 min — matches listing pool reset

  // Deduplicate by skin+condition, keep highest priority
  const bySkinCond = new Map<string, { skin_name: string; target_float: number; max_float: number; priority_score: number }>();
  for (const w of wanted) {
    const cond = w.target_float < 0.07 ? "FN" : w.target_float < 0.15 ? "MW" : w.target_float < 0.38 ? "FT" : w.target_float < 0.45 ? "WW" : "BS";
    const key = `${w.skin_name}:${cond}`;
    const existing = bySkinCond.get(key);
    if (!existing || w.priority_score > existing.priority_score) {
      bySkinCond.set(key, { skin_name: w.skin_name, target_float: w.target_float, max_float: w.max_float, priority_score: w.priority_score });
    }
  }

  // Sort by priority descending so we fetch the most impactful first
  const sorted = [...bySkinCond.entries()].sort((a, b) => b[1].priority_score - a[1].priority_score);

  let totalApiCalls = 0;
  let totalInserted = 0;
  let skinsFetched = 0;

  for (const [key, info] of sorted) {
    if (totalApiCalls >= maxCalls) break;
    if (fetchTimes[key] && (now - fetchTimes[key]) < SKIP_WINDOW) continue;
    const skinName = info.skin_name;

    const { rows } = await pool.query(
      "SELECT id, name, min_float, max_float FROM skins WHERE name = $1 AND stattrak = 0 LIMIT 1",
      [skinName]
    );
    const skin = rows[0] as { id: string; name: string; min_float: number; max_float: number } | undefined;
    if (!skin) continue;

    // Determine which conditions to fetch based on target float
    const targetCondition = info.target_float < 0.07 ? "Factory New"
      : info.target_float < 0.15 ? "Minimal Wear"
      : info.target_float < 0.38 ? "Field-Tested"
      : info.target_float < 0.45 ? "Well-Worn"
      : "Battle-Scarred";

    const conditions = [targetCondition];

    // For high-priority entries (near-miss boosted), use float filtering to get
    // specifically low-float listings that theory needs. Regular entries get all
    // listings in the condition. Threshold 150 = near-miss boost is active.
    const useFloatFilter = info.priority_score > 150;
    const filterStr = useFloatFilter ? ` float<${info.max_float.toFixed(2)}` : "";
    options.onProgress?.(`Wanted: ${skinName} [${targetCondition}${filterStr}] (score ${info.priority_score.toFixed(0)})`);

    try {
      const result = await syncListingsForSkin(pool, skin, {
        apiKey: options.apiKey,
        conditions,
        maxFloat: useFloatFilter ? info.max_float : undefined,
      });
      totalApiCalls += result.apiCalls;
      totalInserted += result.inserted;
      skinsFetched++;
      fetchTimes[key] = now;

      if (result.apiCalls === 0 && result.inserted === 0) continue;
    } catch (err: any) {
      if (err.message?.includes("429")) {
        console.log(`    Rate limited — stopping wanted fetch`);
        break;
      }
    }
  }

  try { await setSyncMeta(pool, "wanted_fetch_times", JSON.stringify(fetchTimes)); } catch { /* metadata persistence is best-effort */ }
  return { apiCalls: totalApiCalls, inserted: totalInserted, skinsFetched };
}
