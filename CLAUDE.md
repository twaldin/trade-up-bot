# Trade-Up Bot

CS2 trade-up contract analyzer. Discovers and ranks profitable 10-skin → 1-skin trade-ups across six rarity tiers by combining live market data (CSFloat sales, DMarket listings, Skinport WebSocket, Buff.market) with a deterministic output-float model and KNN float-sensitive pricing.

## Stack
- Node.js ESM + Express on port 3001 (no build step — `tsx` runs TS directly)
- React 19 + Vite on port 5173 (proxies API in dev)
- PostgreSQL 16 (`tradeupbot`) via async `pg` Pool
- Redis (route cache + claim TTLs); SQLite for sessions (`data/sessions.db`)
- Deployed to a Hetzner VPS via PM2

## Layout
- `server/` — API + daemon + engine + data fetchers
  - `engine/` — math, EV, KNN pricing, knife/glove specials → see `server/engine/CLAUDE.md`
  - `routes/` — REST API, claims, verify, Stripe → see `server/routes/CLAUDE.md`
  - `daemon/` — time-bounded discovery loop with forked workers → see `server/daemon/CLAUDE.md`
  - `sync/` — CSFloat / DMarket / Skinport / Buff fetchers → see `server/sync/CLAUDE.md`
- `src/` — React frontend (App.tsx, pages/, components/, contexts/, hooks/)
- `shared/types.ts` — cross-layer types
- `tests/` — `unit/`, `integration/`, `stress/`, `helpers/fixtures.ts`

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + discovery, resumes existing data)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts

# Daemon with fresh start (purges all trade-ups + flushes Redis cache)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts --fresh

# Frontend dev server (also runs API server via concurrently)
npm run dev
```

## Coding Conventions
- TypeScript ESM imports use `.js` extension (resolved at runtime by tsx / Node ESM).
- No `as any` or `as unknown as` casts.
- PostgreSQL via async `pg` Pool with `$1, $2` placeholders.
- Boolean SQL columns (`stattrak`, `souvenir`, `is_admin`): `= true` / `= false` in SQL, JS booleans as params.
- Redis ops awaited before API responses.
- **Prices are integer cents throughout** — never fractional dollars.

## Import Rules
- Barrel pattern: import from `./engine.js` and `./sync.js`. Never reach into `./engine/<submodule>.js` from outside the package.
- `engine/db-ops.ts` is a barrel for `db-save.ts`, `db-status.ts`, `db-revive.ts`, `db-stats.ts`.
- `CONDITION_BOUNDS` from `engine/types.ts` — never hardcode float ranges.
- Shared utilities from `engine/utils.ts`: `pick`, `shuffle`, `listingSig`, `parseSig`, `computeChanceToProfit`, `computeBestWorstCase`, `withRetry`, `pickWeightedStrategy`.

## Testing & TDD
- **TDD is mandatory.** Red / green / refactor.
- Pre-push hook runs `tsc --noEmit` + vitest (unit + integration). Don't skip it.

### Project-specific TDD conventions
- **Runner**: vitest. Run with `npx vitest run <path>`. Never jest.
- **Fixtures**: always use `tests/helpers/fixtures.ts` — `makeListing()`, `makeAdjustedListing()`, `makeListings(n)`, `makeOutcome()`, `makeTradeUp()`, `makeObservation()`. Never redeclare locally.
- **Test placement**:
  - Pure logic → `tests/unit/<module>.test.ts`
  - Needs PostgreSQL → `tests/integration/<feature>.test.ts` (uses `tradeupbot_test` DB, see `tests/integration/setup.ts`)
  - Performance → `tests/stress/`
  - Property-based → `tests/unit/properties/<module>.prop.test.ts` (use `fast-check`)
- **Property tests** cover invariants: prices in integer cents, probabilities sum to 1, float ranges within bounds, ROI math consistency.
- **Verify commands**: `npm run test:unit` (fast), `npm test` (unit + integration), `npm run typecheck`.

## Daemon Deploy
- Code changes require a hard restart: `pm2 restart daemon` (running process holds old code in memory).
- Fresh restart (purge + restart): `scripts/daemon-fresh.sh`.

## Git
- No `Co-Authored-By` trailers or Claude/Anthropic attribution in commits.
- Don't modify `git config user.email` or `user.name`.
