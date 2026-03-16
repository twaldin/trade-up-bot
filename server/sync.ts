// All external consumers import from ./sync.js — never from submodules directly.

import Database from "better-sqlite3";
import { initDb } from "./db.js";
import { syncSkinData as _syncSkinData } from "./sync/skin-data.js";
import { syncSkinportPrices as _syncSkinportPrices } from "./sync/skinport.js";

// Types
export type { CSFloatListing, CSFloatSaleEntry, SkinCoverageInfo, ListingCheckResult } from "./sync/types.js";

// Utils
export { getValidConditions } from "./sync/utils.js";

// Skin data (ByMykel API)
export { syncSkinData } from "./sync/skin-data.js";

// CSFloat listing fetchers
export {
  fetchCSFloatListings,
  syncListingsForRarity,
  syncListingsDiversified,
  syncListingsForSkin,
  syncListingsByPriceRanges,
  syncLowFloatClassifiedListings,
  syncSmartListingsForRarity,
  syncPrioritizedKnifeInputs,
  syncCovertOutputListings,
  verifyTopTradeUpListings,
} from "./sync/csfloat.js";

// CSFloat sale history
export {
  fetchSaleHistory,
  syncSaleHistory,
  syncSaleHistoryForRarity,
  syncKnifeGloveSaleHistory,
} from "./sync/sales.js";

// Skinport prices
export { syncSkinportPrices } from "./sync/skinport.js";

// Listing management
export {
  purgeStaleListings,
  getSkinsNeedingCoverage,
  checkListingStaleness,
} from "./sync/listings.js";

// Wanted list (theory-guided fetching)
export { syncWantedListings } from "./sync/wanted.js";

// DMarket (listing fetch + buy + staleness)
export {
  fetchDMarketListings,
  syncDMarketListingsForSkin,
  syncDMarketListingsForRarity,
  checkDMarketStaleness,
  buyDMarketItem,
  isDMarketConfigured,
} from "./sync/dmarket.js";

// Skinport WebSocket (passive listing accumulation)
export { startSkinportListener, getSkinportStats } from "./sync/skinport-ws.js";

// Full sync: skins + prices
export async function fullSync(db: Database.Database) {
  await _syncSkinData(db);
  await _syncSkinportPrices(db);
  console.log("\nSync complete!");
}

// Run standalone
if (process.argv[1]?.endsWith("sync.ts") || process.argv[1]?.endsWith("sync.js")) {
  const db = initDb();
  fullSync(db)
    .then(() => {
      console.log("Done!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}
