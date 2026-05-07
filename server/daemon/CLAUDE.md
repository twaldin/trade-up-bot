# Daemon Reference

Time-bounded discovery engine. `TARGET_CYCLE_MS = 30 min` (matches Basic-tier delay).

## Cycle Phases (`server/daemon/index.ts`)
1. **Phase 1 — Housekeeping**: purge stale listings, refresh listing statuses, prune observations.
2. **Phase 3 — API Probe**: rate-limit detection across all 3 CSFloat pools.
3. **Phase 4 — Data Fetch**: round-robin sale history + listings (skipped if all pools rate-limited).
4. **Phase 4b — Recalc**: trade-up costs where input prices changed (DMarket/Skinport updates).
5. **Phase 4c — Reprice**: 20K trade-up outputs with current KNN + price cache (profitable first, then oldest).
6. **Phase 5 — Time-Bounded Engine**: all remaining time, ends 30s before cycle deadline. Repeating super-batches; each batch runs `WORKER_ROUNDS`:
    - knife + classified
    - knife + restricted
    - milspec + industrial
    - consumer (alone)
   Then merge → revival (1000 knife + 1000 per gun type) → expired-claim cleanup → DMarket staleness (every other batch).

CSFloat individual-pool staleness checks run in a **separate** `csfloat-checker` process — not in this daemon.

## Workers (`calc-worker.ts`)
Forked child processes (`fork()`), read-only DB. Each worker:
1. Loads existing signatures from DB.
2. Structured discovery with deadline (~60% of time budget).
3. Deep exploration with the remainder.
4. Returns results via NDJSON over stdout.

Time limits (`MIN_WORKER_TIME = 3 min`, `MAX_WORKER_TIME = 5 min`): the first super-batch divides remaining time across rounds (capped at MAX); later super-batches use MIN. SIGTERM at `workerTimeLimit + 30s` (`WORKER_KILL_BUFFER`).

NDJSON pre-materialization: main process writes `/tmp/discovery-data-<rarity>-<key>.ndjson`; workers read the file instead of re-querying Postgres (~15s saved per worker).

## Files
- `index.ts` — main cycle loop, `WORKER_ROUNDS`, `TASK_TYPE_MAP`, super-batch driver.
- `calc-worker.ts` — forked child that runs discovery for one tier.
- `state.ts` — `BudgetTracker`, `FreshnessTracker`, `TARGET_CYCLE_MS`, safety buffers.
- `utils.ts` — logging, rate-limit detection, cycle stats.
- `loops.ts` — inner-loop helpers (cooldown explore).
- `adaptive-weights.ts` — strategy-yield → per-tier weights.
- `completeness-audit.ts` — diagnostic counter for skin-coverage gaps.
- `discord-alerts.ts` — webhook alerts for new all-time-best trade-ups.
- `phases/` — `housekeeping.ts`, `data-fetch.ts`, `classified-calc.ts`.

## Budget Safety
CSFloat has 3 independent pools but they **share a 24h lockout** if any reaches 0:
- Listings: 200 per ~1h rolling window
- Sales: 500 per ~24h
- Individual: 50,000 per ~24h (csfloat-checker process)

Safety buffers (`LISTING_SAFETY_BUFFER=5`, `SALE_SAFETY_BUFFER=30`, `INDIVIDUAL_SAFETY_BUFFER=100`) keep us in rolling-replenishment mode and out of the 24h trap. Budget pacing spreads calls across cycles proportional to `cycleDuration / timeUntilReset`.

## Restart
- **Code changes require hard restart**: `pm2 restart daemon` (the running process holds old code in memory).
- Fresh restart: `scripts/daemon-fresh.sh` (graceful stop → purge → restart).
- `SIGUSR2` / `daemon-restart.sh` only useful for config changes that don't require new code.
