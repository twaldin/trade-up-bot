# Trade-Up Bot

CS2 trade-up contract analyzer. Finds profitable trade-ups across all rarity tiers using market data from CSFloat, DMarket, and Skinport.

## Architecture

- **Frontend**: React + Vite + React Router — port 5173
  - `src/App.tsx` — routing shell, status bar, nav
  - `src/pages/TradeUpsPage.tsx` — trade-up list with URL search param sync
  - `src/components/TradeUpTable.tsx` — expandable table with outcome chart, verification
  - `src/components/DataViewer.tsx` — skin browser with scatter chart, price sources
  - `src/components/CollectionViewer.tsx` — per-collection detail
  - `src/components/CollectionListViewer.tsx` — collection grid with filters
  - `src/components/DaemonModal.tsx` — daemon phases, rate limit bars, cycle history
  - `src/components/FilterBar.tsx` — autocomplete + range filters
  - `src/utils/format.ts` — shared formatters (timeAgo, formatDollars, condAbbr, etc.)
  - `src/hooks/useStatus.ts` — status polling hook
- **Backend**: Express API (`server/index.ts`) — port 3001 (proxied by Vite)
- **Daemon**: Multi-phase loop (`server/daemon.ts` → `server/daemon-knife/`)
- **Engine**: Trade-up calculator (`server/engine.ts` barrel + `server/engine/` submodules)
- **Sync**: Data fetchers (`server/sync.ts` barrel) — CSFloat, DMarket, Skinport
- **DMarket Fetcher**: Continuous background process (`server/dmarket-fetcher.ts`) — 2 RPS
- **DB**: `data/tradeup.db` (SQLite via better-sqlite3, WAL mode)
- **Shared types**: `shared/types.ts`

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + calculation, resumes existing data)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts

# Daemon with fresh start (purges all trade-ups first — use when testing new logic)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts --fresh

# DMarket continuous fetcher (separate process, 2 RPS, logs to /tmp/dmarket-fetcher.log)
npx tsx server/dmarket-fetcher.ts

# Frontend dev server
npm run dev
```

## Engine Module Structure

`server/engine.ts` is a barrel file re-exporting from `server/engine/`:
- `types.ts` — shared interfaces, EXCLUDED_COLLECTIONS, CONDITION_BOUNDS
- `core.ts` — pure math: calculateOutputFloat, calculateOutcomeProbabilities
- `data-load.ts` — DB queries: getListingsForRarity, getOutcomesForCollections, getNextRarity
- `selection.ts` — float-targeted listing selection strategies
- `store.ts` — TradeUpStore class for diversity-controlled deduplication
- `evaluation.ts` — evaluateTradeUp: computes EV, profit, ROI for gun-skin trade-ups
- `knife-evaluation.ts` — evaluateKnifeTradeUp, getKnifeFinishesWithPrices
- `db-ops.ts` — saveTradeUps, saveClassifiedTradeUps (merge-save), revive, theory tracking
- `knife-data.ts` — CASE_KNIFE_MAP, finish sets, glove generations (pure constants)
- `pricing.ts` — multi-source price cache with 5-min TTL, lookupOutputPrice
- `fees.ts` — per-marketplace buyer/seller fee calculations
- `discovery.ts` — generic discovery: findProfitableTradeUps (any rarity via `rarities` param)
- `knife-discovery.ts` — knife/glove discovery: findProfitableKnifeTradeUps
- `theory-pessimistic.ts` — knife theory screener + deep scan
- `theory-classified.ts` — generic rarity-tier theory: generateTheoriesForTier
- `theory-validation.ts` — KNN pricing, learned prices, observation seeding
- `rarity-tiers.ts` — RarityTierConfig definitions
- `staircase.ts` — original 2-stage staircase (Classified→Covert→Knife)

**Import rule**: All external consumers import from `./engine.js` barrel — never from submodules directly.

## Daemon Phase Structure

`server/daemon-knife/phases.ts` is a barrel re-exporting from `server/daemon-knife/phases/`:
- `housekeeping.ts` — Phase 1: purge stale data, refresh listing statuses
- `theory.ts` — Phase 2: knife + classified + restricted + milspec theory generation
- `data-fetch.ts` — Phase 3-4: API probing, sale history, listing search, DMarket coverage
- `knife-calc.ts` — Phase 5: knife discovery + materialization + deep scan + rematerialization
- `classified-calc.ts` — Phase 5b-5f: classified, restricted, milspec, staircase calc

Other daemon files:
- `index.ts` — main loop orchestration, worker spawning, cycle management
- `state.ts` — BudgetTracker (safety buffers), FreshnessTracker
- `utils.ts` — logging, rate limit detection, cycle stats
- `loops.ts` — cooldown loop: staleness checks
- `calc-worker.ts` — child process for parallel discovery (NDJSON temp file IPC)

## Trade-Up Types

| Type | Inputs | Output | Input Count |
|------|--------|--------|-------------|
| `covert_knife` | 5 Covert guns | 1 Knife/Glove | 5 |
| `classified_covert` | 10 Classified | 1 Covert gun | 10 |
| `restricted_classified` | 10 Restricted | 1 Classified | 10 |
| `milspec_restricted` | 10 Mil-Spec | 1 Restricted | 10 |
| `classified_covert_st` | 10 ST Classified | 1 ST Covert | 10 |
| `staircase` | 50 Classified | 5 Covert → 1 Knife | 50 |
| `staircase_rc` | 100 Restricted | 10 Classified → 1 Covert | 100 |
| `staircase_rck` | 500 Restricted | 50 Classified → 5 Covert → 1 Knife | 500 |
| `staircase_mrc` | 1000 Mil-Spec | 100 Restricted → 10 Classified → 1 Covert | 1000 |

## Pricing System

**Output pricing** (what we'd sell for): conservative — uses LOWEST of available sources:
- CSFloat sale-based prices (highest priority, most accurate)
- DMarket listing floor (for non-knife commodity skins — reliable with many listings)
- Skinport listing floor
- CSFloat ref prices (fallback)
- Condition extrapolation (last resort, ★ items only)
- KNN float-precise pricing (★ knife/glove skins only — uses 112K+ price observations)

**Input pricing** (what we'd buy for): uses actual listing prices with marketplace buyer fees:
- CSFloat: 2.8% + $0.30 deposit fee
- DMarket: 2.5% buyer fee
- Skinport: 0% buyer fee

**Seller fees** deducted from output prices: CSFloat 2%, DMarket 2%, Skinport 12%

## API Keys & Rate Limits

- **CSFloat**: `CSFLOAT_API_KEY` in `.env`
  - 3 independent pools: Listings (200/~30min), Sales (500/~12h), Individual (50K/~12h)
  - Safety buffers prevent 12h lockout. Budget pacing spreads calls across cycles.
- **DMarket**: `DMARKET_PUBLIC_KEY` + `DMARKET_SECRET_KEY` in `.env`
  - 2 RPS (independent from CSFloat). Continuous fetcher runs as separate process.
  - Name verification on search results (DMarket search is fuzzy/substring match).
- **Skinport**: WebSocket feed (no auth, passive, no rate limits)

## Design Rules

### Architecture
- **Barrel pattern**: Engine (`engine.ts`) and Sync (`sync.ts`) are barrels. Import from barrels, not submodules.
- **Config-driven tiers**: New rarity tiers are added via `RarityTierConfig` in `rarity-tiers.ts` — no per-rarity code duplication.
- **Worker parallelization**: CPU-heavy discovery runs in child processes via `fork()`. Results via NDJSON temp files (avoids V8 string limits). Cap at 30K results per worker.
- **Separate processes**: Daemon and DMarket fetcher are independent processes sharing SQLite (WAL mode). Fetcher pauses during daemon write phases to avoid SQLITE_BUSY_SNAPSHOT.

### Pricing
- **Output prices are conservative**: use LOWEST available source, not highest. We want minimum sell price.
- **DMarket excluded from knife/glove output pricing**: thin liquidity, collector outliers. Used only for commodity gun skins.
- **DMarket excluded from output pricing entirely for ★ items**: use KNN + CSFloat only.
- **Price values in cents (integer) throughout**: no floating point for money.

### Data Quality
- **DMarket name verification**: `cleanTitle !== skinName` check prevents fuzzy match contamination (e.g., "Fade" matching "Amber Fade").
- **Dead Hand Collection excluded**: trade-locked until late March 2026, no market data.

### DB
- **WAL mode + busy_timeout=30s**: enables concurrent reads/writes between daemon and fetcher.
- **Retry with exponential backoff**: `withRetry()` wrapper on all large transactions (2/4/8/16/32s).
- **Merge-save pattern**: `saveClassifiedTradeUps()` updates existing trade-ups by signature, marks missing ones as stale. Used for knife, classified, and staircase types.
- **Clear-first save**: `saveTradeUps(clearFirst=true)` for lower-rarity tiers that rebuild fully each cycle.

### Coding Conventions
- TypeScript with ESM imports (`.js` extensions in imports)
- `tsx` for running TS files directly (no build step)
- SQLite queries inline with `better-sqlite3` prepared statements
- Daemon logs to `/tmp/daemon.log`, DMarket fetcher to `/tmp/dmarket-fetcher.log`
- No `as any` casts. All catch blocks documented with reason.
- No ASCII art headers. Simple `//` comments where needed.
