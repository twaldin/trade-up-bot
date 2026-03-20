# Trade-Up Bot

CS2 trade-up contract analyzer. Finds profitable trade-ups across all rarity tiers using market data from CSFloat, DMarket, and Skinport.

## Architecture

- **Frontend**: React + Vite + React Router — port 5173
  - `src/App.tsx` — routing shell, status bar, nav
  - `src/pages/TradeUpsPage.tsx` — trade-up list with URL search param sync, claim/verify state
  - `src/pages/LandingPage.tsx` — public landing page with pricing, features, stats
  - `src/components/TradeUpTable.tsx` — expandable table with outcome chart, verification, claims
  - `src/components/DataViewer.tsx` — skin browser with scatter chart, price sources
  - `src/components/CollectionViewer.tsx` — per-collection detail
  - `src/components/CollectionListViewer.tsx` — collection grid with filters
  - `src/components/DaemonModal.tsx` — daemon phases, rate limit bars, cycle history
  - `src/components/FilterBar.tsx` — autocomplete + range filters
  - `src/utils/format.ts` — shared formatters (timeAgo, formatDollars, condAbbr, etc.)
  - `src/hooks/useStatus.ts` — status polling hook
- **Backend**: Express API (`server/index.ts`) — port 3001 (proxied by Vite)
  - `server/routes/trade-ups.ts` — trade-up list, verify endpoint, rate limits
  - `server/routes/claims.ts` — claim/release system, Redis-backed
  - `server/routes/stripe.ts` — Stripe checkout, webhooks, billing portal
  - `server/auth.ts` — Steam OpenID, sessions, tier config
- **Daemon**: Discovery loop (`server/daemon.ts` → `server/daemon/`)
- **Engine**: Trade-up calculator (`server/engine.ts` barrel + `server/engine/` submodules)
- **Sync**: Data fetchers (`server/sync.ts` barrel) — CSFloat, DMarket, Skinport
- **DMarket Fetcher**: Continuous background process (`server/dmarket-fetcher.ts`) — 2 RPS
- **CSFloat Checker**: Continuous staleness checker (`server/csfloat-checker.ts`) — ~35/min from 50K/24h individual pool
- **DB**: PostgreSQL 16 (`tradeupbot` database via `pg` async driver). Sessions: SQLite (`data/sessions.db`)
- **Redis**: localhost:6379 — cache (trade-up lists, claims, rate limits)
- **Shared types**: `shared/types.ts`

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + discovery, resumes existing data)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts

# Daemon with fresh start (purges all trade-ups + flushes Redis cache)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts --fresh

# DMarket continuous fetcher (separate process, 2 RPS, logs to /tmp/dmarket-fetcher.log)
npx tsx server/dmarket-fetcher.ts

# CSFloat staleness checker (separate process, ~35/min, logs to /tmp/csfloat-checker.log)
npx tsx server/csfloat-checker.ts

# Frontend dev server
npm run dev
```

## Engine Module Structure

`server/engine.ts` is a barrel file re-exporting from `server/engine/`:
- `types.ts` — shared interfaces, EXCLUDED_COLLECTIONS, CONDITION_BOUNDS
- `core.ts` — pure math: calculateOutputFloat, calculateOutcomeProbabilities
- `data-load.ts` — DB queries: getListingsForRarity (filters claimed listings), getOutcomesForCollections, getNextRarity
- `selection.ts` — float-targeted listing selection strategies (dense condition-boundary targets)
- `store.ts` — TradeUpStore class for diversity-controlled deduplication (profit + chance-to-profit scoring, hasSig for pre-eval skipping)
- `evaluation.ts` — evaluateTradeUp: computes EV, profit, ROI, chance_to_profit for gun-skin trade-ups
- `knife-evaluation.ts` — evaluateKnifeTradeUp, getKnifeFinishesWithPrices
- `db-ops.ts` — saveTradeUps, mergeTradeUps (merge-save with profit streak tracking), revive functions, refreshListingStatuses
- `knife-data.ts` — CASE_KNIFE_MAP, finish sets, glove generations (pure constants)
- `pricing.ts` — multi-source price cache with 5-min TTL, lookupOutputPrice (CSFloat-primary with gap-fill)
- `knn-pricing.ts` — KNN float-precise output pricing for knife/glove skins, observation management
- `fees.ts` — per-marketplace buyer/seller fee calculations
- `discovery.ts` — findProfitableTradeUps (time-aware, sig-skipping), randomExplore, exploreWithBudget
- `knife-discovery.ts` — findProfitableKnifeTradeUps (time-aware), randomKnifeExplore, exploreKnifeWithBudget
- `rarity-tiers.ts` — RarityTierConfig definitions
- `staircase.ts` — 2-stage staircase (50 Classified → 5 Covert → 1 Knife)

**Import rule**: All external consumers import from `./engine.js` barrel — never from submodules directly.

## Daemon: Time-Bounded Discovery Engine

`server/daemon/index.ts` runs the main cycle loop:

```
Phase 1: Housekeeping (purge stale, refresh listing statuses, snapshot observations)
Phase 3: API Probe (rate limit detection for listing + sale pools)
Phase 4: Data Fetch (sale history, listings, DMarket coverage)
Phase 4b: Recalc trade-up costs from price updates
Phase 5: TIME-BOUNDED ENGINE (all remaining time, ~17 min)
  └─ Repeating super-batches until cycle target:
     ├─ Round 1: knife + classified workers (dynamic time limit)
     ├─ Round 2: restricted + milspec workers (2 min)
     ├─ Round 3: industrial + consumer workers (2 min)
     ├─ Merge results (mergeTradeUps per tier)
     ├─ Handle expired claims (clear claimed_by, check if purchased)
     ├─ Revival (200 gun + 200 knife)
     ├─ Staleness checks (75 listings, budget-adjusted by user verify calls)
     └─ DMarket staleness (every other batch)
```

Workers (`server/daemon/calc-worker.ts`): child processes via fork(), read-only DB. Each worker:
1. Loads existing signatures from DB
2. Runs structured discovery with deadline (60% of time budget)
   - Pre-eval sig-skipping: checks signature BEFORE calling evaluateTradeUp
   - Time-aware: exits loops early when deadline hits, returns partial results
3. Runs deep exploration with remaining time (exploreWithBudget / exploreKnifeWithBudget)
   - 7 strategies: random pairs, condition-pure, float-targeted, cross-condition, etc.
4. Returns combined results via NDJSON

Dynamic time limits: first super-batch gets remaining/3 (up to 5 min), subsequent batches get 2 min minimum. Kill timeout at workerTimeLimit + 30s.

Other daemon files:
- `state.ts` — BudgetTracker (safety buffers), FreshnessTracker, 30-min cycle target (TARGET_CYCLE_MS)
- `utils.ts` — logging, rate limit detection, cycle stats
- `phases/` — phase implementations (housekeeping, data-fetch, knife-calc, classified-calc)

## Trade-Up Types

| Type | Inputs | Output | Input Count |
|------|--------|--------|-------------|
| `covert_knife` | 5 Covert guns | 1 Knife/Glove | 5 |
| `classified_covert` | 10 Classified | 1 Covert gun | 10 |
| `restricted_classified` | 10 Restricted | 1 Classified | 10 |
| `milspec_restricted` | 10 Mil-Spec | 1 Restricted | 10 |
| `staircase` | 50 Classified | 5 Covert → 1 Knife | 50 |

## Claims & Verification

### Claims (Pro tier, 10/hour)
- `POST /api/trade-ups/:id/claim` — locks listing IDs for 30 min
- `DELETE /api/trade-ups/:id/claim` — releases claim early
- `claimed_by` + `claimed_at` columns on listings table
- Listing-level conflict detection: rejects if any listing already claimed
- Claimed listings filtered from discovery (`AND claimed_by IS NULL`)
- Propagates partial status to all trade-ups sharing claimed listings
- On release: restores listing_status to active if all listings available
- On expiry: daemon clears claimed_by, engine staleness checks if purchased
- Redis `active_claims` key (300s TTL) is source of truth for reads

### Verification (Basic 10/hr, Pro 20/hr)
- `POST /api/verify-trade-up/:id` — checks all input listings via CSFloat/DMarket API
- Propagates sold/delisted status to ALL trade-ups sharing deleted listings
- Records sale observations for KNN training
- Recalculates trade-up cost if prices changed
- Tracks verify API calls in Redis counter for daemon budget adjustment

### Rate Limiting
- Redis-backed: `checkRateLimit()` / `getRateLimit()` in `server/redis.ts`
- Claims: Basic 5/day, Pro 10/hour
- Verify: Basic 10/hour, Pro 20/hour
- Rate limit info included in API responses for frontend display

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
| CSFloat | Covert inputs + Extraordinary outputs only | ~60 calls/cycle (200/30min pool) |
| DMarket | Coverage gaps (Restricted priority) + stale refresh | 2 RPS continuous (separate process) |
| Skinport | Passive WebSocket (no auth, no rate limits) | Continuous |

## API Keys & Rate Limits

- **CSFloat**: `CSFLOAT_API_KEY` in `.env`
  - 3 independent pools: Listings (200/~1h), Sales (500/~24h), Individual (50K/~24h)
  - Listing + Sale pools managed by daemon. Individual pool managed by csfloat-checker process.
  - Safety buffers prevent 24h lockout. Budget pacing spreads calls across cycles.
- **DMarket**: `DMARKET_PUBLIC_KEY` + `DMARKET_SECRET_KEY` in `.env`
  - 2 RPS (independent from CSFloat). Continuous fetcher runs as separate process.
- **Skinport**: WebSocket feed (no auth, passive, no rate limits)
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
- **Redis**: localhost:6379 (no auth)

## Design Rules

### Architecture
- **Barrel pattern**: Engine (`engine.ts`) and Sync (`sync.ts`) are barrels. Import from barrels, not submodules.
- **Discovery-only**: All profitable trade-ups come from exhaustive discovery over real listings. No theory/materialization.
- **Time-bounded engine**: Workers run structured + exploration within dynamic time limits. Super-batches repeat until cycle budget exhausted.
- **Redis for live state**: Claims, rate limits, and cache are Redis-backed. DB is audit trail.
- **No snapshot DB**: API reads directly from PostgreSQL. Async pg driver handles concurrency. Redis cache absorbs 95% of reads.

### Pricing
- **Output prices are CSFloat-primary**: highest confidence source. DMarket/Skinport gap-fill only when CSFloat has no data.
- **DMarket excluded from ★ item output pricing**: thin liquidity, collector outliers.
- **Price values in cents (integer) throughout**: no floating point for money.
- **Chance-to-profit as first-class metric**: trade-ups with >25% chance to profit are kept even with negative EV.

### Data Quality
- **DMarket name verification**: `cleanTitle !== skinName` check prevents fuzzy match contamination.
- **Dead Hand Collection excluded**: trade-locked until late March 2026.
- **Listing status auto-correction**: API auto-corrects phantom stale (0 missing → active) and phantom active (has missing → partial) on every list response.

### DB
- **PostgreSQL async**: `pg` Pool handles concurrent reads/writes natively. No event loop blocking.
- **Retry with exponential backoff**: `withRetry()` wrapper for connection errors.
- **Merge-save pattern**: `mergeTradeUps()` updates existing trade-ups by signature, marks missing as stale. Tracks profit streaks.
- **30K cap** per type for lower-rarity tiers to prevent OOM from merge-save accumulation.
- **Claimed listings**: `claimed_by`/`claimed_at` columns on listings. Discovery skips claimed listings.

### Coding Conventions
- TypeScript with ESM imports (`.js` extensions in imports)
- `tsx` for running TS files directly (no build step)
- PostgreSQL queries via `pg` Pool with `$1, $2` numbered placeholders (async)
- Daemon logs to `/tmp/daemon.log`, DMarket fetcher to `/tmp/dmarket-fetcher.log`
- No `as any` casts. Use proper type augmentation (Express.User, SessionData) or union types (Pool | PoolClient).
- No `as unknown as` force-casts. Fix the underlying type mismatch instead.
- Redis operations awaited before API responses (no fire-and-forget for cache invalidation)
- **Boolean columns**: `stattrak`, `souvenir`, `is_admin` are BOOLEAN in PostgreSQL. Use `= true` / `= false` in SQL, pass JS booleans as params. Never use `= 0` / `= 1` or `? 1 : 0`.
- **Use shared utilities** from `engine/utils.ts` — never inline these:
  - `pick(arr)`, `shuffle(arr)` — random selection
  - `listingSig(ids)`, `parseSig(csv)` — listing combo signatures
  - `computeChanceToProfit(outcomes, cost)` — profit probability
  - `computeBestWorstCase(outcomes, cost)` — best/worst outcome deltas
  - `withRetry(fn)` — transient DB error retry
- **Use extracted helpers** — never duplicate the loading logic:
  - `loadDiscoveryData(pool, rarity, groupKey, options)` in `data-load.ts`
  - `buildWeightedPool(pool, collections, type)` in `data-load.ts`
  - `buildKnifeFinishCache(pool)` in `knife-evaluation.ts`
- **CONDITION_BOUNDS**: single source of truth in `engine/types.ts`. Import it — never hardcode condition float ranges or name arrays.
- **db-ops is a barrel**: actual code lives in `db-save.ts`, `db-status.ts`, `db-revive.ts`, `db-stats.ts`. Add new DB functions to the appropriate submodule, then re-export from `db-ops.ts`.

### Tier System
| Tier | Price | Delay | Limit | Claims | Verify | Listing Links |
|------|-------|-------|-------|--------|--------|--------------|
| Free | $0 | 3 hr | Unlimited | No | No | Yes |
| Basic | $5/mo | 30 min | Unlimited | 5/day | 10/hr | Yes |
| Pro | $15/mo | 0 | Unlimited | 10/hr | 20/hr | Yes |
