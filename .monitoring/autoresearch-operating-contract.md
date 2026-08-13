# Autoresearch Operating Contract — autonomous daily algorithm-improvement loop

**Status:** PREPARED for durable Deckbox activation; it is not ACTIVE until `ops/autoresearch/install.sh install` passes on the authoritative checkout.
**Owner directive:** improve profitability without breaking realism; **never modify core pricing logic** (no cheating to manufacture profit).

## Runtime and continuity contract

- **Authority:** Deckbox's `tim` user-level systemd manager is the only authoritative scheduler. Session-scoped Claude `CronCreate`, laptop cron, and launchd are not part of the mechanism.
- **Daily fire:** `trade-up-bot-autoresearch-fire.timer` runs at **10:30 UTC daily**. Its one-shot wrapper invokes OMP non-interactively for one bounded iteration and is authorized to push, merge, and deploy under this contract.
- **Engine monitor:** `trade-up-bot-engine-monitor.timer` runs at **minute 11 and 41 of every UTC hour** and performs read-only VPS/DB health collection. It never starts a lever.
- **Missed fires:** both use calendar schedules with `Persistent=true`, so one missed activation catches up after Deckbox downtime. A watchdog runs every 15 minutes.
- **Heartbeat:** every attempted daily fire and monitoring check appends a machine-readable heartbeat under `~/.local/state/trade-up-bot/autoresearch/` with UTC start/finish, git head, exit status, and what it actually did. The watchdog writes `watchdog-status.json`; daily age over 26 hours, monitor age over 90 minutes, a missing heartbeat, or a nonzero latest fire is non-OK. The first mate reads the complete signal with `cat ~/.local/state/trade-up-bot/autoresearch/watchdog-status.json`.
- **Governance:** this contract, `autoresearch-handoff.md`, and `autoresearch-results.tsv` are tracked repository state. Raw agent output, per-check dumps, and heartbeat/runtime files are host state and remain ignored. Continuity gaps are recorded in the handoff's incident section.
- **Browser boundary:** GSC and GA4 evidence remains bound to the captain's authenticated Chrome/CDP session. It is not available to Deckbox unattended, is not part of this automated engine loop, and must never be inferred, copied from cookies, or claimed as automated evidence.

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
1. **Sync and health gate:** require a clean authoritative checkout, fast-forward `main`, and read the latest successful engine-monitor/watchdog evidence. Missing, stale, degraded, or unhealthy evidence stops new-lever work.
2. **Evaluate first:** if the prior shipped lever is less than 24 hours old, observe only. Otherwise decide KEEP/REVERT against its pre-declared watch items before considering new work.
3. **Pick at most one** unshipped additive/bounded/measurable lever. A HOLD or investigation-only fire is valid when evidence is insufficient or the work needs human judgment.
4. **Branch** `autoresearch/<date>-<lever>` off current `main`.
5. **TDD and gates:** write failing behavioral tests first, implement red→green, then require `npm run typecheck`, `npm run test:unit`, and `npm run test:integration`.
6. **Adversarial review:** use a fresh OMP review agent against the full diff, acceptance criteria, and revert signal. Address every concrete blocker and re-review; a crashed, missing, or unparseable review is not approval.
7. **Publish and deploy autonomously:** re-fetch/rebase safely, push the branch, open a PR, and squash-merge only after gates/review are clean. Wait for the repository deploy workflow on the exact merge head. Verify the VPS checkout; because the workflow reloads only `api`, clear the tsx cache and restart `daemon` when daemon/engine code changed.
8. **Verify immediately:** capture an honest pre/post board and lever evidence. Any immediate crash/OOM/restart-loop/DB/cadence failure triggers revert and redeploy, not a new lever.
9. **Stabilize across fires:** a shipped lever ends as `shipped-stabilizing`; do not sleep in one service for 24 hours. The next eligible daily fire makes the formal KEEP/REVERT decision after at least one full day/~24 daemon cycles.
10. **Record:** append the exact-format tracked `.monitoring/autoresearch-results.tsv` row when shipping or making a formal decision, and write the mandatory per-run result plus wrapper heartbeat. Never invent M1/M2; use `NA` with the reason when no honest measurement exists.

## Hard constraints (off-limits — never modify)
- **Core pricing logic / values**: `engine/pricing.ts`, `engine/knn-pricing.ts`, `engine/fees.ts`, `engine/condition-multipliers.ts` price formulas/values. Concurrency-infra-only changes are allowed only if price OUTPUTS are provably unchanged.
- **The `trade_up_score` formula** (frozen, above).
- CSFloat rate-limit safety buffers / the 24h-lockout pacing.
- No new prod dependencies without noting it. No dropping columns/tables/data.

## Safety
- One iteration per day. If the prior iteration is still in its stabilization window, only observe (don't start a new lever).
- Any production instability (OOM, restart loop, DB errors, daemon not cycling) → immediately revert the last autoresearch change, redeploy, record a failed/degraded heartbeat, and start no new work until healthy.
- Memory: worker concurrency is RAM-gated (`pickWorkerConcurrency`, /proc/meminfo). Workers peak ~2.2GB; never raise the gate without re-measuring.
