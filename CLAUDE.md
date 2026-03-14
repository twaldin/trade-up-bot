# Trade-Up Bot

CS2 trade-up contract analyzer. Finds profitable knife/glove and classified→covert trade-ups using market data from CSFloat.

## Architecture

- **Frontend**: React + Vite + React Router — port 5173
  - `src/App.tsx` — routing shell, status bar, nav
  - `src/pages/TradeUpsPage.tsx` — trade-up list with URL search param sync
  - `src/components/TradeUpTable.tsx` — expandable table with outcome chart, verification
  - `src/components/DataViewer.tsx` — skin browser with scatter chart, price sources
  - `src/components/CollectionViewer.tsx` — per-collection detail (pool, theories, trade-ups)
  - `src/components/CollectionListViewer.tsx` — collection grid with filters
  - `src/components/DaemonModal.tsx` — daemon phases, rate limit bars, cycle history
  - `src/components/FilterBar.tsx` — autocomplete + range filters
  - `src/utils/format.ts` — shared formatters (timeAgo, formatDollars, condAbbr, etc.)
  - `src/hooks/useStatus.ts` — status polling hook
- **Backend**: Express API (`server/index.ts`) — port 3001 (proxied by Vite)
- **Daemon**: Knife-only worker (`server/daemon.ts` → `server/daemon-knife/`) — 7-phase loop with pessimistic theory
- **Engine**: Trade-up calculator (`server/engine.ts` barrel + `server/engine/` submodules)
- **Sync**: Data fetchers (`server/sync.ts`) — CSFloat API (listings + sale history)
- **DB**: `data/tradeup.db` (SQLite via better-sqlite3)
- **Shared types**: `shared/types.ts`

## Frontend Routes

- `/` — Knife/Gloves trade-ups (default)
- `/theories` — Theory trade-ups
- `/data` — Skin data browser (accepts `?search=` param)
- `/collections` — Collection list
- `/collections/:name` — Collection detail

Trade-up pages sync sort, order, page, and all filters to URL search params for shareable links.

## Engine Module Structure

`server/engine.ts` is a barrel file that re-exports from submodules in `server/engine/`:
- `types.ts` — shared interfaces (DbListing, ListingWithCollection, AdjustedListing, etc.)
- `core.ts` — pure math: calculateOutputFloat, calculateOutcomeProbabilities
- `data-load.ts` — DB queries: getListingsForRarity, getOutcomesForCollections, getNextRarity
- `selection.ts` — float-targeted listing selection: addAdjustedFloat, selectForFloatTarget, selectLowestFloat
- `store.ts` — TradeUpStore class for diversity-controlled result deduplication
- `evaluation.ts` — evaluateTradeUp: computes EV, profit, ROI for a set of inputs
- `db-ops.ts` — saveTradeUps, saveKnifeTradeUps, updateCollectionScores, theory tracking
- `knife-data.ts` — CASE_KNIFE_MAP, finish sets, glove generations (pure constants)
- `knife-evaluation.ts` — evaluateKnifeTradeUp, getKnifeFinishesWithPrices
- `pricing.ts` — multi-source price cache with 5-min TTL, lookup, interpolation
- `discovery.ts` — classified→covert discovery: findProfitableTradeUps
- `knife-discovery.ts` — knife/glove discovery: findProfitableKnifeTradeUps, randomKnifeExplore
- `theory-pessimistic.ts` — optimistic knife theory screener, wanted list generation

All external consumers import from `./engine.js` — never from submodules directly.

## Daemon Module Structure

`server/daemon.ts` is a thin entry point that imports from `server/daemon-knife/`:
- `index.ts` — main 7-phase loop: Housekeeping → Theory → API Probe → Data Fetch → Knife Calc → Cooldown → Re-materialize
- `state.ts` — BudgetTracker (safety buffers to avoid 12h lockout), FreshnessTracker
- `utils.ts` — logging, rate limit detection (reads X-Ratelimit-* headers), cycle stats
- `loops.ts` — cooldown loop: randomKnifeExplore + API probing every 3 passes

Old daemon code preserved on `archive/daemon-v1-full` branch.

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + calculation, resumes existing data)
npx tsx server/daemon.ts

# Daemon with fresh start (purges all trade-ups first — use when testing new logic)
npx tsx server/daemon.ts --fresh

# Frontend dev server
npm run dev
```

## Key Technical Details

- **Trade-up types**: `covert_knife` (5 Covert guns → 1 knife/glove) and `classified_covert` (10 Classified → 1 Covert)
- **Float formula**: Normalize per-input `(F-min)/(max-min)`, average, map to output range. Deterministic.
- **Probability**: Per-collection weighted by input count / total inputs
- **Price cache priority**: csfloat_sales > listing floor (lower only) > csfloat_ref > knife listing floor > condition extrapolation (★ items)
- **Price cache has 5-min TTL** — avoids redundant rebuilds during optimization loops
- **2% CSFloat seller fee** applied to all output prices

## API Keys & Rate Limits

- CSFloat: `CSFLOAT_API_KEY` in `.env` (see `.env.example`)
  - 3 independent rate limit pools: Listings (200/~30min), Sales (500/~12h), Individual (50K/~12h)
  - Safety buffers prevent hitting 0 remaining (which triggers 12h lockout on ALL pools)
  - Budget pacing: `cycleListingBudget()` / `cycleSaleBudget()` spread calls across cycles

## Coding Conventions

- TypeScript with ESM imports (`.js` extensions in imports)
- `tsx` for running TS files directly (no build step)
- SQLite queries inline with `better-sqlite3` prepared statements
- Daemon logs to `/tmp/daemon.log`
- Price values in cents (integer) throughout
- Frontend uses shared utils from `src/utils/format.ts` — no duplicate formatters
