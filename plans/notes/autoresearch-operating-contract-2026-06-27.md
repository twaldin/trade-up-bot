# Autoresearch Operating Contract — autonomous daily algorithm-improvement loop

**Status:** ACTIVE (durable daily cron). Fully autonomous: implement → review → deploy → observe → keep/revert, unattended.
**Owner directive:** improve profitability without breaking realism; **never modify core pricing logic** (no cheating to manufacture profit).

## Goal
Increase the supply and quality of genuinely-good trade-ups the engine surfaces, measured by a frozen composite metric, by working through a fixed backlog of discovery/ranking/selection improvements — one per daily iteration.

## Metric (what each iteration is judged on)
Optimize the aggregate **Trade Up Score** of surfaced contracts:
- `M1 = median(trade_up_score) of the top 100 active contracts`
- `M2 = count of active contracts with trade_up_score >= 50`
- Report both each iteration; the primary keep/revert signal is **M2 (and M1 not regressing)** over a stabilization window.

### `trade_up_score` — FROZEN formula (loop may NOT change this; treat like pricing)
```
roi_frac       = profit_cents / total_cost_cents
downside_frac  = max(0, -worst_case_cents) / total_cost_cents     -- 0..1, worst-case loss as fraction of stake
trade_up_score = round( 1000 * chance_to_profit * roi_frac / (1 + downside_frac) )   -- total_cost_cents<=0 => 0
```
Persisted as `trade_ups.trade_up_score` (integer, indexed), and the DEFAULT sort column for the API/UI.
Rationale: rewards high chance-to-profit + positive EV + bounded downside; encodes the "X% chance to clear $N, worst case -$M" product framing. **Anti-gaming:** because the loop optimizes an aggregate of this score, the formula is frozen — the loop must raise the score by finding/ranking better real contracts, not by redefining the score.

## Backlog queue (in priority order; one per iteration)
1. **E1 — `trade_up_score` column + default sort.** Add the column (additive migration), compute it in evaluation/save + reprice, backfill, index it, make it the default API/UI sort. Establishes the metric. *(do first)*
2. **E3 — boundary-knapsack float selector.** A smarter input-float combination search (`selectCheapestUnderBoundary`) to land outputs just under high-value condition boundaries (4–17× jumps). Builds on the now-fixed `selectForFloatTarget`.
3. **D — wire staircase.** Call the implemented-but-dead `phase5cStaircase` into the daemon cycle (50 Classified→5 Covert→1 Knife). New contract class, zero current coverage.
4. **E2/E4 — reverse output-targeting + bounded 3-collection mixed-input search.** Open unexplored combo space.

## Per-iteration protocol (each daily fire)
1. **Pick** the next un-shipped backlog item (check the research log for what is done).
2. **Branch** `autoresearch/<date>-<lever>` off `main`.
3. **TDD**: write failing test(s) first (vitest, `tests/helpers/fixtures.ts`), then implement. Red→green.
4. **Gate**: `npm run typecheck` + `npm run test:unit` + `npm run test:integration` must all pass.
5. **Adversarial review**: `codex exec '<review prompt>' < /dev/null` (background; single-quote; wait on `tokens used`, not VERDICT). Address every BLOCKER/MAJOR; re-review until RESOLVED. (See [[codex-review-stdin-gotcha]].)
6. **Deploy**: commit (no Co-Authored-By), push `main` (FF), then on VPS `git pull && rm -rf /root/.cache/tsx && pm2 restart daemon` (+ `api` if engine/API touched). Migrations are **additive only** (add nullable column + backfill; never drop/rewrite data); run on `tradeupbot_test` first.
7. **Observe** over the stabilization window (>= 1 full day / >= ~24 daemon cycles). Record M1/M2 + health (OOM, restarts, reprice freshness, worker concurrency).
8. **Keep or revert**:
   - **Revert** (git revert + redeploy) if: any test/tsc regression slips through, an OOM/crash/worker-kill appears, reprice/discovery breaks, or M2 **regresses** beyond market-noise. Market is noisy → require a *sustained* regression, not one reading; compare against the pre-change trend.
   - **Keep** if stable and M2 is non-worse (these levers are additive — they should only add contracts). 
9. **Log** to `.monitoring/autoresearch-log.md` (narrative) + `.monitoring/autoresearch-results.tsv` (iteration, commit, M1, M2, status, lever).

## Hard constraints (off-limits — never modify)
- **Core pricing logic / values**: `engine/pricing.ts`, `engine/knn-pricing.ts`, `engine/fees.ts`, `engine/condition-multipliers.ts` price formulas/values. Concurrency-infra-only changes are allowed only if price OUTPUTS are provably unchanged.
- **The `trade_up_score` formula** (frozen, above).
- CSFloat rate-limit safety buffers / the 24h-lockout pacing.
- No new prod dependencies without noting it. No dropping columns/tables/data.

## Safety
- One iteration per day. If the prior iteration is still in its stabilization window, only observe (don't start a new lever).
- Any prod instability (OOM, restart loop, DB errors, daemon not cycling) → immediately revert the last change and alert the user; do not start new work until healthy.
- Memory: worker concurrency is RAM-gated (`pickWorkerConcurrency`, /proc/meminfo). Workers peak ~2.2GB; never raise the gate without re-measuring.
