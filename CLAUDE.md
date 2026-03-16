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
- **Daemon**: Discovery loop (`server/daemon.ts` → `server/daemon-knife/`)
- **Engine**: Trade-up calculator (`server/engine.ts` barrel + `server/engine/` submodules)
- **Sync**: Data fetchers (`server/sync.ts` barrel) — CSFloat, DMarket, Skinport
- **DMarket Fetcher**: Continuous background process (`server/dmarket-fetcher.ts`) — 2 RPS
- **DB**: `data/tradeup.db` (SQLite via better-sqlite3, WAL mode)
- **Shared types**: `shared/types.ts`

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + discovery, resumes existing data)
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
- `selection.ts` — float-targeted listing selection strategies (dense condition-boundary targets)
- `store.ts` — TradeUpStore class for diversity-controlled deduplication (profit + chance-to-profit scoring)
- `evaluation.ts` — evaluateTradeUp: computes EV, profit, ROI, chance_to_profit for gun-skin trade-ups
- `knife-evaluation.ts` — evaluateKnifeTradeUp, getKnifeFinishesWithPrices
- `db-ops.ts` — saveTradeUps, mergeTradeUps (merge-save with profit streak tracking), revive functions
- `knife-data.ts` — CASE_KNIFE_MAP, finish sets, glove generations (pure constants)
- `pricing.ts` — multi-source price cache with 5-min TTL, lookupOutputPrice (CSFloat-primary with gap-fill)
- `knn-pricing.ts` — KNN float-precise output pricing for knife/glove skins, observation management
- `fees.ts` — per-marketplace buyer/seller fee calculations
- `discovery.ts` — generic discovery: findProfitableTradeUps (any rarity via `rarities` param), randomExplore
- `knife-discovery.ts` — knife/glove discovery: findProfitableKnifeTradeUps, randomKnifeExplore
- `rarity-tiers.ts` — RarityTierConfig definitions
- `staircase.ts` — 2-stage staircase (50 Classified → 5 Covert → 1 Knife)

**Import rule**: All external consumers import from `./engine.js` barrel — never from submodules directly.

## Daemon Phase Structure

`server/daemon-knife/phases.ts` is a barrel re-exporting from `server/daemon-knife/phases/`:
- `housekeeping.ts` — Phase 1: purge stale data, refresh listing statuses, snapshot observations
- `data-fetch.ts` — Phase 3-4: API probing, sale history, CSFloat listing search (Covert + Extraordinary only), DMarket coverage
- `knife-calc.ts` — Phase 5: knife discovery + random knife exploration + revival
- `classified-calc.ts` — Phase 5b-5f: classified, restricted, milspec discovery + staircase calc

Other daemon files:
- `index.ts` — main loop orchestration, worker spawning, cycle management
- `state.ts` — BudgetTracker (safety buffers), FreshnessTracker, 10-min cycle target
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
| `staircase` | 50 Classified | 5 Covert → 1 Knife | 50 |

## Pricing System

**Output pricing** (what we'd sell for): CSFloat-primary, conservative:
- CSFloat sale-based prices (highest priority, most accurate)
- DMarket listing floor (gap-fill for non-knife commodity skins, min 2 listings)
- Skinport listing floor (gap-fill, min 2 volume)
- CSFloat ref prices (fallback)
- Condition extrapolation (last resort, ★ items only)
- KNN float-precise pricing (★ knife/glove skins only — uses 120K+ price observations)

**Input pricing** (what we'd buy for): actual listing prices with marketplace buyer fees:
- CSFloat: 2.8% + $0.30 deposit fee
- DMarket: 2.5% buyer fee
- Skinport: 0% buyer fee

**Seller fees** deducted from output prices: CSFloat 2%, DMarket 2%, Skinport 12%

## Data Fetching Strategy

All fetching is **coverage-based** — no theory-guided wanted lists.

| Source | Strategy | Budget |
|--------|----------|--------|
| CSFloat | Covert inputs + Extraordinary outputs only | ~66 calls/10-min cycle (200/30min pool) |
| DMarket | Coverage gaps (Restricted priority) + stale refresh | 2 RPS continuous (separate process) |
| Skinport | Passive WebSocket (no auth, no rate limits) | Continuous |

CSFloat's scarce 200/30min budget is spent exclusively on Covert gun skins (discovery inputs) and Extraordinary skins (knife/glove output pricing). DMarket handles all lower rarities at 2 RPS.

## API Keys & Rate Limits

- **CSFloat**: `CSFLOAT_API_KEY` in `.env`
  - 3 independent pools: Listings (200/~30min), Sales (500/~12h), Individual (50K/~12h)
  - Safety buffers prevent 12h lockout. Budget pacing spreads calls across 10-min cycles.
- **DMarket**: `DMARKET_PUBLIC_KEY` + `DMARKET_SECRET_KEY` in `.env`
  - 2 RPS (independent from CSFloat). Continuous fetcher runs as separate process.
  - Name verification on search results (DMarket search is fuzzy/substring match).
- **Skinport**: WebSocket feed (no auth, passive, no rate limits)

## Design Rules

### Architecture
- **Barrel pattern**: Engine (`engine.ts`) and Sync (`sync.ts`) are barrels. Import from barrels, not submodules.
- **Discovery-only**: All profitable trade-ups come from exhaustive discovery over real listings. No theory/materialization.
- **Config-driven tiers**: Rarity tiers defined via `RarityTierConfig` in `rarity-tiers.ts`.
- **Worker parallelization**: CPU-heavy discovery runs in child processes via `fork()`. Results via NDJSON temp files. Cap at 30K results per worker.
- **Separate processes**: Daemon and DMarket fetcher are independent processes sharing SQLite (WAL mode). Fetcher pauses during daemon write phases.

### Pricing
- **Output prices are CSFloat-primary**: highest confidence source. DMarket/Skinport gap-fill only when CSFloat has no data.
- **DMarket excluded from ★ item output pricing**: thin liquidity, collector outliers.
- **Price values in cents (integer) throughout**: no floating point for money.
- **Chance-to-profit as first-class metric**: trade-ups with >25% chance to profit are kept even with negative EV.

### Data Quality
- **DMarket name verification**: `cleanTitle !== skinName` check prevents fuzzy match contamination.
- **Dead Hand Collection excluded**: trade-locked until late March 2026.

### DB
- **WAL mode + busy_timeout=30s**: enables concurrent reads/writes between daemon and fetcher.
- **Retry with exponential backoff**: `withRetry()` wrapper on large transactions (2/4/8/16/32s).
- **Merge-save pattern**: `mergeTradeUps()` updates existing trade-ups by signature, marks missing as stale. Used for all types. Tracks profit streaks (consecutive profitable cycles).
- **30K cap** per type for lower-rarity tiers to prevent OOM from merge-save accumulation.

### Coding Conventions
- TypeScript with ESM imports (`.js` extensions in imports)
- `tsx` for running TS files directly (no build step)
- SQLite queries inline with `better-sqlite3` prepared statements
- Daemon logs to `/tmp/daemon.log`, DMarket fetcher to `/tmp/dmarket-fetcher.log`
- No `as any` casts. All catch blocks documented with reason.
