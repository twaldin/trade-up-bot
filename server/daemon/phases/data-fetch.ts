/**
 * Phase 3: API Probe — rate limit detection across all 3 CSFloat pools.
 * Phase 4: Data Fetch — round-robin sale history + listing search for full coverage.
 */

import pg from "pg";
import { setSyncMeta, emitEvent } from "../../db.js";
import {
  syncListingsRoundRobin,
  syncSaleHistoryRoundRobin,
} from "../../sync.js";

import { BudgetTracker, FreshnessTracker } from "../state.js";
import {
  timestamp, setDaemonStatus,
  probeApiRateLimits,
  type RateLimitInfo, type ApiProbeResult,
} from "../utils.js";

export async function phase3ApiProbe(
  pool: pg.Pool,
  budget: BudgetTracker,
  apiKey: string
): Promise<ApiProbeResult> {
  console.log(`\n[${timestamp()}] Phase 3: API Probe`);
  await setDaemonStatus(pool, "fetching", "Phase 3: API probe (3 endpoints)");

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

  console.log(`  Listing search:    ${listingStatus}`);
  console.log(`  Sale history:      ${saleStatus}`);
  console.log(`  Individual lookup: managed by csfloat-checker process`);

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
  // Track probe costs (after setListingPool since that resets counters)
  if (probe.listingSearch.available) budget.useListing(1);
  if (probe.saleHistory.available) budget.useSale(1);

  // Check minimum remaining — mark limited if we'd eat into safety buffer
  if (probe.listingSearch.available) {
    const remaining = probe.listingSearch.rateLimit.remaining ?? 200;
    if (remaining <= budget.listingSafetyBuffer) {
      console.log(`  Listing search at safety buffer (${remaining} <= ${budget.listingSafetyBuffer}) — pausing to avoid 24h lockout`);
      budget.markListingRateLimited();
    }
  } else {
    budget.markListingRateLimited();
  }

  if (!probe.saleHistory.available) {
    budget.markSaleRateLimited();
  }

  // Store for status endpoint
  const KNOWN_LISTING_LIMIT = 200;
  const KNOWN_SALE_LIMIT = 500;
  const KNOWN_INDIVIDUAL_LIMIT = 50000;
  const KNOWN_LISTING_WINDOW_S = 3600;          // Listing pool: ~1h rolling window
  const KNOWN_SALE_WINDOW_S = 24 * 3600;        // Sale pool: ~24h rolling window
  const KNOWN_INDIVIDUAL_WINDOW_S = 24 * 3600;

  const nowS = Date.now() / 1000;
  const capResetAt = (raw: number | null, windowS: number): number | null => {
    if (!raw) return null;
    const maxReset = nowS + windowS;
    return raw > maxReset ? maxReset : raw;
  };

  const cycleLB = budget.cycleListingBudget();
  const cycleSB2 = budget.cycleSaleBudget();

  // Read checker status for individual pool info (managed by csfloat-checker process)
  let individualInfo: { remaining: number | null; reset_at: number | null; available: boolean } = {
    remaining: null, reset_at: null, available: false,
  };
  try {
    const { rows: [checkerRow] } = await pool.query("SELECT value FROM sync_meta WHERE key = 'csfloat_checker_status'");
    if (checkerRow) {
      const checkerStatus = JSON.parse(checkerRow.value);
      individualInfo = {
        remaining: checkerStatus.poolRemaining,
        reset_at: checkerStatus.poolResetAt ? capResetAt(checkerStatus.poolResetAt, KNOWN_INDIVIDUAL_WINDOW_S) : null,
        available: checkerStatus.poolRemaining !== null && checkerStatus.poolRemaining > 100,
      };
    }
  } catch { /* checker may not be running yet */ }

  await setSyncMeta(pool, "api_rate_limit", JSON.stringify({
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
      remaining: individualInfo.remaining,
      reset_at: individualInfo.reset_at,
      available: individualInfo.available,
      cycle_budget: null,
      safety_buffer: 100,
      managed_by: "csfloat-checker",
    },
    detected_at: new Date().toISOString(),
  }));

  return probe;
}

export async function phase4DataFetch(
  pool: pg.Pool,
  budget: BudgetTracker,
  freshness: FreshnessTracker,
  apiKey: string,
  _wantedList: unknown[],
  probe: ApiProbeResult
) {
  console.log(`\n[${timestamp()}] Phase 4: Data Fetch`);
  await setDaemonStatus(pool, "fetching", "Phase 4: Data Fetch");
  await emitEvent(pool, "phase", "Phase 4: Data Fetch");

  const listingsAvailable = probe.listingSearch.available && !budget.isListingRateLimited();
  const salesAvailable = probe.saleHistory.available && !budget.isSaleRateLimited();

  if (!listingsAvailable && !salesAvailable) {
    console.log(`  Both listing search and sale history are rate limited — skipping fetch`);
    return;
  }

  // 4a: Sale history round-robin (500/~24h window)
  if (salesAvailable) {
    const cycleSaleBudget = budget.cycleSaleBudget();
    console.log(`  [${timestamp()}] 4a: Sale history round-robin (${budget.saleRemaining} remaining, ${cycleSaleBudget} this cycle)`);
    await setDaemonStatus(pool, "fetching", "Phase 4a: Sale history round-robin");

    try {
      const result = await syncSaleHistoryRoundRobin(pool, {
        apiKey,
        maxCalls: cycleSaleBudget,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
      });
      budget.useSale(result.fetched);
      console.log(`    Sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices (loop ${result.loopCount})`);
      if (result.sales > 0) await emitEvent(pool, "sale_history", `Round-robin: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated (loop ${result.loopCount})`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("429")) {
        console.log(`    Sales: rate limited`);
        budget.markSaleRateLimited();
      } else {
        console.error(`    Sales error: ${(err as Error).message}`);
      }
    }
  } else {
    console.log(`  [${timestamp()}] 4a: Sale history — rate limited, skipping`);
  }

  // 4b: Listing search round-robin (200/~1h window)
  if (listingsAvailable) {
    const listingBudget = budget.cycleListingBudget();
    console.log(`  [${timestamp()}] 4b: Listing search round-robin (${budget.listingRemaining} remaining, ${listingBudget} this cycle)`);
    await setDaemonStatus(pool, "fetching", "Phase 4b: Listing search round-robin");

    try {
      const result = await syncListingsRoundRobin(pool, {
        apiKey,
        maxCalls: listingBudget,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
      });
      budget.useListing(result.apiCalls);
      if (result.inserted > 0) freshness.markListingsChanged();
      console.log(`    Listings: ${result.apiCalls} calls, ${result.inserted} listings, ${result.skinsFetched} skins (loop ${result.loopCount})`);
      if (result.inserted > 0) await emitEvent(pool, "listings_fetched", `Round-robin: +${result.inserted} listings from ${result.skinsFetched} skins (loop ${result.loopCount})`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("429")) {
        budget.markListingRateLimited();
      } else {
        console.error(`    Listing fetch error: ${(err as Error).message}`);
      }
    }
  } else {
    console.log(`  [${timestamp()}] 4b: Listing search — rate limited, skipping`);
  }

  console.log(`  Data fetch done — ${budget.saleCount} sale calls (${budget.saleRemaining} remaining), ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);
}

// Phase 4.5/4.6 removed — CSFloat individual pool managed by csfloat-checker process
