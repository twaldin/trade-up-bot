# Trade-Up Bot

CS2 trade-up contract analyzer — CSFloat, DMarket, Skinport market data.

## Running

```bash
# API server (auto-reloads)
npx tsx watch server/index.ts

# Daemon (background data fetch + discovery, resumes existing data)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts

# Daemon with fresh start (purges all trade-ups + flushes Redis cache)
NODE_OPTIONS="--max-old-space-size=8192" npx tsx server/daemon.ts --fresh

# Frontend dev server
npm run dev
```

## Design Rules

### Coding Conventions
- TypeScript ESM imports (.js extensions)
- tsx for running TS directly (no build step)
- PostgreSQL via pg Pool with $1, $2 placeholders (async)
- No `as any` or `as unknown as` casts
- Boolean columns (stattrak, souvenir, is_admin): use `= true`/`= false` in SQL, JS booleans as params
- Redis ops awaited before API responses
- Prices in cents (integer) throughout

### Import Rules
- Barrel pattern: import from `./engine.js` and `./sync.js` — never submodules directly
- db-ops is a barrel: code in db-save.ts, db-status.ts, db-revive.ts, db-stats.ts
- CONDITION_BOUNDS from engine/types.ts — never hardcode float ranges
- Shared utilities from engine/utils.ts: pick, shuffle, listingSig, parseSig, computeChanceToProfit, computeBestWorstCase, withRetry
- Extracted helpers: loadDiscoveryData, buildWeightedPool (data-load.ts), buildKnifeFinishCache (knife-evaluation.ts)

### Testing
- Pre-push hook runs: tsc --noEmit + vitest (unit + integration). Don't skip it.
- TDD: use `superpowers:test-driven-development` skill before writing implementation code
- Test dirs: tests/unit/ (pure logic), tests/integration/ (needs PostgreSQL), tests/stress/ (perf)
- Property tests: tests/unit/properties/ with fast-check
- Shared fixtures: tests/helpers/fixtures.ts — use makeListing(), makeOutcome(), makeTradeUp()
- Integration DB: local PostgreSQL tradeupbot_test

### Daemon
- Graceful restart: scripts/daemon-restart.sh (SIGUSR2). Never pm2 restart daemon directly.
- Fresh restart: scripts/daemon-fresh.sh (stop → purge → restart)

### Git
- No Co-Authored-By trailers or Claude/Anthropic attribution in commits
- Don't modify git config user.email or user.name
