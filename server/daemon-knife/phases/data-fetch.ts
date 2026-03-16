/**
 * Phase 3: API Probe — rate limit detection across all 3 CSFloat pools.
 * Phase 4: Data Fetch — sale history, listings, theory-guided wanted list.
 * Phase 4.5: Verify profitable inputs via individual lookup pool.
 */

import { initDb, setSyncMeta, emitEvent } from "../../db.js";
import {
  syncKnifeGloveSaleHistory,
  syncSaleHistory,
  syncSaleHistoryForRarity,
  syncPrioritizedKnifeInputs,
  syncSmartListingsForRarity,
  syncCovertOutputListings,
  syncWantedListings,
  checkListingStaleness,
  syncDMarketListingsForRarity,
  syncDMarketListingsForSkin,
  isDMarketConfigured,
} from "../../sync.js";
import type { WantedListing } from "../../engine.js";

import { BudgetTracker, FreshnessTracker } from "../state.js";
import {
  timestamp, setDaemonStatus,
  probeApiRateLimits,
  type RateLimitInfo, type ApiProbeResult,
} from "../utils.js";

export async function phase3ApiProbe(
  db: ReturnType<typeof initDb>,
  budget: BudgetTracker,
  apiKey: string
): Promise<ApiProbeResult> {
  console.log(`\n[${timestamp()}] Phase 3: API Probe`);
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
  console.log(`\n[${timestamp()}] Phase 4: Data Fetch`);
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

    // Split cycle budget: 40% knife/gloves, 20% covert guns, 20% classified, 20% ST coverts
    // Sale pool is 500/12h — at ~3 cycles/hr we have 14/cycle. Use it all.
    // Minimum 3 per category ensures we actually make progress on each.
    setDaemonStatus(db, "fetching", "Phase 4a: Knife/Glove sale history");
    // Sale budget: 30% knife, 15% covert, 15% ST covert, 15% classified, 15% restricted, 10% milspec
    const knifeSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.30)));
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
    const covertSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.15)));
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

    // Classified skin sale history (needed for KNN pricing of classified inputs)
    setDaemonStatus(db, "fetching", "Phase 4a: Classified sale history");
    const classifiedSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.15)));
    if (classifiedSaleBudget >= 1) {
      try {
        const result = await syncSaleHistoryForRarity(db, "Classified", {
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

    // Restricted sale history (biggest data gap — only 123/305 skins have sale obs)
    const restrictedSaleBudget = Math.min(budget.saleRemaining, Math.max(2, Math.floor(cycleSaleBudget * 0.15)));
    if (restrictedSaleBudget >= 1) {
      try {
        const result = await syncSaleHistoryForRarity(db, "Restricted", {
          apiKey,
          maxCalls: restrictedSaleBudget,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
        });
        budget.useSale(result.fetched);
        console.log(`    Restricted sales: ${result.fetched} calls, ${result.sales} sales, ${result.pricesUpdated} prices`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("429")) console.log(`    Restricted sales: rate limited`);
        else console.error(`    Restricted sales error: ${(err as Error).message}`);
      }
    }

    // Mil-Spec sale history (4/438 skins with sale obs — start building)
    const milspecSaleBudget = Math.min(budget.saleRemaining, Math.max(1, Math.floor(cycleSaleBudget * 0.10)));
    if (milspecSaleBudget >= 1) {
      try {
        const result = await syncSaleHistoryForRarity(db, "Mil-Spec", {
          apiKey,
          maxCalls: milspecSaleBudget,
          onProgress: (msg) => setDaemonStatus(db, "fetching", msg),
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

    // Budget allocation: coverage-first, theory-guided wanted as supplement.
    // Good theory requires good coverage — invest in broad data before targeted fetching.
    // At 15-min cycles: ~90-100 calls/cycle from 200/30min pool.
    let knifeInputCalls: number, classifiedInputCalls: number, outputCalls: number, wantedCalls: number;
    if (listingBudget < 20) {
      knifeInputCalls = 0; classifiedInputCalls = 0; outputCalls = 0;
      wantedCalls = listingBudget;
    } else {
      knifeInputCalls = Math.floor(listingBudget * 0.25);   // 25% — Covert gun coverage (160 skins missing)
      classifiedInputCalls = Math.floor(listingBudget * 0.15); // 15% — Classified coverage
      outputCalls = Math.floor(listingBudget * 0.30);        // 30% — knife/glove output pricing (critical)
      wantedCalls = listingBudget - knifeInputCalls - classifiedInputCalls - outputCalls; // ~30% remainder
      wantedCalls = Math.min(wantedCalls, wantedList.length); // Don't waste calls if wanted list is small
      // Redistribute unused wanted calls back to coverage
      const unused = (listingBudget - knifeInputCalls - classifiedInputCalls - outputCalls) - wantedCalls;
      if (unused > 0) { knifeInputCalls += Math.floor(unused / 2); outputCalls += unused - Math.floor(unused / 2); }
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
        const result = await syncSmartListingsForRarity(db, "Classified", {
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

      // Lower-rarity coverage — DMarket is the PRIMARY source for these
      const restrictedResult = await syncDMarketListingsForRarity(db, "Restricted", {
        maxSkinsPerCall: 12,
        maxListingsPerSkin: 30,
        onProgress: (msg) => setDaemonStatus(db, "fetching", `DMarket Restricted: ${msg}`),
      });
      dmCoverageInserted += restrictedResult.listingsInserted;

      const milspecResult = await syncDMarketListingsForRarity(db, "Mil-Spec", {
        maxSkinsPerCall: 12,
        maxListingsPerSkin: 30,
        onProgress: (msg) => setDaemonStatus(db, "fetching", `DMarket Mil-Spec: ${msg}`),
      });
      dmCoverageInserted += milspecResult.listingsInserted;

      if (dmCoverageInserted > 0) freshness.markListingsChanged();
      const totalSkinsChecked = covertResult.skinsChecked + classifiedResult.skinsChecked + restrictedResult.skinsChecked + milspecResult.skinsChecked;
      console.log(`    DMarket coverage: ${totalSkinsChecked} skins, ${dmCoverageInserted} listings (R:${restrictedResult.listingsInserted} MS:${milspecResult.listingsInserted})`);

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
    console.log(`\n[${timestamp()}] Phase 4.5: Skipped (individual pool exhausted)`);
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

  console.log(`\n[${timestamp()}] Phase 4.5: Verify profitable inputs (${profitableInputCount} listings, checking ${maxVerify})`);
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
