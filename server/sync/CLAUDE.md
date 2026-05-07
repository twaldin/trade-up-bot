# Sync Module Reference

Data fetchers. Barrel: `server/sync.ts` re-exports submodules. External code imports from `./sync.js` only.

## Submodules
- `types.ts` — `CSFloatListing`, `CSFloatSaleEntry`, `SkinCoverageInfo`, `ListingCheckResult`, `CSFLOAT_BASE`, `HIGH_VALUE_COLLECTIONS`
- `utils.ts` — `getValidConditions`, `isListingTooOld`, `findSkinId`, `saveReferencePrices`
- `skin-data.ts` — ByMykel API → skin metadata seed
- `csfloat.ts` — CSFloat listing search (rarity / per-skin / price-range / round-robin / coverage strategies + `verifyTopTradeUpListings`)
- `sales.ts` — CSFloat `/sales` history (round-robin + per-rarity + knife/glove)
- `listings.ts` — `purgeStaleListings`, `getSkinsNeedingCoverage`, `checkListingStaleness`
- `wanted.ts` — theory-guided wanted-list fetch (used after engine flags promising skins)
- `dmarket.ts` — DMarket fetch + `buyDMarketItem` + `checkDMarketStaleness` + `isDMarketConfigured`
- `skinport.ts` — Skinport REST price feed
- `skinport-ws.ts` — Skinport WebSocket (Socket.IO + msgpack); sale observations only, no listings
- `buff.ts` — Buff.market fetcher (separate process, ~85K Covert listings; main listings table)
- `doppler-phases.ts` — Doppler-phase mapping helpers

## Source Isolation
Each market is fetched independently and tagged with `source = 'csfloat' | 'dmarket' | 'skinport' | 'buff'`. The trade-up engine treats sources as substitutable for inputs but applies source-specific rules for output pricing (see engine pricing hierarchy).

## Rate Limits
- **CSFloat** — 3 independent pools (listings 200/~1h, sales 500/~24h, individual 50K/~24h) sharing a 24h lockout if any hits zero. Daemon paces calls; csfloat-checker owns the individual pool.
- **DMarket** — 2 RPS for market search (`MIN_INTERVAL_MS = 550ms`), 6 RPS cumulative for other endpoints. Runs as a separate continuous process.
- **Skinport** — REST is hourly cache; WebSocket is passive (no auth, no quota).
- **Buff** — separate fetcher (~15 req/min).

## Strategy
- CSFloat: covert inputs + extraordinary outputs first; round-robin / smart / coverage strategies fill the rest.
- DMarket: coverage gaps + stale refresh, continuous 2 RPS.
- Skinport WS: passive sale observations into KNN feedstock — never used to claim listings.
- DMarket name verification: `cleanTitle !== skinName` rejects fuzzy matches before insert.
