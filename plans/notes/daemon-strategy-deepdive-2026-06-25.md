# Daemon Strategy Deep-Dive — $0 Throughput, Discovery & Optimal-Float Levers

**Date:** 2026-06-25
**Scope:** TradeUpBot discovery daemon. Executor-ready, TDD-structured. Prices are integer CENTS.
**Box:** Hetzner CPX41, 8 vCPU / 15.6 GiB, running <25% CPU (load ~2.5–3.5 of 8) during discovery. **Not hardware-bound.**

---

## 1. TL;DR — the thesis

We are running discovery on **2 of 8 cores** while a maturing market means the remaining edge is *smarter search over the same listings*, not more data. Five $0 software levers, in order of (gain × confidence)/effort:

1. **Fix a silent key-mismatch bug** (`selection.ts:75-76`) that disables the bot's marquee float-targeting edge on **all 5 gun tiers** (≈1.0M of 1.26M trade-ups). FACT, ~5-line fix.
2. **Parallelize Phase 4c reprice** — today a single-client serial loop reprices ~960K/day vs ~1M eligible, leaving **80% of contracts ranked on >6h-stale prices** (FACT, queried). In-process pooled concurrency + bulk writes → full table every ~4–5h.
3. **Lift the 2-worker cap** (`WORKER_ROUNDS`, `index.ts:109`) from 4×≤2 to 3×3 → 3 concurrent workers, 6 tiers in 2 rounds, unlocking a real second super-batch (more exploration wall-clock).
4. **Wire staircase into the daemon** — `phase5cStaircase` is fully implemented (`classified-calc.ts:94`) but **never called** anywhere in the cycle (FACT: 0 grep hits in `index.ts`/`phases.ts`/`loops.ts`; **0 `staircase` rows in prod**). An entire knife-output contract class is dark.
5. **KPI-reframe ranking + new float-aware discovery** (reverse output-targeting, bounded 3-collection pass, boundary-knapsack selection) — surface good bounded-downside contracts that are EV-negative but high-chance, and exploit the 4–17x glove/knife boundary multipliers the greedy selector structurally cannot reach.

The unifying observation (FACT, prod query 2026-06-25): tiers have **few profitable but many high-chance** contracts — e.g. `industrial_milspec` 389,904 total / **44 profitable** / 274,079 `ctp>0.25`; `consumer_industrial` 243,123 / **0 profitable** / 192,216 `ctp>0.25`; `covert_knife` 192,851 / **2 profitable** / 141,395 `ctp>0.25`. Ranking on raw EV alone buries the bulk of the inventory. The float bug + KPI reframe together are the highest-leverage changes.

---

## 2. The opportunity stack (ranked)

| # | Lever | $cost | Expected gain | Effort | Risk | (gain×conf)/effort |
|---|-------|-------|---------------|--------|------|--------------------|
| A | **Fix `selectForFloatTarget` key bug** (selection.ts:75-76) | $0 | Restores structured float-targeting + 3 up-weighted explore strategies (S5/S7/S8) on 5 gun tiers (~1.0M trade-ups). HIGH conf. | ~5 lines + 1 unit test | LOW (reversible) | **highest** |
| B | **Parallelize reprice** (db-stats.ts:179) | $0 | Full-table reprice 27h→~4–5h; kills 80%-stale ranking. HIGH conf on mechanism, MED on exact multiple. | ~1 day | MED (pool/txn) | high |
| C | **Lift 2-worker cap** (index.ts:109,486-509) | $0 | 2→3 concurrent workers + real batch-2 → est. 2–3x new-contracts/cycle. HIGH conf on concurrency, MED on multiple. | ~half day | LOW-MED | high |
| D | **Wire staircase** (calc-worker/index or call `phase5cStaircase`) | $0 | New high-value knife-output class, **0 current coverage**. HIGH conf it's dark; MED on yield. | ~1 day | MED (N+1 queries) | medium |
| E1 | **KPI-reframe ranking** (store.ts scoring; trim by ctp) | $0 | Surfaces bounded-downside contracts the EV score buries (≈80%+ of inventory is ctp>0.25). HIGH conf inventory exists. | ~half day | LOW | medium |
| E2 | **Reverse output-targeted explore strategy** (discovery.ts case 20) | $0 | Directly serves "X% chance to clear $N"; depends on A. MED conf. | ~half day | LOW (additive) | medium |
| E3 | **Boundary-knapsack `selectCheapestUnderBoundary`** (selection.ts) | $0 | Exploits 4–17x glove/knife boundary multipliers; flips negative high-float gloves positive. MED conf. | ~1–2 days | MED | medium |
| E4 | **Bounded structured 3-collection pass** (discovery.ts after pairs) | $0 | Opens genuinely unexplored region (4+ col = 0 rows); depends on A. MED conf. | ~1 day | MED (blowup) | lower |
| — | ~~30K per-type cap work~~ | — | **SKIP** — not in code; global cap is 5M (index.ts), inventory 1.26M, not binding. | — | — | n/a |

---

## 3. Per-lever sections

### Lever A — Fix `selectForFloatTarget` collection-key mismatch (HIGHEST)

**Current behavior (FACT).** `selectForFloatTarget` (`server/engine/selection.ts:41`) accepts `quotas: Map<string,number>`. The outer eligibility/verify loops key by the map's keys (`selection.ts:51` `for (const [colId, quota] of quotas)`, `:89` verify). But the inner greedy loop reads a *different* field:

```ts
// selection.ts:75-76
const colPicked = picked.get(l.collection_name) ?? 0;
const colQuota  = quotas.get(l.collection_name) ?? 0;   // miss → undefined → 0
// :77  if (colPicked >= colQuota) continue;             // 0 >= 0 → skips EVERY candidate
```

The daemon pre-materializes the 5 gun rarities with `groupKey: "collection_id"` (`index.ts:378-382`), so `byColAdj` and `quotas` are **id-keyed** (callers: `discovery.ts:244` `new Map([[colId,10]])`, `:389` `[[colA,countA],[colB,countB]]`, `:666`, `:801`, `:1164`, `:1218`). `l.collection_name` ≠ `l.collection_id` (both exist on `AdjustedListing`, `types.ts:28-29/33-34`), so `quotas.get(l.collection_name)` returns `undefined → 0` and **every candidate is skipped → returns null** on all gun-tier calls. Knife is unaffected: it materializes with `groupKey: "collection_name"` (`index.ts:377`), so the name lookup matches. `selectLowestFloat` (`selection.ts:97`) is already correct — it iterates by the outer `colId` and never reads `collection_name`.

**The change.** In `selectForFloatTarget`, key the greedy loop by `collection_id` to match the quota map:
```ts
const colPicked = picked.get(l.collection_id) ?? 0;
const colQuota  = quotas.get(l.collection_id) ?? 0;
// ...
picked.set(l.collection_id, colPicked + 1);   // line 83
```
This works for knife too, because knife callers build quotas keyed by `collection_name` but the AdjustedListing for knife has `collection_id` populated as well — **verify** knife `byColAdj` is id-consistent, or (safer) make all callers pass id-keyed quotas (they already do `[[colId,...]]`). Lowest-risk: use `collection_id` and confirm knife materialization populates `collection_id` (it does via `loadDiscoveryData`).

**Why it helps.** Restores: structured float-transition targeting (`discovery.ts:245-250`, `:388-395`) and explore strategies **S5 (float-targeted pair), S7 (output-value-aware), S8** — exactly the strategies up-weighted as float-biased (`FLOAT_BIASED_CASES = [5,7,8,12,13,15,15]`, `discovery.ts:1063`). This is the documented core edge of the bot, currently live only for knives.

**Expected gain (quantified).** Affects ~1.0M of 1.26M trade-ups. The marquee "land output just under a high-value boundary" mechanic (boundary crossings worth 4–17x, see Lever E3) starts firing on guns. High new-contract yield from a ~5-line change.

**Risk + rollback.** LOW, fully reversible (revert the 3 lines). Rollback signal: gun-tier discovery `structuredCount` drops to ~0 or merges fewer contracts than before (regression — should only ever increase). Knife regression (knife `structuredCount` falls) → revert and switch to caller-side id-keyed quotas instead.

**TDD test sketch.**
- File: `tests/unit/selection.test.ts`.
- RED: build `byColAdj` via `makeAdjustedListing()` where `collection_id="col-123"` and `collection_name="Fever"` (distinct), `quotas = new Map([["col-123", 10]])`. Assert `selectForFloatTarget(byColAdj, quotas, 0.10)` currently returns `null`.
- GREEN after fix: returns a 10-listing array with `sum(adjustedFloat) <= 10*0.10` and all from `col-123`.
- Invariant (property test, `tests/unit/properties/selection.prop.test.ts`): for any id-keyed quotas summing to `count`, when ≥`count` feasible listings exist under the budget, the function returns exactly `count` listings and never returns null spuriously.

---

### Lever B — Parallelize Phase 4c reprice (db-stats.ts)

**Current behavior (FACT, queried/logged).** `repriceTradeUpOutputs` (`server/engine/db-stats.ts:179-267`), driven by `index.ts:355` with `limit=20000`. It builds the price cache once (`:183`), selects oldest/most-profitable-first (`:191-194`), then loops batches of 100 (`:200-202`) on a **single** `pool.connect()` client (`:204`), inside which an inner serial `for (const o of outcomes) { await lookupOutputPrice(...) }` (`:219-228`) awaits ~16.7 cache-resolved promises/trade-up, then issues **one `UPDATE ... WHERE id=$1` per trade-up** (`:244-254`). Pool `max:20` (`server/db.ts:30`) sits ~95% idle.

**Live state (FACT).** Total priceable ≈1.08M; eligible/cycle (`output_repriced_at` NULL or <2h) ≈999K (92.6%); **>6h stale ≈862K = 79.9%**; worst-case age ~1.4 days (the grounding's "12-day" figure is STALE — daemon partially caught up). Measured ~5.5 ms/trade-up, 20K/110s. Math: 20K × ~48 cycles/day = ~960K/day < 999K eligible → **full table turns over ~once per 27h**.

**The change.**
1. Replace the serial batch loop (`:202-264`) with a bounded worker pool: split `rows` into chunks, run **N=6 concurrent workers**, each `await pool.connect()`-ing its own client draining a shared chunk queue. The in-memory caches (`priceCache`, `_knnCache`, `_floatCeilingCache`, `skinportMedianCache`) are module globals, read-only during reprice → concurrent `lookupOutputPrice` is lock-free safe.
2. Coalesce writes: per chunk, accumulate results and issue **one** `UPDATE trade_ups AS t SET ... FROM (VALUES ...) v(...) WHERE t.id=v.id`; non-changed rows → one `UPDATE ... SET output_repriced_at=NOW() WHERE id=ANY($1)`. Keep the existing >1% EV-change guard (`:243`). Keep each chunk in its own BEGIN/COMMIT (`:206/257`).
3. Once (1)+(2) land, raise `index.ts:355` limit from `20000` toward `60000–120000`.

**Why it matters (not hygiene).** Ranking reads `profit_cents`, `chance_to_profit`, `best_case_cents`, `worst_case_cents` straight off `trade_ups`; these are recomputed only inside reprice (`:239-240`), so they go stale in lockstep. The float-boundary contracts (this bot's edge) are *exactly* the ones most sensitive to a stale output price flipping profit sign across a 10–17x boundary. 80% stale → both hides newly-good and shows phantom-good contracts for up to 27h.

**Expected gain.** 60K/cycle → full pass ~every 9h; 120K/cycle → ~5×/day (~4–5h), worst-case age <6h "stale" line. Conservative floor ≥3×.

**Risk + rollback.** Pool starvation → cap at 6 (14 free of 20); reprice runs in Phase 4c before discovery workers fork, narrow contention window. Txn size → keep chunk ≤500 to bound bind params. Rollback signal: PG `too many connections`, reprice wall-clock *increases*, or row state diverges from serial (determinism test fails). Rollback = restore serial loop + `limit=20000`.

**TDD test sketch.**
- File: `tests/integration/reprice-parallel.test.ts` (`tradeupbot_test`).
- Seed K trade-ups, `output_repriced_at` >2h old, with a price cache where one output crossed a condition boundary.
- Assert: (a) all K get fresh `output_repriced_at`; (b) the boundary-crosser's `profit_cents`/`chance_to_profit` recompute to the expected sign; (c) **parallel run (N=6) and serial run produce byte-identical row state** (determinism); (d) wall-clock(N=6) materially < wall-clock(N=1) on a few-thousand-row fixture.
- Benchmark item (2) (bulk write) first on a fixture — it unlocks the high end of the multiplier.

---

### Lever C — Lift the 2-worker cap (WORKER_ROUNDS)

**Current behavior (FACT).** `WORKER_ROUNDS` (`index.ts:109-114`) is 4 rounds, each ≤2 tiers; the launch loop (`index.ts:486-509`) destructures a fixed `[taskA, taskB]` and runs `Promise.allSettled` over a 1–2 element array → **never more than 2 calc-workers at once**. The super-batch driver loops rounds serially (`:486` `for roundIdx … await`). Net result (FACT, 3 cycles): exactly **ONE super-batch/cycle**; super-batch 1 consumes ~22.8 min and the budget is gone. Batch 2, revival-between-batches, DMarket-every-other-batch, and the adaptive split-shift are effectively dead paths. Live top: 2 workers at 100%+91% CPU, ~61% idle, load 3.48/8.

**The change.** Widen to 3×3 so 3 workers run concurrently and all 6 tiers finish in 2 rounds:
```ts
const WORKER_ROUNDS: (string | null)[][] = [
  ["knife", "classified", "restricted"],
  ["milspec", "industrial", "consumer"],
];
```
Then generalize the launch loop (`index.ts:489-512`): replace the fixed `[taskA, taskB]` destructure with iteration over the variable-length round array — build `workers[]` and `taskNames[]` by filtering nulls. The merge loop already iterates `taskNames` (`:512-570`); only the launch + 2-element destructure need to become N-element. The `while (Date.now() < engineEnd - 30_000)` super-batch loop (`:479`) already supports a real batch 2 — halving per-batch wall-clock lets it execute.

**Why it helps.** Structured is near-exhausted on mature tiers (FACT: knife structured=5, classified=24); new contracts come from **exploration**, currently truncated to ~118s/tier because rounds are serial. Slices are independent per tier (own NDJSON + sig file + PG pool; merge is post-hoc), so scaling is ~linear in cores until PG read or merge saturates.

**Expected gain.** 2→3 workers = 1.5x instantaneous core use; freed rounds → likely a real batch 2 → est. **2–3x new-contracts/cycle** (gain dominated by recovered exploration wall-clock). Do NOT jump to 6-wide in one shot (PG `max_connections=100`, per-worker pool `max:3`, and serial merge unproven at that width).

**Risk + rollback.** LOW-MED. RAM-proven (3×~1.5 GB = 4.5 GB of ~8.5 GB budget; per-worker heap ~250 MB, the GH#22 OOM cause is gone). Unknowns: PG read contention with 3 simultaneous readers (mitigated by NDJSON/sig pre-materialization removing heavy PG reads from the hot path) and +50% per-round merge work (trivial). Rollback signal: any `heap out of memory` in logs, sustained load >7, PG `too many connections`, or super-batches drops <1 (merge starvation). Rollback = revert `WORKER_ROUNDS` to the 4×≤2 array.

**TDD test sketch.**
- File: `tests/unit/worker-rounds.test.ts` (pure logic on the generalized launch builder, if extracted).
- Invariant: for any `WORKER_ROUNDS` shape, the launch builder produces one worker per non-null task and a `taskNames` array of equal length; null slots produce no worker. Use a refactor that extracts `buildRoundWorkers(round)` so it's unit-testable without forking.
- A/B is operational (see §4), not a unit test.

---

### Lever D — Wire staircase into the daemon

**Current behavior (FACT).** `findStaircaseTradeUps` (`staircase.ts:42`) and the daemon wrapper `phase5cStaircase` (`classified-calc.ts:94`, which saves with real classified inputs) are **fully implemented** but `phase5cStaircase` is **never called** (FACT: 0 hits in `index.ts`, `phases.ts`, `loops.ts`). `staircase` is absent from `WORKER_ROUNDS`/`TASK_TYPE_MAP` and from calc-worker. Prod confirms: **0 `staircase` rows** (query 2026-06-25 returns only the 6 gun/knife tiers). An entire documented tier (engine/CLAUDE.md: 50 Classified → 5 Covert → 1 Knife) is dark.

**The change (two options).**
- *Cheapest hook:* call the existing `phase5cStaircase(pool)` from the cycle, e.g. after the super-batch loop or on a light cadence (every Nth cycle), on a short time budget. It already saves with real inputs.
- *Worker hook:* add a `case "staircase"` to calc-worker (call `findStaircaseTradeUps`), add `staircase` to a `WORKER_ROUNDS` slot, map `staircase→'staircase'` in `TASK_TYPE_MAP`. More integration but parallel.

It feeds off existing `classified_covert` rows (`staircase.ts:54`), so it benefits directly once Lever A unblocks classified float targeting.

**Why it helps.** Adds a whole high-value (knife-output) contract class with zero current coverage — pure additive inventory.

**Risk + rollback.** MED. Staircase issues per-row `outcomes_json` queries (`staircase.ts:72`) and per-input Covert lookups (`:216`) — N+1; cap stage-1 candidates (already `LIMIT 5000`) and run on a short budget so it can't blow the cycle. Rollback signal: cycle overruns `TARGET_CYCLE_MS`, or staircase phase wall-clock >2–3 min. Rollback = remove the call / remove from `WORKER_ROUNDS`.

**TDD test sketch.**
- File: `tests/integration/staircase-daemon.test.ts` (`tradeupbot_test`).
- Seed a handful of profitable `classified_covert` rows + matching Covert listings + knife outcomes.
- Assert `phase5cStaircase(pool)` writes `trade_ups` rows with `type='staircase'`, each with 50 real classified inputs (not synthetic Coverts), and a sane `profit_cents`/`chance_to_profit`. Use `makeTradeUp()`/`makeListings()`.
- Guard: assert the phase respects a passed time budget (returns within it).

---

### Lever E — KPI-reframe ranking + float-aware discovery

The owner directive: judge by `chance_to_profit` + bounded best/worst ("X% chance to clear $N, worst case −$M"), not raw EV. Prod (FACT 2026-06-25) shows the inventory is overwhelmingly high-chance, low-raw-profit (e.g. `consumer_industrial` 0 profitable but 192,216 ctp>0.25). Four sub-levers.

#### E1 — Make chance/best/worst co-equal ranking axes
**Current (FACT/INFERENCE).** Ranking score is roughly `profit_cents + (ctp>0.25 ? ctp*5000 : 0)` — chance is a tiebreaker, best/worst never scored (`store.ts` scoring + `db-save.ts` ordering). The global trim (when it eventually triggers at 5M, `index.ts`) trims by `roi_percentage ASC` only, ignoring `chance_to_profit`/best/worst — inconsistent with the reframe (but inactive at 1.26M, so low urgency).
**Change.** In `TradeUpStore` scoring (`store.ts`) and any select/trim ordering, add an explicit composite that scores `chance_to_profit` and bounded `best_case_cents`/`worst_case_cents` as first-class terms (e.g. a "clears $N with ≥X% and worst-case ≥ −$M" filter surfaced separately from raw-EV rank). `computeChanceToProfit` / `computeBestWorstCase` (`utils.ts`) already produce the inputs and are recomputed in reprice (`db-stats.ts:239-240`).
**Risk/rollback.** LOW. Reversible scoring constant. Rollback signal: total `ctp>0.25` count or surfaced-good-bounded-downside count *drops*.
**TDD.** `tests/unit/store.test.ts`: build two `makeTradeUp()`s, one EV-positive thin / one EV-negative but ctp=0.6 with bounded worst-case; assert the reframed scorer ranks the bounded-downside one above a low-chance EV-negative contract and that probabilities still sum to 1 (property invariant).

#### E2 — Reverse output-targeted explore strategy
**Current (FACT).** Every explore strategy starts from inputs → see what output falls out. `buildOutputProfiles` (`discovery.ts:63`) and `collectionPremium` (`:962`) compute the needed signals but only nudge a random target (S7). No "rank outputs by value, search inputs backward" strategy.
**Change.** Add `case 20` (bump `TOTAL_STRATEGIES` from 20 → 21, `discovery.ts:1064`): for the picked collection, take its single most valuable output skin (max `outputPriceMap`), compute `targetAdj = (boundary − out_min)/(out_max − out_min) − ε`, call `selectForFloatTarget(byColAdj, quotas, targetAdj)`, score/keep by chance + best/worst (`computeBestWorstCase`). Add it to `FLOAT_BIASED_CASES` so adaptive weights can grow it.
**Risk/rollback.** LOW (additive). Depends on Lever A. Rollback signal: strategy yields ~0 over several cycles (adaptive weights will naturally starve it). Rollback = remove the case.
**TDD.** `tests/unit/discovery-strategies.test.ts`: stub a collection whose top output has a known boundary; assert the strategy requests `selectForFloatTarget` with the expected `targetAdj` and that the produced trade-up's output condition is ≤ the targeted band.

#### E3 — Boundary-knapsack `selectCheapestUnderBoundary`
**Current (FACT, INFERENCE).** Only two float selectors: `selectForFloatTarget` (cheapest under a ceiling — once Lever A is fixed) and `selectLowestFloat` (cost-blind, overshoots into $3,000+ AWPs). There is no "cheapest combo that *provably* lands output < boundary B." Worked examples (FACT, VPS-queried prices):
- **Gloves are 100% full-range** (min 0.06, max 0.80) → every glove outcome is float-controlled. Live glove trade-ups run `avg_adj 0.51–0.66` → outputs ~BS, all **negative (−$344 to −$492)**. Boundary multipliers: Driver King Snake FN $3,047 / FT $182 = **16.7x**; Sport Vice FN $6,718 / FT $565 = 11.9x; King Snake MW $531 vs WW $133 ≈ 4x. A combo landing gloves in MW (`avg_adj < 0.122`) plausibly flips these from −$400 to positive **on the same listings**.
- Knife Example A (Fever #773530858) is correctly float-*insensitive* (Doppler/Marble capped finishes) — the curve gate must route effort *away* from it.
**Change.** Add `selectCheapestUnderBoundary(byColAdj, quotas, outputBoundaryAdj, count)`: minimize total price s.t. `sum(adjustedFloat) <= count*outputBoundaryAdj`, via a tiny bounded knapsack / per-collection DP on quantized float (bucket to 0.005, ~150 buckets, <1ms). Derive `outputBoundaryAdj` per (collection, valuable-output) from real `min_float/max_float` + next boundary (gloves → 0.0135 FN / 0.122 MW / 0.43 FT). Gate with `curve-classification.ts` `shouldUseValueRatio` (`:161`, true when `intraConditionCV>30`) so the knapsack only fires on float-sensitive outputs (gloves, single-knife-finish collections) and cheapest stays for staircase/capped outputs and the small-multiplier lower gun tiers.
**Risk/rollback.** MED. (a) Return `null` gracefully when no feasible under-boundary set exists (mirror `selection.ts:90`). (b) **Round adjustedFloat UP when bucketing** so a "lands in FN" claim is never violated (else EV overstated, revival marks dead). (c) Use per-finish `predicted_float`, not the avg, for capped finishes. Rollback signal: revival death-rate on knapsack-sourced contracts spikes (overstated EV) → revert selector, keep gate. Rollback = stop calling the new selector.
**TDD.** `tests/unit/selection.test.ts`: `makeAdjustedListing()` pool; assert `selectCheapestUnderBoundary` returns the provably-cheapest set with `sum(adjustedFloat) <= count*ceiling`. Property test: output condition is *always* ≤ requested band (never overstated). Integration: reconstruct #773349043's pool, assert the new selector finds an MW-glove combo with higher EV than the stored WW combo at comparable cost.

#### E4 — Bounded structured 3-collection pass
**Current (FACT).** Structured enumerates single + **all pairs** (`discovery.ts:314` nested i<j) but **never triples**. Prod: 3-col is 0.1–0.8% of each tier, **4+-col = 0 rows anywhere**. Only explore-S3 (`discovery.ts:1126`) touches 3-col — float-blind, rarely survives signature dedup (`store.ts:39`). Pairs are well-explored (consumer 2-col=232,906 vs 1-col=10,169), so "mixed unexplored" is false for pairs, true for triples+.
**Change.** Add a structured 3-collection pass after the pairs loop: cap to top-K collections by recent profit via `buildWeightedPool` (e.g. top 12 → C(12,3)=220 triples × a few splits), reuse `selectForFloatTarget`/`selectLowestFloat` with 3-key quotas (works once Lever A is fixed — N-collection quotas already supported). Gate behind `deadlineMs` and only run when pair `sigSkipRatio` is high (worker already computes it, `calc-worker.ts:157`, currently unused for branching).
**Risk/rollback.** MED (combinatorial blowup) → strictly cap collection count + splits + behind deadline. Rollback signal: structured phase overruns its 60% budget or merge starves. Rollback = remove the triples block.
**TDD.** `tests/unit/discovery-triples.test.ts`: seed 3 collections; assert the pass produces a 3-collection trade-up with correct per-collection quota counts summing to 10 and float within bounds (property invariant).

---

## 4. Sequencing & measurement

Ship in this order; each is independently revertible. Measure via `market_snapshots` (or per-cycle `pm2 logs daemon` grep) — capture **3 cycles before, 3 after**.

| Stage | Ship | Primary metric (A/B) | Success signal |
|-------|------|----------------------|----------------|
| 1 | **A** (float bug fix) | per-tier `structuredCount` + merged contracts on gun tiers; total `ctp>0.25` | gun `structuredCount` >0 (was ~0); `ctp>0.25` count rises |
| 2 | **B** (parallel reprice) | `output_repriced_at` >6h-stale fraction; full-table turnover hours | >6h-stale fraction drops from ~80% toward <30%; turnover <9h |
| 3 | **C** (3-wide workers) | super-batches/cycle (`grep "Engine done"`); new-contracts-merged/cycle; load avg | super-batches/cycle ≥2; ctp>0.25 count rises; load <7, no OOM |
| 4 | **D** (staircase) | `SELECT COUNT(*) FROM trade_ups WHERE type='staircase'` | >0 staircase rows; cycle stays within 30 min |
| 5 | **E1→E2→E3→E4** | profitable_count, avg `chance_to_profit`, count of "clears $N at ≥X%" bounded-downside contracts | bounded-downside-good count + avg ctp rise without revival death-rate spike |

**Baseline (FACT, prod 2026-06-25):** `industrial_milspec 389904 (44 prof / 274079 ctp25)`, `consumer_industrial 243123 (0 / 192216)`, `milspec_restricted 202316 (25523 / 147648)`, `covert_knife 192851 (2 / 141395)`, `classified_covert 121613 (2342 / 55401)`, `restricted_classified 117203 (10289 / 56152)`; **super-batches/cycle = 1**; **0 staircase rows**; **~80% >6h reprice-stale**.

**Deploy each stage:** `pm2 restart daemon` (code held in memory — hard restart required per CLAUDE.md). **Global rollback per lever** is the per-section rollback signal above.

---

## 5. Open questions / verify before coding

1. **Lever A knife regression.** Confirm knife `byColAdj` (built with `groupKey:"collection_name"`) also has `collection_id` populated, so switching the greedy loop to `collection_id` doesn't break knife. If `collection_id` is empty for the knife path, switch callers to id-keyed quotas instead. **Verify by reading `loadDiscoveryData` / `serializeDiscoveryData` field population.**
2. **Lever B exact multiple.** MED confidence on 6–10×. Benchmark the bulk-VALUES write (item 2) on a fixture *first* — it's what unlocks the high end; if most of the 110s is await-overhead not UPDATE round-trips, concurrency (item 1) dominates and 6× is the realistic ceiling.
3. **Lever C PG read concurrency.** 3 simultaneous discovery readers vs one PG backend already hitting 90% CPU during sig/data reads — confirm NDJSON/sig pre-materialization fully removed PG from the worker hot path (it should), else PG read becomes the new bind before cores do.
4. **Lever C merge starvation.** The per-round merge is single-threaded in main; 3 results/round vs 2 is +50% merge work. Confirm merge stays <~few seconds so it doesn't eat the freed exploration time.
5. **Lever D cadence.** Decide call-site (post-super-batch on every cycle vs every Nth cycle vs a `WORKER_ROUNDS` slot) and a hard time budget — staircase's N+1 queries (`staircase.ts:72,216`) must not blow `TARGET_CYCLE_MS`.
6. **Lever E3 boundary derivation.** Confirm `min_float/max_float` are reliably present per output skin (used to derive per-band ceilings); gloves are 0.06/0.80, but verify the data is populated for the full output set, and that capped-finish detection (Doppler/Marble/Tiger pinned `predicted_float`) is queryable so the curve gate skips them.
7. **Lever E1 trim consistency.** The 5M global trim orders by `roi_percentage ASC` only — if/when inventory approaches the cap, decide whether to make trim KPI-aware (chance/best/worst). Not urgent at 1.26M.
