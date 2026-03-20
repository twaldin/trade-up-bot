/**
 * Phase 3: API Probe — rate limit detection across all 3 CSFloat pools.
 * Phase 4: Data Fetch — sale history, listings, theory-guided wanted list.
 * Phase 4.5: Verify profitable inputs via individual lookup pool.
 */

import pg from "pg";
import { setSyncMeta, emitEvent } from "../../db.js";
import {
  syncKnifeGloveSaleHistory,
  syncSaleHistory,
  syncSaleHistoryForRarity,
  syncPrioritizedKnifeInputs,
  syncSmartListingsForRarity,
  syncCovertOutputListings,
  syncDMarketListingsForRarity,
  isDMarketConfigured,
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
      console.log(`  Listing search at safety buffer (${remaining} <= ${budget.listingSafetyBuffer}) — pausing to avoid 12h lockout`);
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
  const KNOWN_LISTING_WINDOW_S = 12 * 3600;
  const KNOWN_SALE_WINDOW_S = 12 * 3600;
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

  // 4a: Sale history (500/~12h window — independent from listing search)
  if (salesAvailable) {
    const cycleSaleBudget = budget.cycleSaleBudget();
    console.log(`  [${timestamp()}] 4a: Sale history (${budget.saleRemaining} remaining, ${cycleSaleBudget} this cycle)`);

    await setDaemonStatus(pool, "fetching", "Phase 4a: Knife/Glove sale history");
    const knifeSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.30)));
    if (knifeSaleBudget >= 2) {
      try {
        const result = await syncKnifeGloveSaleHistory(pool, {
          apiKey,
          maxCalls: knifeSaleBudget,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Knife sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) await emitEvent(pool, "sale_history", `Knife/glove: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Knife sales: rate limited, moving on`);
        else console.error(`    Knife sales error: ${(err as Error).message}`);
      }
    }

    await setDaemonStatus(pool, "fetching", "Phase 4a: Covert gun sale history");
    const covertSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.15)));
    if (covertSaleBudget >= 1) {
      try {
        const result = await syncSaleHistory(pool, {
          apiKey,
          maxCalls: covertSaleBudget,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Covert sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) await emitEvent(pool, "sale_history", `Covert guns: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Covert sales: rate limited, moving on`);
        else console.error(`    Covert sales error: ${(err as Error).message}`);
      }
    }

    await setDaemonStatus(pool, "fetching", "Phase 4a: Classified sale history");
    const classifiedSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.15)));
    if (classifiedSaleBudget >= 1) {
      try {
        const result = await syncSaleHistoryForRarity(pool, "Classified", {
          apiKey,
          maxCalls: classifiedSaleBudget,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Classified sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
        if (result.sales > 0) await emitEvent(pool, "sale_history", `Classified: ${result.sales} sales fetched, ${result.pricesUpdated} prices updated`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Classified sales: rate limited, moving on`);
        else console.error(`    Classified sales error: ${(err as Error).message}`);
      }
    }

    const restrictedSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.15)));
    if (restrictedSaleBudget >= 1) {
      try {
        const result = await syncSaleHistoryForRarity(pool, "Restricted", {
          apiKey,
          maxCalls: restrictedSaleBudget,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Restricted sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Restricted sales: rate limited`);
        else console.error(`    Restricted sales error: ${(err as Error).message}`);
      }
    }

    const milspecSaleBudget = Math.min(budget.saleRemaining, Math.max(1, Math.floor(cycleSaleBudget * 0.10)));
    if (milspecSaleBudget >= 1) {
      try {
        const result = await syncSaleHistoryForRarity(pool, "Mil-Spec", {
          apiKey,
          maxCalls: milspecSaleBudget,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Mil-Spec sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Mil-Spec sales: rate limited`);
        else console.error(`    Mil-Spec sales error: ${(err as Error).message}`);
      }
    }
  } else {
    console.log(`  [${timestamp()}] 4a: Sale history — rate limited, skipping`);
  }

  // 4b: Listing search (200/~30min window — paced across cycles)
  if (listingsAvailable) {
    const listingBudget = budget.cycleListingBudget();
    console.log(`  [${timestamp()}] 4b: Listing search (${budget.listingRemaining} remaining, ${listingBudget} this cycle)`);

    let knifeInputCalls: number, classifiedInputCalls: number, outputCalls: number, wantedCalls: number;
    let coverageCalls = 0;
    if (listingBudget < 10) {
      knifeInputCalls = listingBudget; classifiedInputCalls = 0; outputCalls = 0;
      wantedCalls = 0;
    } else {
      knifeInputCalls = Math.floor(listingBudget * 0.20);
      outputCalls = Math.floor(listingBudget * 0.15);
      coverageCalls = listingBudget - knifeInputCalls - outputCalls;
      classifiedInputCalls = Math.floor(coverageCalls * 0.20);
      const restrictedCalls = Math.floor(coverageCalls * 0.25);
      const milspecCalls = Math.floor(coverageCalls * 0.30);
      const industrialCalls = coverageCalls - classifiedInputCalls - restrictedCalls - milspecCalls;

      wantedCalls = 0;
      console.log(`    Budget: ${knifeInputCalls} knife + ${outputCalls} output + ${classifiedInputCalls} classified + ${restrictedCalls} restricted + ${milspecCalls} milspec + ${industrialCalls} industrial = ${listingBudget} (50/50 profit/coverage)`);

      budget.setLowerRarityBudgets(restrictedCalls, milspecCalls, industrialCalls);
    }

    await setDaemonStatus(pool, "fetching", "Phase 4b: Prioritized knife inputs");
    if (knifeInputCalls >= 5) {
      try {
        const result = await syncPrioritizedKnifeInputs(pool, {
          apiKey,
          maxCalls: knifeInputCalls,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Knife inputs: ${result.apiCalls} calls, ${result.inserted} listings, ${result.collectionsServed} collections`);
        if (result.inserted > 0) await emitEvent(pool, "listings_fetched", `Knife inputs: +${result.inserted} listings from ${result.collectionsServed} collections`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Knife input fetch error: ${(err as Error).message}`);
      }
    }

    if (!budget.isListingRateLimited() && classifiedInputCalls >= 3) {
      await setDaemonStatus(pool, "fetching", "Phase 4b: Classified inputs");
      try {
        const result = await syncSmartListingsForRarity(pool, "Classified", {
          apiKey,
          maxCalls: classifiedInputCalls,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Classified inputs: ${result.apiCalls} calls, ${result.inserted} listings`);
        if (result.inserted > 0) await emitEvent(pool, "listings_fetched", `Classified: +${result.inserted} listings`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Classified input fetch error: ${(err as Error).message}`);
      }
    }

    if (!budget.isListingRateLimited() && outputCalls >= 5) {
      await setDaemonStatus(pool, "fetching", "Phase 4b: Output listings");
      try {
        const result = await syncCovertOutputListings(pool, {
          apiKey,
          maxCalls: outputCalls,
          onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
        });
        budget.useListing(result.apiCalls);
        if (result.inserted > 0) freshness.markListingsChanged();
        console.log(`    Outputs: ${result.apiCalls} calls, ${result.inserted} listings`);
        if (result.inserted > 0) await emitEvent(pool, "listings_fetched", `Outputs: +${result.inserted} knife/glove listings`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        else console.error(`    Output fetch error: ${(err as Error).message}`);
      }
    }

    const restrictedCalls = budget.restrictedCalls;
    const milspecCalls = budget.milspecCalls;
    const industrialCalls = budget.industrialCalls;
    const consumerCalls = Math.max(2, Math.floor(industrialCalls / 2));

    for (const [rarity, calls] of [["Restricted", restrictedCalls], ["Mil-Spec", milspecCalls], ["Industrial Grade", industrialCalls - consumerCalls], ["Consumer Grade", consumerCalls]] as const) {
      if (!budget.isListingRateLimited() && calls >= 2) {
        await setDaemonStatus(pool, "fetching", `Phase 4b: ${rarity} coverage`);
        try {
          const result = await syncSmartListingsForRarity(pool, rarity, {
            apiKey,
            maxCalls: calls,
            onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
          });
          budget.useListing(result.apiCalls);
          if (result.inserted > 0) freshness.markListingsChanged();
          if (result.inserted > 0) console.log(`    ${rarity}: ${result.apiCalls} calls, ${result.inserted} listings`);
        } catch (err) {
          if (err instanceof Error && err.message.includes("429")) budget.markListingRateLimited();
        }
      }
    }
  } else {
    console.log(`  [${timestamp()}] 4b: Listing search — rate limited, skipping`);
  }

  // 4d: DMarket listings (independent API — 2 RPS, doesn't use CSFloat budget)
  if (isDMarketConfigured()) {
    console.log(`  [${timestamp()}] 4d: DMarket listing fetch`);
    await setDaemonStatus(pool, "fetching", "Phase 4d: DMarket listings");
    let dmCoverageInserted = 0;

    try {
      await setDaemonStatus(pool, "fetching", "Phase 4d: DMarket coverage");
      const covertResult = await syncDMarketListingsForRarity(pool, "Covert", {
        maxSkinsPerCall: 8,
        maxListingsPerSkin: 50,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", `DMarket: ${msg}`),
      });
      dmCoverageInserted += covertResult.listingsInserted;

      const classifiedResult = await syncDMarketListingsForRarity(pool, "Classified", {
        maxSkinsPerCall: 8,
        maxListingsPerSkin: 50,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", `DMarket: ${msg}`),
      });
      dmCoverageInserted += classifiedResult.listingsInserted;

      const restrictedResult = await syncDMarketListingsForRarity(pool, "Restricted", {
        maxSkinsPerCall: 12,
        maxListingsPerSkin: 30,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", `DMarket Restricted: ${msg}`),
      });
      dmCoverageInserted += restrictedResult.listingsInserted;

      const milspecResult = await syncDMarketListingsForRarity(pool, "Mil-Spec", {
        maxSkinsPerCall: 12,
        maxListingsPerSkin: 30,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", `DMarket Mil-Spec: ${msg}`),
      });
      dmCoverageInserted += milspecResult.listingsInserted;

      if (dmCoverageInserted > 0) freshness.markListingsChanged();
      const totalSkinsChecked = covertResult.skinsChecked + classifiedResult.skinsChecked + restrictedResult.skinsChecked + milspecResult.skinsChecked;
      console.log(`    DMarket coverage: ${totalSkinsChecked} skins, ${dmCoverageInserted} listings (R:${restrictedResult.listingsInserted} MS:${milspecResult.listingsInserted})`);

      if (dmCoverageInserted > 0) {
        await emitEvent(pool, "listings_fetched", `DMarket: +${dmCoverageInserted} listings`);
      }
    } catch (err) {
      console.error(`    DMarket fetch error: ${(err as Error).message}`);
    }
  }

  console.log(`  Data fetch done — ${budget.saleCount} sale calls (${budget.saleRemaining} remaining), ${budget.listingCount} listing calls (${budget.listingRemaining} remaining)`);
}

// Phase 4.5/4.6 removed — CSFloat individual pool managed by csfloat-checker process
