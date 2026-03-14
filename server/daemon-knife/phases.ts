/**
 * Daemon phase implementations.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 2: Theory (price cache + bootstrap + theory gen — pure computation, no API)
 * Phase 3: API Probe (rate limit detection)
 * Phase 4: Data Fetch (sale history, listings, theory-guided wanted list)
 * Phase 4.5: Verify profitable inputs (individual lookup pool)
 * Phase 5: Knife Calc (only if data changed)
 * Phase 6: Cooldown (staleness checks)
 * Phase 7: Re-materialization (re-check theories with updated data)
 */

import { initDb, setSyncMeta, emitEvent, purgeOldEvents } from "../db.js";
import {
  syncKnifeGloveSaleHistory,
  syncSaleHistory,
  syncClassifiedSaleHistory,
  syncStatTrakSaleHistory,
  syncPrioritizedKnifeInputs,
  syncSmartClassifiedListings,
  syncCovertOutputListings,
  purgeStaleListings,
  syncWantedListings,
  checkListingStaleness,
  syncDMarketListingsForRarity,
  syncDMarketListingsForSkin,
  isDMarketConfigured,
} from "../sync.js";
import {
  findProfitableKnifeTradeUps,
  findProfitableTradeUps,
  randomClassifiedExplore,
  saveTradeUps,
  saveKnifeTradeUps,
  saveClassifiedTradeUps,
  updateCollectionScores,
  buildPriceCache,
  bootstrapLearnedPrices,
  seedPriceObservations,
  seedKnifeSaleObservations,
  pruneObservations,
  snapshotListingsToObservations,
  getListingsForRarity,
  addAdjustedFloat,
  selectForFloatTarget,
  selectForFloatTargetFloatGreedy,
  selectLowestFloat,
  evaluateTradeUp,
  evaluateKnifeTradeUp,
  getOutcomesForCollections,
  getKnifeFinishesWithPrices,
  CASE_KNIFE_MAP,
  KNIFE_WEAPONS,
  GLOVE_GEN_SKINS,
} from "../engine.js";
import { type TradeUp, type Condition, floatToCondition } from "../../shared/types.js";
import type { AdjustedListing, ClassifiedTheory } from "../engine.js";
import type { FinishData } from "../engine.js";
import {
  generatePessimisticKnifeTheories,
  buildWantedList,
  saveTheoryTradeUps,
  theoryComboKey,
  type WantedListing,
  type PessimisticTheory,
  type NearMissInfo,
  generateClassifiedTheories,
  buildClassifiedWantedList,
  classifiedComboKey,
  saveClassifiedTheoryTradeUps,
  findStaircaseTradeUps,
  generateStaircaseTheories, saveStaircaseTheoryTradeUps,
  saveTheoryValidations,
  loadTheoryCooldowns,
  saveNearMissesToDb,
  cleanupTheoryTracking,
  refreshListingStatuses,
  purgeExpiredPreserved,
  getProfitableCombosForWantedList,
  reviveStaleTradeUps, reviveStaleClassifiedTradeUps,
  type TheoryValidationResult,
} from "../engine.js";

import { BudgetTracker, FreshnessTracker } from "./state.js";
import {
  timestamp, setDaemonStatus, updateExplorationStats,
  probeApiRateLimits,
  type RateLimitInfo, type ApiProbeResult,
} from "./utils.js";

export interface TheoryResult {
  generated: number;
  profitable: number;
  wantedList: WantedListing[];
  bestFloatTargets: number[];  // Normalized floats from top theories for discovery
  theories: PessimisticTheory[];  // Full theories for materialization in Phase 5
}

export interface KnifeCalcResult {
  total: number;
  profitable: number;
  topProfit: number;
  avgProfit: number;
  nearMisses: NearMissInfo[];  // Near-miss combos to boost next cycle's wanted list
}

export interface ClassifiedTheoryResult {
  generated: number;
  profitable: number;
  wantedList: WantedListing[];
  bestFloatTargets: number[];
  theories: ClassifiedTheory[];
}

export interface ClassifiedCalcResult {
  total: number;
  profitable: number;
  topProfit: number;
  avgProfit: number;
  nearMisses: NearMissInfo[];
}

interface MaterializeResult {
  attempted: number;
  found: number;
  profitable: number;
  tradeUps: TradeUp[];
  comparison: { combo: string; theoryProfit: number; realProfit: number; theoryCost: number; realCost: number }[];
  nearMisses: { combo: string; theoryProfit: number; realProfit: number; gap: number }[];
}

interface DeepScanResult {
  scanned: number;
  found: number;
  profitable: number;
  tradeUps: TradeUp[];
}

/**
 * Clear theory cooldowns for combos that discovery proves profitable.
 * Called after both Phase 5 materialization and Phase 7 re-materialization.
 */
export function clearDiscoveryProfitableCooldowns(db: ReturnType<typeof initDb>): number {
  // Get collection counts per profitable trade-up (need counts, not DISTINCT)
  const profitable = db.prepare(`
    SELECT t.id, i.collection_name, COUNT(*) as cnt
    FROM trade_ups t
    JOIN trade_up_inputs i ON t.id = i.trade_up_id
    WHERE t.is_theoretical = 0 AND t.profit_cents > 0
    GROUP BY t.id, i.collection_name
  `).all() as { id: number; collection_name: string; cnt: number }[];

  if (profitable.length === 0) return 0;

  // Build combo keys from profitable trade-ups
  const profitableComboKeys = new Set<string>();
  const byTradeUp = new Map<number, { collection_name: string; cnt: number }[]>();
  for (const row of profitable) {
    const list = byTradeUp.get(row.id) ?? [];
    list.push({ collection_name: row.collection_name, cnt: row.cnt });
    byTradeUp.set(row.id, list);
  }
  for (const [, cols] of byTradeUp) {
    const ck = cols.map(c => `${c.collection_name}:${c.cnt}`).sort().join("|");
    profitableComboKeys.add(ck);
  }

  // Only clear cooldowns — don't override accuracy-based status.
  // Discovery proving a combo profitable doesn't mean theory was accurate.
  const clearCooldown = db.prepare(`
    UPDATE theory_tracking
    SET cooldown_until = NULL, last_profitable_at = datetime('now')
    WHERE combo_key = ? AND cooldown_until IS NOT NULL
  `);
  let cleared = 0;
  for (const ck of profitableComboKeys) {
    const result = clearCooldown.run(ck);
    if (result.changes > 0) cleared++;
  }
  return cleared;
}

export async function phase1Housekeeping(db: ReturnType<typeof initDb>, cycleCount: number) {
  console.log(`\n[${timestamp()}] ── Phase 1: Housekeeping ──`);
  setDaemonStatus(db, "fetching", "Phase 1: Housekeeping");

  // Snapshot listings before purge so KNN keeps the data
  try {
    const snapped = snapshotListingsToObservations(db);
    if (snapped > 0) console.log(`  Snapshotted ${snapped} listings to observations`);
  } catch {}

  const purged = purgeStaleListings(db, 90);
  if (purged.deleted > 0) {
    console.log(`  Purged ${purged.deleted} stale listings (>90 days old)`);
  }

  // Aggressively purge old listings that were never staleness-checked.
  // CSFloat listings typically sell within 1-3 days. If we fetched a listing >3 days ago
  // and never verified it, it's almost certainly sold or delisted.
  const oldUnchecked = db.prepare(`
    DELETE FROM listings
    WHERE staleness_checked_at IS NULL
      AND julianday('now') - julianday(created_at) > 3
  `).run();
  if (oldUnchecked.changes > 0) {
    console.log(`  Purged ${oldUnchecked.changes} old unchecked listings (>3 days, never verified)`);
  }

  // Purge DMarket listings older than 24h (no staleness checker for DMarket)
  const dmPurged = db.prepare(`
    DELETE FROM listings WHERE source = 'dmarket'
      AND julianday('now') - julianday(created_at) > 1
  `).run();
  if (dmPurged.changes > 0) {
    console.log(`  Purged ${dmPurged.changes} DMarket listings (>24h old)`);
  }

  // Prune observations every 10 cycles
  if (cycleCount % 10 === 0) {
    try {
      const pruned = pruneObservations(db);
      if (pruned > 0) console.log(`  Pruned ${pruned} old price observations`);
    } catch {}
  }

  // Purge old daemon events
  purgeOldEvents(db, 6);

  // Clean old theory tracking entries
  cleanupTheoryTracking(db);

  // Clean corrupt trade-ups (0 EV or 0 cost)
  const cleaned = db.prepare(`
    DELETE FROM trade_ups WHERE expected_value_cents = 0 OR total_cost_cents = 0
  `).run();
  if (cleaned.changes > 0) {
    console.log(`  Cleaned ${cleaned.changes} corrupt trade-ups`);
  }

  // Refresh listing statuses (marks partial/stale trade-ups)
  const lsResult = refreshListingStatuses(db);
  if (lsResult.partial > 0 || lsResult.stale > 0) {
    console.log(`  Listing status: ${lsResult.active} active, ${lsResult.partial} partial, ${lsResult.stale} stale (${lsResult.preserved} preserved)`);
  }

  // Purge trade-ups preserved >7 days
  const purgedPreserved = purgeExpiredPreserved(db, 7);
  if (purgedPreserved > 0) {
    console.log(`  Purged ${purgedPreserved} expired preserved trade-ups (>7 days)`);
  }
}

export function phase2Theory(db: ReturnType<typeof initDb>, cycleCount: number, previousNearMisses?: NearMissInfo[]): TheoryResult {
  console.log(`\n[${timestamp()}] ── Phase 2: Theory (computation only) ──`);
  setDaemonStatus(db, "calculating", "Phase 2: Price cache + theory");

  // 2a: Build price cache
  buildPriceCache(db, true);

  // 2b: Bootstrap float pricing data (seeds from existing listings, no API)
  const seeded = seedPriceObservations(db);
  if (seeded > 0) console.log(`  Seeded ${seeded} price observations`);

  const knifeSeeded = seedKnifeSaleObservations(db);
  if (knifeSeeded > 0) console.log(`  Seeded ${knifeSeeded} knife/glove observations`);

  const bootstrapped = bootstrapLearnedPrices(db);
  if (bootstrapped > 0) console.log(`  Bootstrapped ${bootstrapped} learned prices`);

  // 2c: Load cooldowns from previous validation results
  const cooldownMap = loadTheoryCooldowns(db);
  if (cooldownMap.size > 0) {
    console.log(`  Loaded ${cooldownMap.size} theory cooldowns (recently invalidated combos will be skipped)`);
  }

  // 2d: Generate theories using float-aware pricing, respecting cooldowns
  setDaemonStatus(db, "calculating", "Phase 2: Generating theories");
  const theories = generatePessimisticKnifeTheories(db, {
    onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    maxTheories: 5000,
    minRoiThreshold: -100,
    cooldownMap,
  });

  // 2d: Build wanted list from ALL theories (including near-misses)
  // Near-miss combos need data too — they might become profitable with better pricing
  const wantedList = buildWantedList(theories, previousNearMisses);
  if (previousNearMisses && previousNearMisses.length > 0) {
    console.log(`  Near-miss boost: ${previousNearMisses.length} combos from last cycle boosting wanted list`);
    for (const nm of previousNearMisses.slice(0, 3)) {
      const colShort = nm.combo.replace(/The /g, "").replace(/ Collection/g, "");
      console.log(`    ${colShort}: need $${(nm.gap / 100).toFixed(2)} cheaper → boost ${Math.round(1000 / Math.max(nm.gap / 100, 1))}`);
    }
  }

  // 2d.2: Boost wanted list with historically profitable combos
  // Combos that were profitable in the past week get massive priority — we want fresh data to check if they're still viable
  const profitableHistory = getProfitableCombosForWantedList(db);
  if (profitableHistory.length > 0) {
    let boosted = 0;
    for (const pc of profitableHistory) {
      // Parse input recipe to extract skin names + conditions
      const parts = pc.input_recipe.split(";").filter(Boolean);
      for (const part of parts) {
        const [skinName, , ] = part.split("|");
        if (!skinName) continue;
        // Find and boost matching wanted list entries
        const match = wantedList.find(w => w.skin_name === skinName);
        if (match) {
          const boost = Math.min(200, Math.round(pc.best_profit / 10)); // $11 profit → 110 boost
          match.priority_score += boost;
          boosted++;
        }
      }
    }
    if (boosted > 0) {
      console.log(`  Profitable history boost: ${profitableHistory.length} combos, ${boosted} wanted entries boosted`);
      // Re-sort wanted list by updated priority
      wantedList.sort((a, b) => b.priority_score - a.priority_score);
    }
  }

  // 2e: Save all theories to DB (profitable + near-miss for UI display)
  if (theories.length > 0) {
    saveTheoryTradeUps(db, theories);
    console.log(`  Saved ${theories.length} theories to DB (${theories.filter(t => t.profitCents > 0).length} profitable)`);
  } else {
    saveTheoryTradeUps(db, []);
  }

  if (wantedList.length > 0) {
    console.log(`  Wanted list: ${wantedList.length} input skins to fetch`);
    for (const w of wantedList.slice(0, 5)) {
      console.log(`    ${w.skin_name} @ <${w.max_float.toFixed(2)} (score ${w.priority_score.toFixed(0)})`);
    }
  }

  // Extract unique float targets from profitable theories for discovery
  const profitableTheories = theories.filter(t => t.profitCents > 0);
  const bestFloatTargets = [...new Set(profitableTheories.map(t => t.adjustedFloat))].sort((a, b) => a - b);
  if (bestFloatTargets.length > 0) {
    console.log(`  Theory float targets for discovery: ${bestFloatTargets.length} unique (${bestFloatTargets.slice(0, 5).map(f => f.toFixed(3)).join(", ")}${bestFloatTargets.length > 5 ? "..." : ""})`);
  }

  return { generated: theories.length, profitable: profitableTheories.length, wantedList, bestFloatTargets, theories };
}

export async function phase3ApiProbe(
  db: ReturnType<typeof initDb>,
  budget: BudgetTracker,
  apiKey: string
): Promise<ApiProbeResult> {
  console.log(`\n[${timestamp()}] ── Phase 3: API Probe ──`);
  setDaemonStatus(db, "fetching", "Phase 3: API probe (3 endpoints)");

  const probe = await probeApiRateLimits(apiKey);

  // Log each endpoint's status
  const fmtReset = (rl: RateLimitInfo) =>
    rl.resetAt ? ` (resets in ${Math.max(0, Math.round((rl.resetAt * 1000 - Date.now()) / 1000))}s)` : "";
  const fmtRemaining = (rl: RateLimitInfo) =>
    rl.remaining !== null ? `${rl.remaining}/${rl.limit}` : "unknown";

  const listingStatus = probe.listingSearch.available
    ? `OK (${fmtRemaining(probe.listingSearch.rateLimit)})`
    : `429${fmtReset(probe.listingSearch.rateLimit)}`;
  const saleStatus = probe.saleHistory.available
    ? `OK (${fmtRemaining(probe.saleHistory.rateLimit)})`
    : `429${fmtReset(probe.saleHistory.rateLimit)}`;
  const individualStatus = probe.individualListing.available
    ? `OK (${fmtRemaining(probe.individualListing.rateLimit)})`
    : `429${fmtReset(probe.individualListing.rateLimit)}`;

  console.log(`  Listing search:    ${listingStatus}`);
  console.log(`  Sale history:      ${saleStatus}`);
  console.log(`  Individual lookup: ${individualStatus}`);

  // Feed pool info into budget tracker for pacing
  const lrl = probe.listingSearch.rateLimit;
  const srl = probe.saleHistory.rateLimit;
  budget.setListingPool(
    probe.listingSearch.available ? (lrl.remaining ?? 200) : 0,
    lrl.resetAt,
    lrl.limit
  );
  budget.setSalePool(
    probe.saleHistory.available ? (srl.remaining ?? 500) : 0,
    srl.resetAt
  );
  const irl = probe.individualListing.rateLimit;
  budget.setIndividualPool(
    probe.individualListing.available ? (irl.remaining ?? 50000) : 0,
    irl.resetAt
  );

  // Log pacing info (with safety buffer awareness)
  const cycleBudget = budget.cycleListingBudget();
  if (probe.listingSearch.available && budget.listingRemaining > 0) {
    const resetIn = lrl.resetAt ? Math.max(0, Math.round(lrl.resetAt - Date.now() / 1000)) : null;
    console.log(`  Pacing: ${cycleBudget}/${budget.listingUsable} usable listing calls this cycle (${budget.listingRemaining} remaining, ${budget.listingSafetyBuffer} safety buffer)${resetIn ? ` (resets in ${resetIn}s)` : ""}`);
  }
  if (probe.saleHistory.available && budget.saleRemaining > 0) {
    const cycleSB = budget.cycleSaleBudget();
    console.log(`  Pacing: ${cycleSB}/${budget.saleUsable} usable sale calls this cycle (${budget.saleRemaining} remaining, ${budget.saleSafetyBuffer} safety buffer)`);
  }
  if (probe.individualListing.available && budget.individualRemaining > 0) {
    const cycleIB = budget.cycleIndividualBudget();
    console.log(`  Pacing: ${cycleIB}/${budget.individualUsable} usable individual calls this cycle (${budget.individualRemaining} remaining, ${budget.individualSafetyBuffer} safety buffer)`);
  }

  // Track probe costs (after setListingPool since that resets counters)
  if (probe.listingSearch.available) budget.useListing(1);
  if (probe.saleHistory.available) budget.useSale(1);

  // Check minimum remaining — mark limited if we'd eat into safety buffer
  if (probe.listingSearch.available) {
    const remaining = probe.listingSearch.rateLimit.remaining ?? 200;
    if (remaining <= budget.listingSafetyBuffer) {
      console.log(`  Listing search at safety buffer (${remaining} <= ${budget.listingSafetyBuffer}) — pausing to avoid 12h lockout`);
      budget.markListingRateLimited();
    }
  } else {
    budget.markListingRateLimited();
  }

  if (!probe.saleHistory.available) {
    budget.markSaleRateLimited();
  }

  // Store for status endpoint (includes reset timestamps + pacing for frontend)
  // Known pool limits and windows (429 responses return generic headers across all pools)
  const KNOWN_LISTING_LIMIT = 200;
  const KNOWN_SALE_LIMIT = 500;
  const KNOWN_INDIVIDUAL_LIMIT = 50000;
  // When 429'd, all pools share the same ~12h reset (verified 2026-03-12).
  // The 200/30min listing window is rolling replenishment, not the 429 recovery window.
  const KNOWN_LISTING_WINDOW_S = 12 * 3600;   // ~12h (same as others when 429'd)
  const KNOWN_SALE_WINDOW_S = 12 * 3600;      // ~12h
  const KNOWN_INDIVIDUAL_WINDOW_S = 12 * 3600; // ~12h

  // When 429'd, CSFloat returns the same generic reset timestamp for all pools.
  // Cap each pool's reset_at to its known window so the frontend shows accurate countdowns.
  const nowS = Date.now() / 1000;
  const capResetAt = (raw: number | null, windowS: number): number | null => {
    if (!raw) return null;
    const maxReset = nowS + windowS;
    return raw > maxReset ? maxReset : raw;
  };

  const cycleLB = budget.cycleListingBudget();
  const cycleSB2 = budget.cycleSaleBudget();
  const cycleIB = budget.cycleIndividualBudget();
  setSyncMeta(db, "api_rate_limit", JSON.stringify({
    listing_search: {
      limit: KNOWN_LISTING_LIMIT,
      remaining: probe.listingSearch.available ? (lrl.remaining ?? null) : 0,
      reset_at: capResetAt(lrl.resetAt, KNOWN_LISTING_WINDOW_S),
      available: probe.listingSearch.available,
      cycle_budget: cycleLB,
      safety_buffer: budget.listingSafetyBuffer,
    },
    sale_history: {
      limit: KNOWN_SALE_LIMIT,
      remaining: probe.saleHistory.available ? (srl.remaining ?? null) : 0,
      reset_at: capResetAt(srl.resetAt, KNOWN_SALE_WINDOW_S),
      available: probe.saleHistory.available,
      cycle_budget: cycleSB2,
      safety_buffer: budget.saleSafetyBuffer,
    },
    individual: {
      limit: KNOWN_INDIVIDUAL_LIMIT,
      remaining: probe.individualListing.available ? (probe.individualListing.rateLimit.remaining ?? null) : 0,
      reset_at: capResetAt(probe.individualListing.rateLimit.resetAt, KNOWN_INDIVIDUAL_WINDOW_S),
      available: probe.individualListing.available,
      cycle_budget: cycleIB,
      safety_buffer: budget.individualSafetyBuffer,
    },
    detected_at: new Date().toISOString(),
  }));

  return probe;
}

export async function phase4DataFetch(
  db: ReturnType<typeof initDb>,
  budget: BudgetTracker,
  freshness: FreshnessTracker,
  apiKey: string,
  wantedList: WantedListing[],
  probe: ApiProbeResult
) {
  console.log(`\n[${timestamp()}] ── Phase 4: Data Fetch ──`);
  setDaemonStatus(db, "fetching", "Phase 4: Data Fetch");
  emitEvent(db, "phase", "Phase 4: Data Fetch");

  const listingsAvailable = probe.listingSearch.available && !budget.isListingRateLimited();
  const salesAvailable = probe.saleHistory.available && !budget.isSaleRateLimited();

  if (!listingsAvailable && !salesAvailable) {
    console.log(`  Both listing search and sale history are rate limited — skipping fetch`);
    return;
  }

  // 4a: Sale history (500/~12h window — independent from listing search)
  // Budget: paced across cycles. Each cycle gets a proportional slice.
  if (salesAvailable) {
    const cycleSaleBudget = budget.cycleSaleBudget();
    console.log(`  [${timestamp()}] 4a: Sale history (${budget.saleRemaining} remaining, ${cycleSaleBudget} this cycle)`);

    // Split cycle budget: 55% knife/gloves, 15% covert guns, 15% classified, 15% ST coverts
    // Sale pool is 500/12h — each cycle gets a paced fraction. Don't overdraw.
    setDaemonStatus(db, "fetching", "Phase 4a: Knife/Glove sale history");
    const knifeSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.55)));
    if (knifeSaleBudget >= 2) {
      try {
        const result = await syncKnifeGloveSaleHistory(db, {
          apiKey,
          maxCalls: knifeSaleBudget,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Knife sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) emitEvent(db, "sale_history", `Knife/glove: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Knife sales: rate limited, moving on`);
        else console.error(`    Knife sales error: ${(err as Error).message}`);
      }
    }

    // Covert gun sale history
    setDaemonStatus(db, "fetching", "Phase 4a: Covert gun sale history");
    const covertSaleBudget = Math.min(budget.saleRemaining, Math.max(1, Math.floor(cycleSaleBudget * 0.15)));
    if (covertSaleBudget >= 1) {
      try {
        const result = await syncSaleHistory(db, {
          apiKey,
          maxCalls: covertSaleBudget,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Covert sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) emitEvent(db, "sale_history", `Covert guns: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Covert sales: rate limited, moving on`);
        else console.error(`    Covert sales error: ${(err as Error).message}`);
      }
    }

    // StatTrak Covert sale history (ST output pricing — was missing entirely)
    setDaemonStatus(db, "fetching", "Phase 4a: StatTrak Covert sale history");
    const stCovertSaleBudget = Math.min(budget.saleRemaining, Math.max(1, Math.floor(cycleSaleBudget * 0.15)));
    if (stCovertSaleBudget >= 1) {
      try {
        const result = await syncStatTrakSaleHistory(db, {
          apiKey,
          maxCalls: stCovertSaleBudget,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    ST Covert sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) emitEvent(db, "sale_history", `ST Covert: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    ST Covert sales: rate limited, moving on`);
        else console.error(`    ST Covert sales error: ${(err as Error).message}`);
      }
    }

    // Classified skin sale history (needed for KNN pricing of classified inputs)
    setDaemonStatus(db, "fetching", "Phase 4a: Classified sale history");
    const classifiedSaleBudget = Math.min(budget.saleRemaining, Math.max(1, Math.floor(cycleSaleBudget * 0.15)));
    if (classifiedSaleBudget >= 1) {
      try {
        const result = await syncClassifiedSaleHistory(db, {
          apiKey,
          maxCalls: classifiedSaleBudget,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Classified sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) emitEvent(db, "sale_history", `Classified: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Classified sales: rate limited, moving on`);
        else console.error(`    Classified sales error: ${(err as Error).message}`);
      }
    }
  } else {
    console.log(`  [${timestamp()}] 4a: Sale history — rate limited, skipping`);
  }

  // 4b: Listing search (200/~30min window — paced across cycles)
  if (listingsAvailable) {
    const listingBudget = budget.cycleListingBudget();
    console.log(`  [${timestamp()}] 4b: Listing search (${budget.listingRemaining} remaining, ${listingBudget} this cycle)`);

    // Budget allocation: when tight (<30), ALL goes to unified wanted list.
    // When normal (30+): 25% knife inputs, 20% classified inputs, 15% outputs, 40% wanted list.
    let knifeInputCalls: number, classifiedInputCalls: number, outputCalls: number, wantedCalls: number;
    if (listingBudget < 30) {
      knifeInputCalls = 0; classifiedInputCalls = 0; outputCalls = 0;
      wantedCalls = listingBudget;
    } else {
      wantedCalls = Math.min(wantedList.length, Math.floor(listingBudget * 0.40));
      knifeInputCalls = Math.floor(listingBudget * 0.25);
      classifiedInputCalls = Math.floor(listingBudget * 0.20);
      outputCalls = listingBudget - wantedCalls - knifeInputCalls - classifiedInputCalls;
      console.log(`    Budget: ${knifeInputCalls} knife in + ${classifiedInputCalls} classified in + ${outputCalls} output + ${wantedCalls} wanted = ${listingBudget}`);
    }

    // Prioritized knife inputs (Covert gun skins)
    setDaemonStatus(db, "fetching", "Phase 4b: Prioritized knife inputs");
    if (knifeInputCalls >= 5) {
      try {
        const result = await syncPrioritizedKnifeInputs(db, {
          apiKey,
          maxCalls: knifeInputCalls,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Knife inputs: ${result.apiCalls} calls, ${result.inserted} listings, ${result.collectionsServed} collections`);
        if (result.inserted > 0) emitEvent(db, "listings_fetched", `Knife inputs: +${result.inserted} listings from ${result.collectionsServed} collections`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Knife input fetch error: ${(err as Error).message}`);
      }
    }

    // Classified inputs (for classified→covert trade-ups)
    if (!budget.isListingRateLimited() && classifiedInputCalls >= 3) {
      setDaemonStatus(db, "fetching", "Phase 4b: Classified inputs");
      try {
        const result = await syncSmartClassifiedListings(db, {
          apiKey,
          maxCalls: classifiedInputCalls,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Classified inputs: ${result.apiCalls} calls, ${result.inserted} listings`);
        if (result.inserted > 0) emitEvent(db, "listings_fetched", `Classified: +${result.inserted} listings`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Classified input fetch error: ${(err as Error).message}`);
      }
    }

    // Covert output listings (knife/glove + Covert gun skins — both need pricing)
    if (!budget.isListingRateLimited() && outputCalls >= 5) {
      setDaemonStatus(db, "fetching", "Phase 4b: Output listings");
      try {
        const result = await syncCovertOutputListings(db, {
          apiKey,
          maxCalls: outputCalls,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Outputs: ${result.apiCalls} calls, ${result.inserted} listings`);
        if (result.inserted > 0) emitEvent(db, "listings_fetched", `Outputs: +${result.inserted} knife/glove listings`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Output fetch error: ${(err as Error).message}`);
      }
    }

    // 4c: Theory-guided wanted list fetch
    if (!budget.isListingRateLimited() && wantedList.length > 0 && wantedCalls >= 5) {
      console.log(`  [${timestamp()}] 4c: Theory-guided input fetch`);
      setDaemonStatus(db, "fetching", "Phase 4c: Fetching wanted inputs");
      try {
        const result = await syncWantedListings(db, wantedList, {
          apiKey,
          maxCalls: wantedCalls,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Wanted: ${result.apiCalls} calls, ${result.inserted} listings, ${result.skinsFetched} skins`);
        if (result.inserted > 0) emitEvent(db, "listings_fetched", `Wanted: +${result.inserted} theory-targeted listings (${result.skinsFetched} skins)`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Wanted fetch error: ${(err as Error).message}`);
      }
    }
  } else {
    console.log(`  [${timestamp()}] 4b: Listing search — rate limited, skipping`);
  }

  // 4d: DMarket listings (independent API — 2 RPS, doesn't use CSFloat budget)
  // Priority: wanted list skins first, then coverage-based Covert + Classified
  if (isDMarketConfigured()) {
    console.log(`  [${timestamp()}] 4d: DMarket listing fetch`);
    setDaemonStatus(db, "fetching", "Phase 4d: DMarket listings");
    let dmWantedInserted = 0;
    let dmWantedSkins = 0;
    let dmCoverageInserted = 0;

    try {
      // 4d-1: Wanted list — same theory-guided skins as CSFloat, fetched from DMarket too
      const wantedSkins = wantedList.slice(0, 20); // Top 20 by priority
      if (wantedSkins.length > 0) {
        setDaemonStatus(db, "fetching", "Phase 4d: DMarket wanted list");
        for (const w of wantedSkins) {
          try {
            const inserted = await syncDMarketListingsForSkin(db, w.skin_name, { maxListings: 50 });
            if (inserted > 0) {
              dmWantedInserted += inserted;
              dmWantedSkins++;
            }
          } catch {
            // Individual skin failures don't stop the batch
          }
        }
        if (dmWantedInserted > 0) freshness.markListingsChanged();
        console.log(`    DMarket wanted: ${dmWantedSkins}/${wantedSkins.length} skins, ${dmWantedInserted} listings`);
      }

      // 4d-2: Coverage — Covert + Classified skins with fewest DMarket listings
      setDaemonStatus(db, "fetching", "Phase 4d: DMarket coverage");
      const covertResult = await syncDMarketListingsForRarity(db, "Covert", {
        maxSkinsPerCall: 8,
        maxListingsPerSkin: 50,
        onProgress: (msg) => setDaemonStatus(db, "fetching", `DMarket: ${msg}`),
      });
      dmCoverageInserted += covertResult.listingsInserted;

      const classifiedResult = await syncDMarketListingsForRarity(db, "Classified", {
        maxSkinsPerCall: 8,
        maxListingsPerSkin: 50,
        onProgress: (msg) => setDaemonStatus(db, "fetching", `DMarket: ${msg}`),
      });
      dmCoverageInserted += classifiedResult.listingsInserted;

      if (dmCoverageInserted > 0) freshness.markListingsChanged();
      console.log(`    DMarket coverage: ${covertResult.skinsChecked + classifiedResult.skinsChecked} skins, ${dmCoverageInserted} listings`);

      const totalDm = dmWantedInserted + dmCoverageInserted;
      if (totalDm > 0) {
        emitEvent(db, "listings_fetched", `DMarket: +${totalDm} listings (${dmWantedInserted} wanted, ${dmCoverageInserted} coverage)`);
      }
    } catch (err) {
      console.error(`    DMarket fetch error: ${(err as Error).message}`);
    }
  }

  console.log(`  Data fetch done — ${budget.saleCount} sale calls (${budget.saleRemaining} remaining), ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);
}

export async function phase4p5VerifyInputs(
  db: ReturnType<typeof initDb>,
  freshness: FreshnessTracker,
  apiKey: string,
  probe: ApiProbeResult,
  budget: BudgetTracker
) {
  if (!probe.individualListing.available) return;
  if (budget.individualUsable <= 0) {
    console.log(`\n[${timestamp()}] ── Phase 4.5: Skipped (individual pool exhausted) ──`);
    return;
  }

  const profitableInputCount = (db.prepare(`
    SELECT COUNT(DISTINCT ti.listing_id) as cnt
    FROM trade_up_inputs ti
    JOIN trade_ups tu ON tu.id = ti.trade_up_id
    WHERE tu.is_theoretical = 0 AND tu.profit_cents > 0
  `).get() as { cnt: number }).cnt;

  if (profitableInputCount === 0) return;

  // Cap verification to 10% of cycle's individual budget (reserve rest for staleness)
  const maxVerify = Math.min(profitableInputCount + 10, 100, Math.floor(budget.cycleIndividualBudget() * 0.10));
  if (maxVerify <= 0) return;

  console.log(`\n[${timestamp()}] ── Phase 4.5: Verify profitable inputs (${profitableInputCount} listings, checking ${maxVerify}) ──`);
  setDaemonStatus(db, "fetching", `Phase 4.5: Verifying ${maxVerify} profitable inputs`);

  try {
    const verifyResult = await checkListingStaleness(db, {
      apiKey,
      maxChecks: maxVerify,
      onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
    });
    console.log(`  Verified: ${verifyResult.checked} checked, ${verifyResult.stillListed} active, ${verifyResult.sold} sold, ${verifyResult.delisted} removed`);
    if (verifyResult.sold > 0 || verifyResult.delisted > 0) {
      freshness.markListingsChanged();
      emitEvent(db, "staleness_check", `Verified ${verifyResult.checked} inputs: ${verifyResult.sold} sold, ${verifyResult.delisted} removed`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("429")) {
      console.log(`  Individual lookup pool exhausted during verification`);
    }
  }
}

export function phase5KnifeCalc(
  db: ReturnType<typeof initDb>,
  freshness: FreshnessTracker,
  force: boolean = false,
  theoryFloatTargets: number[] = [],
  theories: PessimisticTheory[] = [],
  discoveryResults?: TradeUp[],
): KnifeCalcResult {
  if (!discoveryResults && !force && !freshness.needsRecalc()) {
    console.log(`\n[${timestamp()}] ── Phase 5: Knife Calc (skipped — no new data) ──`);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0, nearMisses: [] };
  }

  console.log(`\n[${timestamp()}] ── Phase 5: Knife Calc${discoveryResults ? ' (worker)' : ''} ──`);
  setDaemonStatus(db, "calculating", "Phase 5: Finding profitable knife trade-ups");
  emitEvent(db, "phase", "Phase 5: Knife Calc");

  // Rebuild price cache (needed for materialization even when discovery came from worker)
  if (freshness.needsRecalc() || discoveryResults) {
    buildPriceCache(db, true);
  }

  try {
    const tradeUps = discoveryResults ?? findProfitableKnifeTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus(db, "calculating", msg);
      },
      extraTransitionPoints: theoryFloatTargets,
    });
    if (!discoveryResults) console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} knife trade-ups (${profitable.length} profitable)`);

    let cycleNearMisses: NearMissInfo[] = [];

    // ── Materialization: try to build real trade-ups from every theory ──
    if (theories.length > 0) {
      setDaemonStatus(db, "calculating", "Phase 5: Materializing theories");
      const matResult = materializeTheories(db, theories);

      if (matResult.found > 0) {
        // Add materialized trade-ups to discovery results (saveKnifeTradeUps merges by signature)
        const existingSigs = new Set(tradeUps.map(t => t.inputs.map(i => i.listing_id).sort().join(",")));
        let added = 0;
        for (const tu of matResult.tradeUps) {
          const sig = tu.inputs.map(i => i.listing_id).sort().join(",");
          if (!existingSigs.has(sig)) {
            tradeUps.push(tu);
            existingSigs.add(sig);
            added++;
          }
        }

        console.log(`  Materialized: ${matResult.attempted} theories tried, ${matResult.found} built, ${matResult.profitable} profitable (${added} new beyond discovery)`);
        if (matResult.comparison.length > 0) {
          const profitableComps = matResult.comparison.filter(c => c.realProfit > 0);
          if (profitableComps.length > 0) {
            const avgTheory = Math.round(profitableComps.reduce((s, c) => s + c.theoryProfit, 0) / profitableComps.length);
            const avgReal = Math.round(profitableComps.reduce((s, c) => s + c.realProfit, 0) / profitableComps.length);
            console.log(`    Pricing accuracy (${profitableComps.length} profitable): theory avg $${(avgTheory / 100).toFixed(2)} vs real avg $${(avgReal / 100).toFixed(2)}`);
          }
        }
        // Near-miss combos — theory says profitable but real is close
        if (matResult.nearMisses.length > 0) {
          console.log(`    Near-misses (${matResult.nearMisses.length} combos within $100 of profit):`);
          for (const nm of matResult.nearMisses.slice(0, 5)) {
            const colShort = nm.combo.replace(/The /g, "").replace(/ Collection/g, "").replace(/,/g, " + ");
            console.log(`      ${colShort}: theory +$${(nm.theoryProfit / 100).toFixed(2)}, real -$${(nm.gap / 100).toFixed(2)} (need $${(nm.gap / 100).toFixed(2)} cheaper)`);
          }
          // Save near-misses for next cycle's wanted list boost
          cycleNearMisses = matResult.nearMisses.map(nm => ({
            combo: nm.combo,
            gap: nm.gap,
            theoryProfit: nm.theoryProfit,
          }));
        }
      } else {
        console.log(`  Materialized: ${matResult.attempted} theories tried, none could be built from real listings`);
      }

      // ── Record theory validation results ──
      // Validation measures ACCURACY: how close theory prediction matched reality.
      // A theory predicting +$2800 that reality shows +$10 is NOT "validated" —
      // it's wildly inaccurate even though both are technically profitable.
      {
        setDaemonStatus(db, "calculating", "Phase 5: Recording theory validations");
        const validationResults: TheoryValidationResult[] = [];

        // Track which theories were materialized (had listings)
        const materializedCombos = new Set(matResult.comparison.map(c => c.combo));

        for (const theory of theories) {
          const ck = theoryComboKey(theory.collections, theory.split);
          const comboStr = theory.collections.join(",");

          // Check if this theory was materialized
          const comp = matResult.comparison.find(c => c.combo === comboStr);
          const nm = matResult.nearMisses.find(n => n.combo === comboStr);

          if (comp) {
            // Accuracy-based status: how close was the theory to reality?
            const profitError = Math.abs(comp.theoryProfit - comp.realProfit);
            const costError = Math.abs(comp.theoryCost - comp.realCost);
            const roiTheory = comp.theoryCost > 0 ? comp.theoryProfit / comp.theoryCost : 0;
            const roiReal = comp.realCost > 0 ? comp.realProfit / comp.realCost : 0;
            const roiError = Math.abs(roiTheory - roiReal);

            let status: 'profitable' | 'near_miss' | 'invalidated';
            if (comp.realProfit > 0 && profitError < Math.max(500, Math.abs(comp.realProfit) * 0.5)) {
              // Theory was right direction AND within 50% or $5 of real profit
              status = 'profitable';
            } else if (comp.realProfit > -10000 && (nm || profitError < 20000)) {
              // Real result within $100 of breaking even, or theory was <$200 off
              status = 'near_miss';
            } else {
              status = 'invalidated';
            }

            const accuracyNote = `accuracy: profit_err=$${(profitError / 100).toFixed(2)}, cost_err=$${(costError / 100).toFixed(2)}, roi_err=${(roiError * 100).toFixed(0)}%`;

            validationResults.push({
              combo_key: ck,
              status,
              theory_profit_cents: comp.theoryProfit,
              real_profit_cents: comp.realProfit,
              cost_gap_cents: comp.theoryCost - comp.realCost,
              ev_gap_cents: (comp.theoryProfit + comp.theoryCost) - (comp.realProfit + comp.realCost),
              notes: `theory_cost=$${(comp.theoryCost / 100).toFixed(2)},real_cost=$${(comp.realCost / 100).toFixed(2)},${accuracyNote}`,
            });
          } else if (!materializedCombos.has(comboStr) && theory.profitCents > 0) {
            // Theory was profitable but couldn't be materialized (no listings)
            validationResults.push({
              combo_key: ck,
              status: 'no_listings',
              theory_profit_cents: theory.profitCents,
              real_profit_cents: null,
              cost_gap_cents: 0,
              ev_gap_cents: 0,
              notes: `needs_listings_for:${theory.inputSkins.map(i => i.skinName).join(",")}`,
            });
          }
        }

        if (validationResults.length > 0) {
          saveTheoryValidations(db, validationResults);
          const statusCounts = validationResults.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          console.log(`  Validation: ${validationResults.length} results recorded (${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(", ")})`);

          // Log accuracy summary
          const withReal = validationResults.filter(r => r.real_profit_cents !== null);
          if (withReal.length > 0) {
            const avgProfitErr = Math.round(withReal.reduce((s, r) => s + Math.abs(r.theory_profit_cents - (r.real_profit_cents ?? 0)), 0) / withReal.length);
            const avgCostErr = Math.round(withReal.reduce((s, r) => s + Math.abs(r.cost_gap_cents), 0) / withReal.length);
            console.log(`  Theory accuracy: avg profit error $${(avgProfitErr / 100).toFixed(2)}, avg cost error $${(avgCostErr / 100).toFixed(2)} (${withReal.length} validated)`);
          }
        }

        // Persist near-misses to DB (survives daemon restarts)
        if (cycleNearMisses.length > 0) {
          saveNearMissesToDb(db, cycleNearMisses);
          console.log(`  Persisted ${cycleNearMisses.length} near-misses to DB`);
        }
      }

      // ── Theory-targeted deep scan ──
      // For theory-profitable combos, do a dense 50-point float scan
      // Discovery uses 9 points for ALL pairs; this does 50 for the best combos
      setDaemonStatus(db, "calculating", "Phase 5: Theory-targeted deep scan");
      const deepScanResult = theoryTargetedDeepScan(db, theories, tradeUps, matResult);
      if (deepScanResult.found > 0) {
        for (const tu of deepScanResult.tradeUps) {
          tradeUps.push(tu);
        }
        console.log(`  Deep scan: ${deepScanResult.scanned} theory combos, ${deepScanResult.found} new trade-ups (${deepScanResult.profitable} profitable)`);
      }
    }

    // Re-sort after adding materialized results
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);

    if (tradeUps.length > 0) {
      saveKnifeTradeUps(db, tradeUps);
      console.log(`  Saved ${tradeUps.length} knife trade-ups`);

      const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
      if (allProfitable.length > 0) {
        console.log("  Top knife trade-ups:");
        for (const tu of allProfitable.slice(0, 5)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) $${(tu.total_cost_cents / 100).toFixed(2)} cost | ${inputNames}`);
        }
        emitEvent(db, "calc_complete", `${allProfitable.length} profitable trade-ups, best +$${(allProfitable[0].profit_cents / 100).toFixed(2)}`);
      } else {
        emitEvent(db, "calc_complete", `${tradeUps.length} trade-ups evaluated, 0 profitable`);
      }
    }

    // ── Revival: try to find replacement listings for stale/partial trade-ups ──
    {
      setDaemonStatus(db, "calculating", "Phase 5: Reviving stale trade-ups");
      // Build knife finish cache for revival (cheap — DB queries only)
      const revivalCache = new Map<string, FinishData[]>();
      const itemTypes = new Set<string>();
      for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
        for (const kt of caseInfo.knifeTypes) itemTypes.add(kt);
        if (caseInfo.gloveGen) {
          for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) itemTypes.add(gt);
        }
      }
      for (const it of itemTypes) {
        const finishes = getKnifeFinishesWithPrices(db, it);
        if (finishes.length > 0) revivalCache.set(it, finishes);
      }

      const revival = reviveStaleTradeUps(db, revivalCache, 200);
      if (revival.revived > 0) {
        console.log(`  Revival: checked ${revival.checked}, revived ${revival.revived} (${revival.improved} improved)`);
      }
    }

    updateCollectionScores(db);

    // ── Discovery override: clear cooldowns for combos that discovery proves profitable ──
    // Materialization may fail at theory's float target (e.g., FN) while discovery
    // finds the same combo profitable at a different float (e.g., FT). Don't let
    // materialization's failure suppress a known-good combo.
    {
      const cleared = clearDiscoveryProfitableCooldowns(db);
      if (cleared > 0) {
        console.log(`  Discovery override: cleared cooldowns for ${cleared} profitable combos`);
      }
    }

    freshness.markCalcDone();

    const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
    setDaemonStatus(db, "calculating", `Phase 5 done: ${allProfitable.length} profitable knife trade-ups`);

    const topProfit = allProfitable.length > 0 ? allProfitable[0].profit_cents : 0;
    const avgProfit = allProfitable.length > 0
      ? Math.round(allProfitable.reduce((s, t) => s + t.profit_cents, 0) / allProfitable.length)
      : 0;

    return { total: tradeUps.length, profitable: allProfitable.length, topProfit, avgProfit, nearMisses: cycleNearMisses };
  } catch (err) {
    console.error(`  Knife calc error: ${(err as Error).message}`);
    setDaemonStatus(db, "error", (err as Error).message);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0, nearMisses: [] };
  }
}

export function phase7Rematerialization(
  db: ReturnType<typeof initDb>,
  theoryResult: TheoryResult,
  previousNearMisses: NearMissInfo[]
): NearMissInfo[] {
  console.log(`\n[${timestamp()}] ── Phase 7: Re-materialization ──`);
  setDaemonStatus(db, "calculating", "Phase 7: Re-checking theories with updated data");

  // Rebuild price cache with any new sale observations
  buildPriceCache(db, true);

  // Re-run materialization with the same theories
  const rematResult = materializeTheories(db, theoryResult.theories);
  if (rematResult.found > 0 || rematResult.nearMisses.length > 0) {
    console.log(`  Re-materialized: ${rematResult.found} built, ${rematResult.profitable} profitable, ${rematResult.nearMisses.length} near-misses`);

    // Record updated validations
    const revalidationResults: TheoryValidationResult[] = [];
    for (const comp of rematResult.comparison) {
      // Find the theory for this combo
      const theory = theoryResult.theories.find(t => t.collections.join(",") === comp.combo);
      if (!theory) continue;
      const ck = theoryComboKey(theory.collections, theory.split);
      const nm = rematResult.nearMisses.find(n => n.combo === comp.combo);
      const status = comp.realProfit > 0 ? 'profitable' as const
        : nm ? 'near_miss' as const
        : 'invalidated' as const;
      revalidationResults.push({
        combo_key: ck,
        status,
        theory_profit_cents: comp.theoryProfit,
        real_profit_cents: comp.realProfit,
        cost_gap_cents: comp.theoryCost - comp.realCost,
        ev_gap_cents: (comp.theoryProfit + comp.theoryCost) - (comp.realProfit + comp.realCost),
        notes: `remat_after_staleness`,
      });
    }
    if (revalidationResults.length > 0) {
      saveTheoryValidations(db, revalidationResults);
    }

    // Update near-misses if we found better ones
    if (rematResult.nearMisses.length > 0) {
      const updatedNearMisses = rematResult.nearMisses.map(nm => ({
        combo: nm.combo,
        gap: nm.gap,
        theoryProfit: nm.theoryProfit,
      }));
      saveNearMissesToDb(db, updatedNearMisses);
      // Use the freshest near-misses for next cycle
      previousNearMisses = updatedNearMisses;
    }

    // If profitable trade-ups were found, merge them in
    if (rematResult.profitable > 0) {
      console.log(`  New profitable trade-ups found during re-materialization!`);
      // Re-save to merge any new profitable results
      const existingTradeUps = findProfitableKnifeTradeUps(db, {
        onProgress: () => {},
        extraTransitionPoints: theoryResult.bestFloatTargets,
      });
      for (const tu of rematResult.tradeUps) {
        const sig = tu.inputs.map(i => i.listing_id).sort().join(",");
        const exists = existingTradeUps.some(e => e.inputs.map(i => i.listing_id).sort().join(",") === sig);
        if (!exists) existingTradeUps.push(tu);
      }
      existingTradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
      saveKnifeTradeUps(db, existingTradeUps);
    }
  } else {
    console.log(`  Re-materialization: no changes`);
  }

  // Re-run discovery override after Phase 7 — re-materialization's
  // saveTheoryValidations may have re-set cooldowns that Phase 5 cleared
  const cleared7 = clearDiscoveryProfitableCooldowns(db);
  if (cleared7 > 0) {
    console.log(`  Phase 7 discovery override: cleared cooldowns for ${cleared7} profitable combos`);
  }

  return previousNearMisses;
}

/**
 * Try to build real trade-ups from every saved theory.
 * For each theory: extract collection quotas + target float, find matching real listings,
 * evaluate. Zero API cost — pure computation on existing listing data.
 */
function materializeTheories(
  db: ReturnType<typeof initDb>,
  theories: PessimisticTheory[]
): MaterializeResult {
  // Load all Covert gun listings
  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon));

  if (allListings.length === 0) {
    return { attempted: 0, found: 0, profitable: 0, tradeUps: [], comparison: [], nearMisses: [] };
  }

  // Group by collection with adjusted floats
  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  const seen = new Set<string>();
  const results: TradeUp[] = [];
  const comparison: MaterializeResult["comparison"] = [];
  const nearMisses: MaterializeResult["nearMisses"] = [];
  let attempted = 0;

  for (const theory of theories) {
    attempted++;

    // Build quotas from theory spec
    const quotas = new Map<string, number>();
    for (let i = 0; i < theory.collections.length; i++) {
      quotas.set(theory.collections[i], theory.split[i]);
    }

    // Check we have listings for all collections
    let hasAll = true;
    for (const [col, count] of quotas) {
      const pool = byColAdj.get(col);
      if (!pool || pool.length < count) { hasAll = false; break; }
    }
    if (!hasAll) continue;

    // Try theory's exact float target + nearby variants + condition boundaries
    const baseFloat = theory.adjustedFloat;
    const targets = new Set([
      baseFloat,
      baseFloat - 0.005, baseFloat + 0.005,
      baseFloat - 0.01, baseFloat + 0.01,
      baseFloat - 0.02, baseFloat + 0.02,
      baseFloat - 0.04, baseFloat + 0.04,
    ]);

    // Add condition boundary targets for this combo's knife output pool
    // These are the exact float values where output jumps between conditions (e.g., FN→MW)
    const condBounds = [0.07, 0.15, 0.38, 0.45];
    for (const colName of theory.collections) {
      const caseInfo = CASE_KNIFE_MAP[colName];
      if (!caseInfo) continue;
      const weaponTypes = [...caseInfo.knifeTypes];
      if (caseInfo.gloveGen) {
        for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) weaponTypes.push(gt);
      }
      for (const wt of weaponTypes) {
        for (const f of knifeFinishCache.get(wt) ?? []) {
          const range = f.skinMaxFloat - f.skinMinFloat;
          if (range <= 0) continue;
          for (const boundary of condBounds) {
            const avgNorm = (boundary - f.skinMinFloat) / range;
            if (avgNorm > 0.01 && avgNorm < 0.99) {
              targets.add(Math.round((avgNorm - 0.003) * 10000) / 10000); // just below = better condition
              targets.add(Math.round((avgNorm + 0.003) * 10000) / 10000);
            }
          }
        }
      }
    }
    const filteredTargets = [...targets].filter(t => t > 0 && t < 1);

    let bestResult: TradeUp | null = null;

    for (const target of filteredTargets) {
      // Price-greedy selection (cheapest listings within float budget)
      const selected = selectForFloatTarget(byColAdj, quotas, target, 5);
      if (selected) {
        const key = selected.map(s => s.id).sort().join(",");
        if (!seen.has(key)) {
          const result = evaluateKnifeTradeUp(db, selected, knifeFinishCache);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }

      // Float-greedy selection (lowest float within budget, may cost more)
      const floatGreedy = selectForFloatTargetFloatGreedy(byColAdj, quotas, target, 5);
      if (floatGreedy) {
        const key = floatGreedy.map(s => s.id).sort().join(",");
        if (!seen.has(key)) {
          const result = evaluateKnifeTradeUp(db, floatGreedy, knifeFinishCache);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }
    }

    // Also try lowest-float selection (sometimes the cheapest path to FN outputs)
    const lowestFloat = selectLowestFloat(byColAdj, quotas, 5);
    if (lowestFloat) {
      const key = lowestFloat.map(s => s.id).sort().join(",");
      if (!seen.has(key)) {
        const result = evaluateKnifeTradeUp(db, lowestFloat, knifeFinishCache);
        if (result && result.expected_value_cents > 0) {
          if (!bestResult || result.profit_cents > bestResult.profit_cents) {
            bestResult = result;
          }
        }
      }
    }

    if (bestResult) {
      const key = bestResult.inputs.map(i => i.listing_id).sort().join(",");
      if (!seen.has(key)) {
        seen.add(key);
        results.push(bestResult);

        comparison.push({
          combo: theory.collections.join(","),
          theoryProfit: theory.profitCents,
          realProfit: bestResult.profit_cents,
          theoryCost: theory.totalCostCents,
          realCost: bestResult.total_cost_cents,
        });

        // Track near-misses: theory says profitable but real is close (within -$100)
        if (theory.profitCents > 0 && bestResult.profit_cents <= 0 && bestResult.profit_cents > -10000) {
          nearMisses.push({
            combo: theory.collections.join(","),
            theoryProfit: theory.profitCents,
            realProfit: bestResult.profit_cents,
            gap: -bestResult.profit_cents, // how much cheaper inputs need to be
          });
        }
      }
    }
  }

  results.sort((a, b) => b.profit_cents - a.profit_cents);
  nearMisses.sort((a, b) => a.gap - b.gap); // closest to profitable first
  const profitable = results.filter(r => r.profit_cents > 0).length;

  return { attempted, found: results.length, profitable, tradeUps: results, comparison, nearMisses };
}

/**
 * Dense float scan for theory-profitable collection combos that discovery missed.
 * Discovery does 9 float points for all 861 pairs. This does 50 points for the
 * ~50 most promising combos identified by theory.
 */
function theoryTargetedDeepScan(
  db: ReturnType<typeof initDb>,
  theories: PessimisticTheory[],
  existingTradeUps: TradeUp[],
  matResult: MaterializeResult
): DeepScanResult {
  // Find theory-profitable combos that aren't already profitable in discovery
  const existingSigs = new Set(existingTradeUps.filter(t => t.profit_cents > 0).map(t => {
    const cols = [...new Set(t.inputs.map(i => i.collection_name))].sort().join(",");
    return cols;
  }));

  // Get unique profitable theory combos not already profitable in discovery
  const combosToScan = new Map<string, { collections: string[]; split: number[]; theoryProfit: number }>();
  for (const theory of theories) {
    if (theory.profitCents <= 0) continue;
    const comboKey = theory.collections.sort().join(",");
    if (existingSigs.has(comboKey)) continue; // Already profitable in discovery
    const existing = combosToScan.get(comboKey);
    if (!existing || theory.profitCents > existing.theoryProfit) {
      combosToScan.set(comboKey, {
        collections: theory.collections,
        split: theory.split,
        theoryProfit: theory.profitCents,
      });
    }
  }

  if (combosToScan.size === 0) return { scanned: 0, found: 0, profitable: 0, tradeUps: [] };

  // Load listings (reuse the same data as materialization)
  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon));
  if (allListings.length === 0) return { scanned: 0, found: 0, profitable: 0, tradeUps: [] };

  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  // Boundary-aware float targets: condition transition points + basic coverage
  const denseTargetSet = new Set<number>();
  // Basic coverage: 10 points spanning 0.01-0.50
  for (let t = 0.01; t <= 0.50; t = Math.round((t + 0.05) * 100) / 100) {
    denseTargetSet.add(t);
  }
  // Add condition boundary targets for each combo's knife output pool
  const condBounds = [0.07, 0.15, 0.38, 0.45];
  for (const [, combo] of combosToScan) {
    for (const colName of combo.collections) {
      const caseInfo = CASE_KNIFE_MAP[colName];
      if (!caseInfo) continue;
      const weaponTypes = [...caseInfo.knifeTypes];
      if (caseInfo.gloveGen) {
        for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) weaponTypes.push(gt);
      }
      for (const wt of weaponTypes) {
        for (const f of knifeFinishCache.get(wt) ?? []) {
          const range = f.skinMaxFloat - f.skinMinFloat;
          if (range <= 0) continue;
          for (const boundary of condBounds) {
            const avgNorm = (boundary - f.skinMinFloat) / range;
            if (avgNorm > 0.01 && avgNorm < 0.99) {
              // Dense scan around each boundary: ±0.01, step 0.002
              for (let off = -0.01; off <= 0.01; off += 0.002) {
                const point = Math.round((avgNorm + off) * 10000) / 10000;
                if (point > 0 && point < 1) denseTargetSet.add(point);
              }
            }
          }
        }
      }
    }
  }
  const denseTargets = [...denseTargetSet].sort((a, b) => a - b);

  const existingListingSigs = new Set(existingTradeUps.map(t => t.inputs.map(i => i.listing_id).sort().join(",")));
  const results: TradeUp[] = [];
  let scanned = 0;

  // Sort by theory profit descending, cap at top 80 combos
  const sortedCombos = [...combosToScan.entries()]
    .sort((a, b) => b[1].theoryProfit - a[1].theoryProfit)
    .slice(0, 80);

  for (const [, combo] of sortedCombos) {
    scanned++;
    const quotas = new Map<string, number>();
    for (let i = 0; i < combo.collections.length; i++) {
      quotas.set(combo.collections[i], combo.split[i]);
    }

    // Check we have listings
    let hasAll = true;
    for (const [col, count] of quotas) {
      const pool = byColAdj.get(col);
      if (!pool || pool.length < count) { hasAll = false; break; }
    }
    if (!hasAll) continue;

    let bestResult: TradeUp | null = null;

    // Also try all valid splits for this set of collections
    const splits = combo.collections.length === 1
      ? [[5]]
      : combo.collections.length === 2
        ? [[1, 4], [2, 3], [3, 2], [4, 1]]
        : [combo.split]; // For 3+ collections, use theory's split

    for (const split of splits) {
      const splitQuotas = new Map<string, number>();
      for (let i = 0; i < combo.collections.length; i++) {
        splitQuotas.set(combo.collections[i], split[i]);
      }

      for (const target of denseTargets) {
        // Price-greedy
        const selected = selectForFloatTarget(byColAdj, splitQuotas, target, 5);
        if (selected) {
          const key = selected.map(s => s.id).sort().join(",");
          if (!existingListingSigs.has(key)) {
            const result = evaluateKnifeTradeUp(db, selected, knifeFinishCache);
            if (result && result.expected_value_cents > 0) {
              if (!bestResult || result.profit_cents > bestResult.profit_cents) {
                bestResult = result;
              }
            }
          }
        }

        // Float-greedy
        const floatGreedy = selectForFloatTargetFloatGreedy(byColAdj, splitQuotas, target, 5);
        if (floatGreedy) {
          const key = floatGreedy.map(s => s.id).sort().join(",");
          if (!existingListingSigs.has(key)) {
            const result = evaluateKnifeTradeUp(db, floatGreedy, knifeFinishCache);
            if (result && result.expected_value_cents > 0) {
              if (!bestResult || result.profit_cents > bestResult.profit_cents) {
                bestResult = result;
              }
            }
          }
        }
      }

      // Also try lowest-float
      const lowestFloat = selectLowestFloat(byColAdj, splitQuotas, 5);
      if (lowestFloat) {
        const key = lowestFloat.map(s => s.id).sort().join(",");
        if (!existingListingSigs.has(key)) {
          const result = evaluateKnifeTradeUp(db, lowestFloat, knifeFinishCache);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }
    }

    if (bestResult) {
      const key = bestResult.inputs.map(i => i.listing_id).sort().join(",");
      if (!existingListingSigs.has(key)) {
        existingListingSigs.add(key);
        results.push(bestResult);
      }
    }
  }

  results.sort((a, b) => b.profit_cents - a.profit_cents);
  const profitable = results.filter(r => r.profit_cents > 0).length;

  return { scanned, found: results.length, profitable, tradeUps: results };
}

export function phase2ClassifiedTheory(
  db: ReturnType<typeof initDb>,
  cycleCount: number,
  previousNearMisses?: NearMissInfo[]
): ClassifiedTheoryResult {
  console.log(`\n[${timestamp()}] ── Phase 2b: Classified→Covert Theory ──`);
  setDaemonStatus(db, "calculating", "Phase 2b: Classified theory");

  // Price cache already built in Phase 2a — reuse (5-min TTL)

  // Load cooldowns (classified theories use "classified:" prefix in combo_key)
  const cooldownMap = loadTheoryCooldowns(db, "classified");

  setDaemonStatus(db, "calculating", "Phase 2b: Generating classified theories");
  const theories = generateClassifiedTheories(db, {
    onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    maxTheories: 3000,
    minRoiThreshold: -100,
    cooldownMap,
  });

  const profitableTheories = theories.filter(t => t.profitCents > 0);
  console.log(`  Generated ${theories.length} classified theories (${profitableTheories.length} profitable)`);

  // Save classified theories to DB for frontend display
  saveClassifiedTheoryTradeUps(db, theories);
  console.log(`  Saved ${theories.length} classified theories to DB`);

  // Build wanted list from classified theories
  const wantedList = buildClassifiedWantedList(theories, previousNearMisses);
  if (previousNearMisses && previousNearMisses.length > 0) {
    console.log(`  Near-miss boost: ${previousNearMisses.length} classified combos from last cycle`);
  }

  if (wantedList.length > 0) {
    console.log(`  Classified wanted list: ${wantedList.length} input skins`);
    for (const w of wantedList.slice(0, 3)) {
      console.log(`    ${w.skin_name} @ <${w.max_float.toFixed(2)} (score ${w.priority_score.toFixed(0)})`);
    }
  }

  // Extract float targets for discovery
  const bestFloatTargets = [...new Set(profitableTheories.map(t => t.adjustedFloat))].sort((a, b) => a - b);

  return { generated: theories.length, profitable: profitableTheories.length, wantedList, bestFloatTargets, theories };
}

export interface StaircaseTheoryPhaseResult {
  generated: number;
  profitable: number;
  boostMap: Map<string, number>; // classifiedComboKey → boost score
}

export function phase2cStaircaseTheory(
  db: ReturnType<typeof initDb>,
  classifiedTheories: ClassifiedTheory[]
): StaircaseTheoryPhaseResult {
  console.log(`\n[${timestamp()}] ── Phase 2c: Staircase Theory ──`);
  setDaemonStatus(db, "calculating", "Phase 2c: Staircase theory");

  const result = generateStaircaseTheories(db, classifiedTheories, {
    onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    maxTheories: 500,
    minStage1Roi: -10,
  });

  if (result.theories.length > 0) {
    console.log(`  Generated ${result.generated} staircase theories (${result.profitable} profitable)`);
    for (const st of result.theories.slice(0, 3)) {
      const tu = st.tradeUp;
      console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) from ${st.stage1Theories.length} stage-1 theories`);
    }

    // Save staircase theories to DB for frontend
    saveStaircaseTheoryTradeUps(db, result.theories);
    console.log(`  Saved ${result.theories.length} staircase theories to DB`);

    if (result.boostMap.size > 0) {
      console.log(`  Boost map: ${result.boostMap.size} classified combos boosted for staircase value`);
    }
  } else {
    console.log(`  No staircase theories generated`);
    saveStaircaseTheoryTradeUps(db, []);
  }

  return { generated: result.generated, profitable: result.profitable, boostMap: result.boostMap };
}

export function phase5ClassifiedCalc(
  db: ReturnType<typeof initDb>,
  freshness: FreshnessTracker,
  force: boolean = false,
  classifiedTheories: ClassifiedTheory[] = [],
  discoveryResults?: TradeUp[],
): ClassifiedCalcResult {
  console.log(`\n[${timestamp()}] ── Phase 5b: Classified→Covert Calc${discoveryResults ? ' (worker)' : ''} ──`);
  setDaemonStatus(db, "calculating", "Phase 5b: Classified→Covert discovery");
  emitEvent(db, "phase", "Phase 5b: Classified Calc");

  try {
    const tradeUps = discoveryResults ?? findProfitableTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus(db, "calculating", msg);
      },
    });
    if (!discoveryResults) console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} classified→covert trade-ups (${profitable.length} profitable)`);

    let cycleNearMisses: NearMissInfo[] = [];

    // ── Classified materialization ──
    // Try to build real trade-ups from classified theories
    if (classifiedTheories.length > 0) {
      setDaemonStatus(db, "calculating", "Phase 5b: Materializing classified theories");
      const matResult = materializeClassifiedTheories(db, classifiedTheories);

      if (matResult.found > 0) {
        const existingSigs = new Set(tradeUps.map(t => t.inputs.map(i => i.listing_id).sort().join(",")));
        let added = 0;
        for (const tu of matResult.tradeUps) {
          const sig = tu.inputs.map(i => i.listing_id).sort().join(",");
          if (!existingSigs.has(sig)) {
            tradeUps.push(tu);
            existingSigs.add(sig);
            added++;
          }
        }
        console.log(`  Materialized: ${matResult.attempted} theories tried, ${matResult.found} built, ${matResult.profitable} profitable (${added} new)`);

        if (matResult.nearMisses.length > 0) {
          console.log(`    Near-misses: ${matResult.nearMisses.length} combos within $100 of profit`);
          cycleNearMisses = matResult.nearMisses.map(nm => ({
            combo: nm.combo,
            gap: nm.gap,
            theoryProfit: nm.theoryProfit,
          }));
        }
      }

      // Record classified theory validations
      {
        const validationResults: TheoryValidationResult[] = [];
        const materializedCombos = new Set(matResult.comparison.map(c => c.combo));

        for (const theory of classifiedTheories) {
          const ck = classifiedComboKey(theory.collections, theory.split);
          const comboStr = theory.collections.join(",");
          const comp = matResult.comparison.find(c => c.combo === comboStr);

          if (comp) {
            const profitError = Math.abs(comp.theoryProfit - comp.realProfit);
            let status: 'profitable' | 'near_miss' | 'invalidated';
            if (comp.realProfit > 0 && profitError < Math.max(500, Math.abs(comp.realProfit) * 0.5)) {
              status = 'profitable';
            } else if (comp.realProfit > -10000) {
              status = 'near_miss';
            } else {
              status = 'invalidated';
            }

            validationResults.push({
              combo_key: ck,
              status,
              theory_profit_cents: comp.theoryProfit,
              real_profit_cents: comp.realProfit,
              cost_gap_cents: comp.theoryCost - comp.realCost,
              ev_gap_cents: (comp.theoryProfit + comp.theoryCost) - (comp.realProfit + comp.realCost),
              notes: `classified_theory`,
            });
          } else if (!materializedCombos.has(comboStr) && theory.profitCents > 0) {
            validationResults.push({
              combo_key: ck,
              status: 'no_listings',
              theory_profit_cents: theory.profitCents,
              real_profit_cents: null,
              cost_gap_cents: 0,
              ev_gap_cents: 0,
              notes: `classified_needs_listings`,
            });
          }
        }

        if (validationResults.length > 0) {
          saveTheoryValidations(db, validationResults);
          const statusCounts = validationResults.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          console.log(`  Classified validation: ${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
        }

        if (cycleNearMisses.length > 0) {
          saveNearMissesToDb(db, cycleNearMisses, "classified");
        }
      }
    }

    // Random classified explore
    setDaemonStatus(db, "calculating", "Phase 5b: Random classified exploration");
    const exploreResult = randomClassifiedExplore(db, {
      iterations: 200,
      onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    });
    if (exploreResult.found > 0) {
      console.log(`  Classified explore: ${exploreResult.explored} iterations, +${exploreResult.found} new, ${exploreResult.improved} improved`);
    }

    // Re-sort and save
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
    if (tradeUps.length > 0) {
      saveClassifiedTradeUps(db, tradeUps);
      console.log(`  Saved ${tradeUps.length} classified→covert trade-ups`);

      const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
      if (allProfitable.length > 0) {
        console.log("  Top classified trade-ups:");
        for (const tu of allProfitable.slice(0, 3)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
        }
        emitEvent(db, "classified_calc", `${allProfitable.length} profitable, best +$${(allProfitable[0].profit_cents / 100).toFixed(2)}`);
      }
    }

    // Revive stale/partial classified trade-ups with replacement listings
    const classifiedRevival = reviveStaleClassifiedTradeUps(db, 200);
    if (classifiedRevival.revived > 0) {
      console.log(`  Classified revival: checked ${classifiedRevival.checked}, revived ${classifiedRevival.revived} (${classifiedRevival.improved} improved)`);
    }

    updateCollectionScores(db);

    const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
    const topProfit = allProfitable.length > 0 ? allProfitable[0].profit_cents : 0;
    const avgProfit = allProfitable.length > 0
      ? Math.round(allProfitable.reduce((s, t) => s + t.profit_cents, 0) / allProfitable.length)
      : 0;

    return { total: tradeUps.length, profitable: allProfitable.length, topProfit, avgProfit, nearMisses: cycleNearMisses };
  } catch (err) {
    console.error(`  Classified calc error: ${(err as Error).message}`);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0, nearMisses: [] };
  }
}

export function phase5dStatTrak(db: ReturnType<typeof initDb>, discoveryResults?: TradeUp[]) {
  console.log(`\n[${timestamp()}] ── Phase 5d: StatTrak Classified→Covert${discoveryResults ? ' (worker)' : ''} ──`);
  setDaemonStatus(db, "calculating", "Phase 5d: StatTrak discovery");
  emitEvent(db, "phase", "Phase 5d: StatTrak Calc");

  try {
    let tradeUps: TradeUp[];

    if (discoveryResults) {
      tradeUps = discoveryResults;
      if (tradeUps.length === 0) {
        console.log("  No StatTrak trade-ups found");
      }
    } else {
      // Check if we have any StatTrak classified listings
      const stListingCount = (db.prepare(`
        SELECT COUNT(*) as c FROM listings l
        JOIN skins s ON l.skin_id = s.id
        WHERE s.rarity = 'Classified' AND l.stattrak = 1
      `).get() as { c: number }).c;

      if (stListingCount === 0) {
        console.log("  No StatTrak classified listings — skipping");
        return { total: 0, profitable: 0 };
      }
      console.log(`  ${stListingCount} StatTrak classified listings available`);

      tradeUps = findProfitableTradeUps(db, {
        stattrak: true,
        onProgress: (msg) => {
          process.stdout.write(`\r  ST: ${msg}                    `);
          setDaemonStatus(db, "calculating", `ST: ${msg}`);
        },
      });
      console.log("");
    }

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  StatTrak: ${tradeUps.length} trade-ups (${profitable.length} profitable)`);

    // Random StatTrak explore
    const exploreResult = randomClassifiedExplore(db, {
      iterations: 100,
      stattrak: true,
      onProgress: (msg) => setDaemonStatus(db, "calculating", `ST: ${msg}`),
    });
    if (exploreResult.found > 0) {
      console.log(`  ST explore: ${exploreResult.explored} iterations, +${exploreResult.found} new`);
    }

    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
    if (tradeUps.length > 0) {
      saveClassifiedTradeUps(db, tradeUps, "classified_covert_st");
      console.log(`  Saved ${tradeUps.length} StatTrak classified→covert trade-ups`);

      const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
      if (allProfitable.length > 0) {
        console.log("  Top StatTrak trade-ups:");
        for (const tu of allProfitable.slice(0, 3)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
        }
        emitEvent(db, "st_classified_calc", `${allProfitable.length} profitable, best +$${(allProfitable[0].profit_cents / 100).toFixed(2)}`);
      }
    }

    return { total: tradeUps.length, profitable: profitable.length };
  } catch (err) {
    console.error(`  StatTrak calc error: ${(err as Error).message}`);
    return { total: 0, profitable: 0 };
  }
}

export function phase5cStaircase(db: ReturnType<typeof initDb>) {
  console.log(`\n[${timestamp()}] ── Phase 5c: Staircase ──`);
  setDaemonStatus(db, "calculating", "Phase 5c: Staircase evaluation");

  try {
    const result = findStaircaseTradeUps(db);
    if (result.total > 0) {
      console.log(`  Staircase: ${result.total} evaluated, ${result.profitable} profitable`);
      for (const tu of result.tradeUps.slice(0, 3)) {
        console.log(`    $${(tu.tradeUp.profit_cents / 100).toFixed(2)} profit (${tu.tradeUp.roi_percentage.toFixed(0)}% ROI), ${tu.stage1Ids.length} stage-1 trade-ups`);
      }

      // Save staircase trade-ups with real classified inputs (not synthetic Coverts)
      // Load the actual 50 classified listing inputs from stage1 trade-up IDs
      const loadStage1Inputs = db.prepare(`
        SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
        FROM trade_up_inputs WHERE trade_up_id = ?
      `);
      for (const st of result.tradeUps) {
        // Replace synthetic Covert inputs with real classified inputs from stage1
        const realInputs: typeof st.tradeUp.inputs = [];
        for (const s1Id of st.stage1Ids) {
          const rows = loadStage1Inputs.all(s1Id) as { listing_id: string; skin_id: string; skin_name: string; collection_name: string; price_cents: number; float_value: number; condition: Condition; source: string | null }[];
          for (const r of rows) {
            realInputs.push({
              listing_id: r.listing_id,
              skin_id: r.skin_id,
              skin_name: r.skin_name,
              collection_name: r.collection_name,
              price_cents: r.price_cents,
              float_value: r.float_value,
              condition: r.condition,
              source: r.source ?? "csfloat",
            });
          }
        }
        st.tradeUp.inputs = realInputs;
      }
      const tradeUps = result.tradeUps.map(s => s.tradeUp);
      saveTradeUps(db, tradeUps, true, "staircase", false, "staircase");
      console.log(`  Saved ${tradeUps.length} staircase trade-ups (${tradeUps[0]?.inputs.length ?? 0} inputs each)`);
    } else {
      console.log(`  Staircase: no viable combinations found`);
    }
  } catch (err) {
    console.error(`  Staircase error: ${(err as Error).message}`);
  }
}

function materializeClassifiedTheories(
  db: ReturnType<typeof initDb>,
  theories: ClassifiedTheory[]
): MaterializeResult {
  const allListings = getListingsForRarity(db, "Classified");
  if (allListings.length === 0) {
    return { attempted: 0, found: 0, profitable: 0, tradeUps: [], comparison: [], nearMisses: [] };
  }

  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Cache outcomes by collection set
  const outcomeCache = new Map<string, ReturnType<typeof getOutcomesForCollections>>();
  function getOutcomes(collectionIds: string[]) {
    const key = collectionIds.sort().join(",");
    if (!outcomeCache.has(key)) {
      outcomeCache.set(key, getOutcomesForCollections(db, collectionIds, "Covert"));
    }
    return outcomeCache.get(key)!;
  }

  const seen = new Set<string>();
  const results: TradeUp[] = [];
  const comparison: MaterializeResult["comparison"] = [];
  const nearMisses: MaterializeResult["nearMisses"] = [];
  let attempted = 0;

  for (const theory of theories) {
    attempted++;

    const quotas = new Map<string, number>();
    for (let i = 0; i < theory.collections.length; i++) {
      quotas.set(theory.collections[i], theory.split[i]);
    }

    // Check we have listings
    let hasAll = true;
    for (const [col, count] of quotas) {
      const pool = byColAdj.get(col);
      if (!pool || pool.length < count) { hasAll = false; break; }
    }
    if (!hasAll) continue;

    // Try theory's float target + variants
    const baseFloat = theory.adjustedFloat;
    const targets = [
      baseFloat,
      baseFloat - 0.005, baseFloat + 0.005,
      baseFloat - 0.01, baseFloat + 0.01,
      baseFloat - 0.02, baseFloat + 0.02,
    ].filter(t => t > 0 && t < 1);

    let bestResult: TradeUp | null = null;

    // Resolve collection IDs from names for outcome lookup
    const collectionIdMap = new Map<string, string>();
    for (const l of allAdjusted) {
      if (!collectionIdMap.has(l.collection_name)) {
        collectionIdMap.set(l.collection_name, l.collection_id);
      }
    }
    const collectionIds = theory.collections.map(c => collectionIdMap.get(c)).filter(Boolean) as string[];
    if (collectionIds.length === 0) continue;
    const outcomes = getOutcomes(collectionIds);
    if (outcomes.length === 0) continue;

    for (const target of targets) {
      const selected = selectForFloatTarget(byColAdj, quotas, target, 10);
      if (selected) {
        const key = selected.map(s => s.id).sort().join(",");
        if (!seen.has(key)) {
          const result = evaluateTradeUp(db, selected, outcomes);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }
    }

    // Also try lowest-float selection
    const lowestFloat = selectLowestFloat(byColAdj, quotas, 10);
    if (lowestFloat) {
      const key = lowestFloat.map(s => s.id).sort().join(",");
      if (!seen.has(key)) {
        const result = evaluateTradeUp(db, lowestFloat, outcomes);
        if (result && result.expected_value_cents > 0) {
          if (!bestResult || result.profit_cents > bestResult.profit_cents) {
            bestResult = result;
          }
        }
      }
    }

    // Also try cheapest-by-price per condition (matches theory's pricing model)
    // Theory picks N cheapest listings per collection+condition, so replicate that here
    const conditionsToTry = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
    for (const cond of conditionsToTry) {
      const cheapest: AdjustedListing[] = [];
      let ok = true;
      for (const [col, count] of quotas) {
        const pool = byColAdj.get(col);
        if (!pool) { ok = false; break; }
        const condPool = pool.filter(l => floatToCondition(l.float_value) === cond);
        if (condPool.length < count) { ok = false; break; }
        cheapest.push(...condPool.slice(0, count)); // already sorted by price
      }
      if (!ok || cheapest.length !== 10) continue;
      const key = cheapest.map(s => s.id).sort().join(",");
      if (seen.has(key)) continue;
      const result = evaluateTradeUp(db, cheapest, outcomes);
      if (result && result.expected_value_cents > 0) {
        if (!bestResult || result.profit_cents > bestResult.profit_cents) {
          bestResult = result;
        }
      }
    }

    if (bestResult) {
      const key = bestResult.inputs.map(i => i.listing_id).sort().join(",");
      if (!seen.has(key)) {
        seen.add(key);
        results.push(bestResult);

        comparison.push({
          combo: theory.collections.join(","),
          theoryProfit: theory.profitCents,
          realProfit: bestResult.profit_cents,
          theoryCost: theory.totalCostCents,
          realCost: bestResult.total_cost_cents,
        });

        if (theory.profitCents > 0 && bestResult.profit_cents <= 0 && bestResult.profit_cents > -10000) {
          nearMisses.push({
            combo: theory.collections.join(","),
            theoryProfit: theory.profitCents,
            realProfit: bestResult.profit_cents,
            gap: -bestResult.profit_cents,
          });
        }
      }
    }
  }

  results.sort((a, b) => b.profit_cents - a.profit_cents);
  nearMisses.sort((a, b) => a.gap - b.gap);
  const profitable = results.filter(r => r.profit_cents > 0).length;

  return { attempted, found: results.length, profitable, tradeUps: results, comparison, nearMisses };
}

export function printTheoryAccuracy(db: ReturnType<typeof initDb>) {
  // Compare theory vs real discovery — focus on what matters:
  // 1. Theory-only wins (profitable combos discovery didn't find)
  // 2. Discovery-only wins (profitable combos theory missed)
  // 3. For overlapping profitable combos: pricing accuracy
  const theories = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
      GROUP_CONCAT(DISTINCT tui.collection_name ORDER BY tui.collection_name) as collections
    FROM trade_ups t
    JOIN trade_up_inputs tui ON t.id = tui.trade_up_id
    WHERE t.is_theoretical = 1
    GROUP BY t.id
  `).all() as { id: number; total_cost_cents: number; expected_value_cents: number; profit_cents: number; collections: string }[];

  const reals = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
      GROUP_CONCAT(DISTINCT tui.collection_name ORDER BY tui.collection_name) as collections
    FROM trade_ups t
    JOIN trade_up_inputs tui ON t.id = tui.trade_up_id
    WHERE t.is_theoretical = 0 AND t.type = 'covert_knife'
    GROUP BY t.id
  `).all() as { id: number; total_cost_cents: number; expected_value_cents: number; profit_cents: number; collections: string }[];

  if (theories.length === 0 || reals.length === 0) return;

  // Group by collection combo, take BEST profit per combo
  const theoryBest = new Map<string, { cost: number; ev: number; profit: number }>();
  for (const t of theories) {
    const existing = theoryBest.get(t.collections);
    if (!existing || t.profit_cents > existing.profit) {
      theoryBest.set(t.collections, { cost: t.total_cost_cents, ev: t.expected_value_cents, profit: t.profit_cents });
    }
  }
  const realBest = new Map<string, { cost: number; ev: number; profit: number }>();
  for (const r of reals) {
    const existing = realBest.get(r.collections);
    if (!existing || r.profit_cents > existing.profit) {
      realBest.set(r.collections, { cost: r.total_cost_cents, ev: r.expected_value_cents, profit: r.profit_cents });
    }
  }

  // Find theory-only profitable combos (theory found it, discovery didn't)
  const theoryOnlyWins: { combo: string; profit: number; cost: number }[] = [];
  const discoveryOnlyWins: { combo: string; profit: number; cost: number }[] = [];
  const bothProfitable: { combo: string; theoryProfit: number; realProfit: number; theoryCost: number; realCost: number }[] = [];
  let matched = 0;
  let theoryHigherCost = 0;

  for (const [combo, t] of theoryBest) {
    const real = realBest.get(combo);
    if (!real) {
      if (t.profit > 0) theoryOnlyWins.push({ combo, profit: t.profit, cost: t.cost });
      continue;
    }
    matched++;
    if (t.cost > real.cost) theoryHigherCost++;
    if (t.profit > 0 && real.profit <= 0) {
      theoryOnlyWins.push({ combo, profit: t.profit, cost: t.cost });
    } else if (t.profit <= 0 && real.profit > 0) {
      discoveryOnlyWins.push({ combo, profit: real.profit, cost: real.cost });
    } else if (t.profit > 0 && real.profit > 0) {
      bothProfitable.push({ combo, theoryProfit: t.profit, realProfit: real.profit, theoryCost: t.cost, realCost: real.cost });
    }
  }
  // Also check discovery combos theory doesn't cover
  for (const [combo, r] of realBest) {
    if (!theoryBest.has(combo) && r.profit > 0) {
      discoveryOnlyWins.push({ combo, profit: r.profit, cost: r.cost });
    }
  }

  console.log(`\n  Theory accuracy: ${matched} collection combos overlap`);
  console.log(`    Theory costs higher: ${theoryHigherCost}/${matched} (${matched > 0 ? Math.round(theoryHigherCost / matched * 100) : 0}%)`);

  const theoryProfitable = [...theoryBest.values()].filter(t => t.profit > 0).length;
  const realProfitable = [...realBest.values()].filter(r => r.profit > 0).length;
  console.log(`    Profitable: theory ${theoryProfitable}, discovery ${realProfitable}`);

  if (theoryOnlyWins.length > 0) {
    theoryOnlyWins.sort((a, b) => b.profit - a.profit);
    console.log(`    Theory finds ${theoryOnlyWins.length} profitable combos discovery missed:`);
    for (const w of theoryOnlyWins.slice(0, 3)) {
      const colShort = w.combo.replace(/The /g, "").replace(/ Collection/g, "");
      console.log(`      ${colShort}: +$${(w.profit / 100).toFixed(2)} (cost $${(w.cost / 100).toFixed(2)})`);
    }
  }

  if (discoveryOnlyWins.length > 0) {
    discoveryOnlyWins.sort((a, b) => b.profit - a.profit);
    console.log(`    Discovery finds ${discoveryOnlyWins.length} profitable combos theory missed:`);
    for (const w of discoveryOnlyWins.slice(0, 3)) {
      const colShort = w.combo.replace(/The /g, "").replace(/ Collection/g, "");
      console.log(`      ${colShort}: +$${(w.profit / 100).toFixed(2)} (cost $${(w.cost / 100).toFixed(2)})`);
    }
  }

  if (bothProfitable.length > 0) {
    const avgTheoryProfit = bothProfitable.reduce((s, b) => s + b.theoryProfit, 0) / bothProfitable.length;
    const avgRealProfit = bothProfitable.reduce((s, b) => s + b.realProfit, 0) / bothProfitable.length;
    console.log(`    Both profitable: ${bothProfitable.length} combos (theory avg $${(avgTheoryProfit / 100).toFixed(2)} vs real avg $${(avgRealProfit / 100).toFixed(2)})`);
  }
}
