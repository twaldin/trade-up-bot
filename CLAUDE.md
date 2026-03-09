# Trade-Up Bot

CS2 trade-up contract analyzer. Finds profitable knife/glove and classified→covert trade-ups using market data from CSFloat, Steam, and Skinport.

## Architecture

- **Frontend**: React + Vite (`src/App.tsx`, `src/components/TradeUpTable.tsx`) — port 5173
- **Backend**: Express API (`server/index.ts`) — port 3001 (proxied by Vite)
- **Daemon**: Background worker (`server/daemon.ts`) — fetches market data, calculates trade-ups
- **Engine**: Trade-up calculator (`server/engine.ts` + `server/engine/`) — core math, discovery, optimization
- **Sync**: Data fetchers (`server/sync.ts`) — CSFloat API, Steam Market, Skinport
- **DB**: `data/tradeup.db` (SQLite via better-sqlite3)
- **Shared types**: `shared/types.ts`

## Engine Module Structure

`server/engine.ts` is a slim barrel file (~88 lines) that re-exports from submodules in `server/engine/`:
- `types.ts` — shared interfaces (DbListing, ListingWithCollection, AdjustedListing, etc.)
- `core.ts` — pure math: calculateOutputFloat, calculateOutcomeProbabilities
- `data-load.ts` — DB queries: getListingsForRarity, getOutcomesForCollections, getNextRarity
- `selection.ts` — float-targeted listing selection: addAdjustedFloat, selectForFloatTarget, selectLowestFloat
- `store.ts` — TradeUpStore class for diversity-controlled result deduplication
- `evaluation.ts` — evaluateTradeUp: computes EV, profit, ROI for a set of inputs
- `db-ops.ts` — saveTradeUps, saveKnifeTradeUps, updateCollectionScores
- `knife-data.ts` — CASE_KNIFE_MAP, finish sets, glove generations (pure constants)
- `knife-evaluation.ts` — evaluateKnifeTradeUp, getKnifeFinishesWithPrices
- `pricing.ts` — multi-source price cache with 5-min TTL, lookup, interpolation
- `discovery.ts` — classified→covert discovery: findProfitableTradeUps, optimizeTradeUps, anchorSpikeExplore, deepOptimize, randomExplore, findFNTradeUps
- `knife-discovery.ts` — knife/glove discovery: findProfitableKnifeTradeUps, randomKnifeExplore
- `strategies.ts` — tier-2 strategies: findTradeUpsForTargetOutputs, optimizeConditionBreakpoints, findStatTrakKnifeTradeUps, huntBudgetRange

All external consumers import from `./engine.js` — never from submodules directly.

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + calculation)
npx tsx server/daemon.ts

# Frontend dev server
npm run dev

# Manual budget hunt
npx tsx server/run-hunt.ts
npx tsx server/run-focused-hunt.ts
```

## Key Technical Details

- **Trade-up types**: `covert_knife` (5 Covert guns → 1 knife/glove) and `classified_covert` (10 Classified → 1 Covert)
- **Float formula**: Normalize per-input `(F-min)/(max-min)`, average, map to output range. Deterministic.
- **Probability**: Per-collection weighted by input count / total inputs
- **Price cache priority**: csfloat_sales > listing floor > csfloat_ref > steam > skinport
- **Price cache has 5-min TTL** — avoids redundant rebuilds during optimization loops

## API Keys & Rate Limits

- CSFloat: `CSFLOAT_API_KEY` in `.env`, 500 requests per rate-limit window
- Steam Market: free, no auth, ~10-20 req/min
- Skinport: free, no auth, single bulk endpoint

## Active Monitoring Sessions

This project uses autonomous monitoring sessions where Claude:
1. Runs the daemon in background, monitors its progress
2. Executes budget hunts with varying parameters to find profitable trade-ups
3. Analyzes results and adjusts strategies
4. Refactors/optimizes code during API rate-limit downtimes
5. Maintains `notes.md` in project root with findings and session status

When resuming a monitoring session:
- Check `notes.md` for previous session status and pending tasks
- Check daemon status: `ps aux | grep daemon` and `tail /tmp/daemon.log`
- Query DB for current trade-up stats: `sqlite3 data/tradeup.db "SELECT type, COUNT(*), SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) FROM trade_ups GROUP BY type;"`
- Continue hunting, optimizing, or refactoring based on what's needed

## Coding Conventions

- TypeScript with ESM imports (`.js` extensions in imports)
- `tsx` for running TS files directly (no build step)
- SQLite queries inline with `better-sqlite3` prepared statements
- Daemon logs to `/tmp/daemon.log`
- Price values in cents (integer) throughout
