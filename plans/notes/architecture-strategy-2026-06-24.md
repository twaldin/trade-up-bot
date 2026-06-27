# Architecture & Daemon Strategy Guide — 2026-06-24

**Scope.** How to extract more profitable-trade-up discovery and fresher market data from the existing
monolith. Covers: (a) restructuring the daemon for more calculation/exploration per cycle, (b) the
multi-cookie/multi-auth/pods plan to lift the CSFloat rate-limit ceiling and cut the 462h staleness,
(c) other strategies to extract more profit from data we already hold.

**FACT vs INFERENCE** is tagged throughout. FACT = queried prod / read code on 2026-06-24/25.

---

## 0. TL;DR for the owner

1. **The box is not 3-vCPU.** It is an **8-vCPU / 15 GiB Hetzner CPX41** (`nproc`→8, `free -h`→15Gi,
   commit `8af4038 "docs: record CPX41 rescale + PG retune"`). During discovery it runs at **load ~2.5
   of 8** — roughly **70% idle**. The binding constraint is **software, not hardware**.
2. **Two $0 software caps dominate everything:**
   - A hardcoded **4-round / ≤2-parallel-worker** structure (`WORKER_ROUNDS`, `daemon/index.ts:109`)
     on an 8-core box.
   - A **single-threaded, per-outcome-`await` reprice loop** (`repriceTradeUpOutputs`,
     `db-stats.ts:179-220`) that leaves **82% of stored trade-ups (1,017,903 of 1,239,277) with profit
     numbers >6h stale; 1,374 never repriced.** Full backlog pass ≈ 12 days.
3. **The 462h CSFloat staleness is mostly cosmetic for trade-up quality.** The ~269 listings that back
   *currently-profitable* contracts are already kept at **~3.1h** by an existing priority CTE
   (`csfloat-checker.ts:106-115`, `WHERE tu.profit_cents > 0 AND tu.is_theoretical = false`). The 462h
   is overwhelmingly speculative coverage. Multi-key/pods buys *second-order* discovery upside, not
   first-order quality — and it's the **most expensive** lever, so it goes last.
4. **Recommended sequence: fix the two $0 software caps first** (P0), then cheap experiments
   (priority-tier widening, 2-key pilot), then vertical/horizontal scale **only after** the 8 cores
   actually saturate.

---

## 1. Current-state map (FACT)

### 1.1 Hardware & processes
- **Box:** Hetzner CPX41, 8× AMD EPYC-Rome vCPU, 15 GiB RAM, 6 GiB swap. Uptime 13d 11h.
- **PM2 processes** (one box, monolithic):

  | proc | role | cpu (idle) | mem | restarts |
  |---|---|---|---|---|
  | daemon | discovery loop + reprice + fetch | ~0% sleep / load-2.07 active | 17 MB | 1 |
  | checker | CSFloat individual-pool staleness loop | 0.2% | 32 MB | 1 |
  | fetcher | DMarket/Skinport fetch | 0% | 16 MB | 0 |
  | buff-fetcher | Buff.market fetch | 0% | 17 MB | 1 |
  | api | Express REST | 0% | 60 MB | **17** |
  | discord-bot | alerts | 0% | 17 MB | 0 |
  | pm2-logrotate | — | 0.2% | 25 MB | 0 |

- **Load:** `2.57 / 2.06 / 1.74` at sample (active worker round); ~0.6 during sleep. **~6 of 8 cores
  idle even at peak.** No OOM in `dmesg`. RAM 8.1Gi used / 7.1Gi available. **Not CPU-bound, not
  RAM-bound, not OOM-prone today.**
- **Postgres 16:** `max_connections=100`, `shared_buffers=4GB`, `max_parallel_workers=8`. Forked
  discovery workers are read-only (`max:3` pool each). Merge writes serialized on the daemon main
  thread (`mergeTradeUps` upsert-by-signature). Lots of connection headroom.

### 1.2 The 30-minute cycle (FACT, daemon.log cycles 582–584; `TARGET_CYCLE_MS=30min`)
Cycle 583 = 36.1 min wall. Reconstructed:
- Phase 1/3/4 housekeeping+probe+fetch: ~2.6 min
- **Phase 4c reprice: ~120s** — but completes only ~2,000 of the 20,000 requested (log: 1977/1941/2385/2081)
- **Pre-materialize 6 discovery NDJSON files: ~126s** (single-threaded, on main)
- **Precompute 6 sig files: ~35s** (single-threaded, on main)
- → **~4.7 min of single-threaded setup runs inside Phase 5 before any worker starts**
- Super-batch worker wall-time ≈ 18 min; most cycles complete only **1** super-batch (sometimes 2)

So of a 36-min cycle, **actual discovery compute ≈ 18 min (50%)**, and during it only **2 of 8 cores**
run. Effective discovery utilization ≈ **1 core-equivalent of 8 ≈ 12–25%.**

### 1.3 Stored trade-ups by type (FACT, queried 2026-06-25)

| type | rows | profitable | best (¢) |
|---|---|---|---|
| industrial_milspec | 378,461 | 44 | 4 |
| consumer_industrial | 234,978 | 0 | -31 |
| covert_knife | 183,699 | 8 | 125 |
| milspec_restricted | 166,853 | **12,865** | 45 |
| restricted_classified | 141,874 | **13,374** | 195 |
| classified_covert | 133,412 | **4,974** | 1,064 |

Post-cliff (cliff week = 2026-06-08), the gun tiers (milspec/restricted/classified) still carry
**31,213 profitable** contracts; knife (8) and consumer (0) are genuinely thin. **Discovery compute
spent on gun tiers has high marginal yield; on knife it has diminishing returns** (INFERENCE, grounded
in the 8-vs-13,374 split). Worker sig-skip ratios this cycle (milspec 2.2%, industrial 5.5%, consumer
2.5%) confirm exploration is **still >94% novel combos — the space is NOT exhausted.**

### 1.4 Data freshness by source (FACT, queried 2026-06-25)

| source | listings | avg staleness |
|---|---|---|
| csfloat | 925,885 | **462.0h** |
| dmarket | 406,554 | **1.0h** |
| buff | 124,134 | 11.3h |

CSFloat staleness split by whether a listing backs a live-profitable trade-up (FACT, established):

| bucket | count | avg staleness | never-checked |
|---|---|---|---|
| profitable-backed | **269** | **3.1h** | 0 |
| general/speculative | 925,806 | 462.1h | 3,448 |

---

## 2. Bottleneck diagnosis — CPU vs RAM vs rate-limit

| resource | bound? | evidence |
|---|---|---|
| **CPU** | **NO** | load 2.5/8 at peak; ~6 cores idle; node compute <1 full core mid-worker |
| **RAM** | **NO** | 8.1Gi/15Gi used, 7.1Gi available, no OOM in dmesg; swap barely touched |
| **PG capacity** | **NO** | 1–2 active conns of 100; 4GB shared_buffers; forked workers read-only |
| **Discovery throughput** | **YES — software** | hardcoded 2-worker rounds + 4.7min serial in-cycle setup; only 1 super-batch/cycle |
| **Profit freshness** | **YES — software** | serial per-outcome reprice loop; 82% of trade-ups >6h stale, full pass ≈12d |
| **CSFloat blanket staleness** | **YES — rate-limit (structural)** | one API key, 50K/day individual pool; full 926K corpus floors at ~445h even flat-out |
| **CSFloat *profitable* staleness** | **NO — already solved** | priority CTE keeps the 269 that matter at 3.1h |

**Verdict:** the revenue levers in priority order are (1) **profit-freshness** (today's discovery output
decays to 12-day-stale before users see it), (2) **discovery throughput** (gun tiers still >94% novel),
(3) **blanket CSFloat freshness** (second-order: only matters if fresher speculative data surfaces *new*
profitable contracts — scarce post-cliff: Jun22 had 21 profitable covert_knife). The first two are **$0
software fixes**; the third is the expensive multi-auth project.

---

## 3. Prioritized roadmap

### P0a — Fix the reprice loop (profit-freshness root cause). $0. **Highest value.**
**Problem (FACT, `db-stats.ts:179-220`):** `repriceTradeUpOutputs` is asked for 20,000 rows/cycle but
clears ~2,000 in its ~120s window. It loops rows serially and does `await lookupOutputPrice(pool, ...)`
**per outcome (~10/row)** inside a serial per-100 transaction batch, all on the main daemon thread
(~7ms each). ~2k rows × ~10 awaits ≈ ~20k awaits ≈ 120s. Throughput ≈ 2,000/cycle × ~1.7 cycles/hr ≈
**3,400/hr → a full pass over the 1.0M backlog takes ~12 days.** profit_cents is derived from output EV,
so **most stored trade-ups display profit up to ~12 days stale.**

**Fix (three stacking changes):**
1. **Batch the lookups against the in-memory price cache.** `buildPriceCache` (5-min TTL) is already
   loaded; collect all `(skin_name, predicted_float)` pairs for the batch and resolve in one pass
   instead of `await` per outcome. Most lookups should never touch PG. *(Open: trace `lookupOutputPrice`
   fallback tiers to confirm cache-hit rate before relying on it.)*
2. **Parallelize off the main thread.** Either move EV recompute into a forked worker (it's read-only;
   only the final `UPDATE` needs the main thread) or run **one dedicated reprice worker** alongside
   discovery workers — there are idle cores.
3. **Raise the per-cycle target** once fast enough to clear the backlog. Goal: **full 1.0M pass in <24h**.

**Expected:** profit numbers go from ~12-day-stale to <1-day-stale. Likely worth **more than extra
discovery**, since today's discovery decays before users see it. **Cost $0. Complexity: medium
(parallelism + cache plumbing). Risk: low.**

### P0b — Lift the worker cap. $0. **Biggest throughput-per-dollar.**
**Problem (FACT, `daemon/index.ts:109-114`):** `WORKER_ROUNDS` is a hardcoded 4-round structure running
≤2 workers/round on an 8-vCPU box. Each tier gets ~1/4 of the Phase-5 budget (~4.5 min) inside the one
super-batch that usually completes.

**Fix — two clean options:**
- **(a) Flatten to one round of 6 parallel workers** (the 6 tiers), each getting the **full** Phase-5
  budget (~18 min vs ~4.5). Reserve ~1.5 cores for PG + main-thread merge/reprice.
- **(b) Keep rounds, raise concurrency to 3–4.**

**Expected: 2.5–3× more explore-seconds/cycle/tier → roughly proportional growth in novel profitable
combos for the gun tiers** (which skip <6%). INFERENCE: 2–3× more profitable gun trade-ups
surfaced/cycle. Skew the extra budget toward milspec/restricted/classified, not knife (8 profitable).
**Cost $0. Complexity: low. Risk: low** (CPU/RAM/PG headroom all confirmed). **Watch:** main-thread
`mergeTradeUps` is serialized — at 6× concurrency it could become the new bottleneck; needs a load test.

### P1 — Move the 4.7-min in-cycle setup off the critical path. $0.
**Problem (FACT):** pre-materialize NDJSON (126s) + sig files (35s) run serially on main *before* any
worker starts, every cycle. **Fix:** (a) compute in a forked helper concurrently while the first round
runs on last cycle's files, or (b) cache discovery files across cycles, refreshing only rarities whose
listings changed (FreshnessTracker already tracks listing changes). **Reclaims ~3–4 min/cycle ≈ +10%
discovery time. Cost $0. Complexity: low–medium.**

### P2 — Split read-API onto its own box. ~€4–7/mo. **Only if API latency/contention appears.**
api is fork-mode, 60 MB, 0% CPU, but **17 restarts**. PG has headroom today, so this is **not urgent**.
If P0b adds workers and merge contention grows, move `api` to a CPX11/CX22 pointing at the same PG.
**Complexity: low. Priority: low** — current bottleneck is compute scheduling, not API.

### P3 — Vertical scale, only AFTER P0 saturates the 8 cores. ~€30→€55/mo.
Once 6 workers + parallel reprice push load toward 8.0, step to **CPX51 (16 vCPU / 32 GB, ~€55/mo)** →
12–14 workers. Near-linear throughput for ~2× cost. **Do NOT do this first** — today you'd pay for idle
cores. **Complexity: trivial (resize). Gain: ~2× discovery throughput over a saturated CPX41.**

### P4 — Decoupled compute fleet / managed PG (the "target" architecture). ~€80–150/mo.
Separate boxes: (1) write-daemon + managed Postgres, (2) a **stateless discovery worker fleet** reading
pre-materialized NDJSON from a shared volume/object store and POSTing results to a merge queue,
(3) fetchers on their own box. The worker→NDJSON interface is already half-built (workers serialize
results to NDJSON). **Requires building a result-merge queue** to lift the single-PG-write-merge ceiling.
**Highest throughput ceiling, highest complexity.** Justified **only after P0–P3 prove discovery
throughput — not data freshness — is the revenue lever.** Note: giving *fetchers* more CPU does nothing
(rate-limit-bound, not CPU-bound).

---

## 4. The CSFloat multi-auth / pods plan (cut the 462h)

### 4.1 How auth & rate-limits actually work (FACT, code)
- **Single API key, header-based, no IP coupling in our code.** Every call sends `Authorization: <key>`
  (`csfloat.ts:40-42`, `csfloat-checker.ts:255`) from one env var `CSFLOAT_API_KEY`. `grep -rniE
  "proxy|multi.?key|apiKeys|keyPool"` over `server/` finds **zero** multi-key/proxy infra.
- **3 pools, shared 24h lockout** (`state.ts:10-16`, verified 2026-03-20): Listings 200/~1h, Sales
  500/~24h, Individual 50K/~24h. If **any** pool hits 0, **all** lock ~24h. Safety buffers keep us in
  rolling-replenishment. **This coupling is per-key** — each independent key has its own 3 pools and its
  own lockout.
- The 50K individual pool is owned by the standalone `checker` (`csfloat-checker.ts`), looping
  `GET /listings/:id` at `DEFAULT_INTERVAL_MS=1700` (~35/min). Daemon owns listings+sales.

### 4.2 The staleness ceiling (FACT, math)
Live checker: `totalChecked 564,358` since `2026-06-11T19:52Z` → 13.46d → **41,941 checks/day = 29.1/min**
(below the 35/min config — ~17% lost to errors, per-listing recalc, 90-min queue rebuilds, buffer
pauses). `poolRemaining 32,482` of ~50K → **pool is NOT the live bottleneck; pacing is.**
- At 41,941/day → full 926K pass = **22.1 days = 530h** (explains the observed 462h average).
- At the 50K/day ceiling → **18.5 days = 445h.** **One key floors blanket staleness at ~445h.**

### 4.3 The reframe (FACT)
Blanket 462h is **mostly cosmetic for trade-up quality.** The 269 profitable-backed listings are already
at **3.1h** via the existing priority CTE. Multiplying the rate ceiling N× mainly freshens *speculative*
listings — valuable only insofar as fresher speculative data surfaces *new* profitable contracts that
aren't currently visible. Post-cliff that pool is thin (21 profitable covert_knife on Jun22). **So
multi-auth is a second-order lever and goes after the $0 software fixes.**

### 4.4 Multi-auth scaling model (INFERENCE, high confidence)
Limits are **per-key, not per-IP** in everything we can see (key is per-account; limit headers travel
with the authenticated request; no per-IP signal in code). So **N independent keys scale blanket
freshness ~N×**:

| keys | aggregate individual budget | full-corpus staleness |
|---|---|---|
| 1 | 50K/day | ~445h |
| 2 | 100K/day | ~265h |
| 3 | 150K/day | ~177h |
| 4 | 200K/day | ~133h |
| **~19** | ~950K/day | **<24h** (926K / 50K) |

**Sub-24h on the whole corpus needs ~19 keys** — almost certainly over-engineered for the actual goal.

**Code change (modest):** a key-pool abstraction that round-robins `apiKey` across calls and maintains a
`BudgetTracker` per key; the checker shards its queue by `listing_id mod N` so keys don't double-check.
Each key keeps its own 24h-lockout accounting — **so one key tripping the lockout loses only 1/N of
throughput. This is a resilience win vs today's single point of failure.**

### 4.5 What breaks / risks
1. **CSFloat ToS / account risk.** Many keys to bypass rate limits is bannable; each key likely needs a
   distinct Steam-verified account. **Acquisition — not code — is the real bottleneck.** (Open: does ToS
   permit multiple keys/accounts per operator?)
2. **Possible undocumented per-IP edge throttle.** UNVERIFIED. If CSFloat throttles by source IP, many
   keys on one box/IP won't scale and you need multiple IPs (proxies/pods). **This single fact decides
   keys-only vs pods.**
3. **Shared-IP fingerprinting.** All calls use one hardcoded `User-Agent` (`csfloat.ts:37`). N keys +
   1 UA + 1 IP is trivially detectable.
4. **Box capacity.** The checker is I/O-bound (1 req/1.7s), so N shards add little CPU, but each does DB
   writes (price updates + cascades) → **Postgres write load scales ~N×.**

### 4.6 Pods design (only if fresh-everything is required AND per-IP throttle is real)
K worker pods (cheap Hetzner CX-class or proxied containers), each: own account/key + own egress IP;
shared central Postgres over private network; **partition the staleness space by `listing_id` hash mod
K** (add `WHERE (...id...) % K = <pod_index>` to `buildCheckQueue`, `csfloat-checker.ts:104`). Freshness
gain ~K× on the general pool (K=4 → ~130h; K=19 → ~24h). **Cost:** K× key acquisition + K small VPS
(~€4–8/mo each) + K× PG write load + a key-pool/sharding change + per-pod monitoring.

### 4.7 Cheaper alternatives (do these FIRST)
1. **Widen the priority tier** beyond `profit_cents>0` (only 269 listings today). Extend the CTE in
   `buildCheckQueue` (`csfloat-checker.ts:106`) and `checkListingStaleness` (`listings.ts:98`) to also
   keep **near-profitable** (`profit_cents > -200`) and high-value-collection inputs fresh — the
   listings most likely to *become* profitable on a price move. **Near-zero cost; directly captures the
   second-order benefit multi-key would buy.**
2. **Close the 29→35/min gap.** ~17% headroom lost to errors, the 90-min `QUEUE_REBUILD_INTERVAL_MS`,
   and inline per-listing trade-up recalc (`csfloat-checker.ts:315-340`). Batch the recalcs and
   streamline the rebuild → **~20% staleness improvement, $0, no new keys.**
3. **Lean on DMarket for coverage.** DMarket is already 406K @ **1.0h** (own continuous fetcher, no
   shared lockout). The engine treats sources as substitutable for inputs. Where DMarket covers a
   collection, CSFloat staleness matters less. **Verify DMarket covers the speculative tiers before
   buying CSFloat keys.**
4. **2-key pilot (decision gate).** Add ONE second key + round-robin (one box, same IP). If staleness on
   a sharded subset roughly halves, per-IP throttling is a non-issue and **keys-only on one box** works —
   far cheaper than pods. If it doesn't scale, you've confirmed you need multiple IPs/pods. **Highest-
   information, lowest-cost next experiment on the freshness axis.**

---

## 5. Other ways to extract more profit from existing data (no new market data)

- **Stop serving stale profit (P0a).** The single biggest "free profit": today's surfaced "best profit"
  is partly a stale-data artifact (12-day-old EV × 462h-old inputs). Fresh reprice makes the existing
  corpus *more accurate*, which is worth more than more rows. (FACT: 82% of trade-ups >6h stale.)
- **Skew compute to high-yield tiers.** classified_covert has 4,974 profitable contracts incl. best
  1,064¢; restricted/milspec carry 26K+ combined. Knife (8) and consumer (0) are mined out post-cliff.
  Allocate P0b's extra worker-seconds by *current profitable density*, not evenly.
- **Implement the stubbed adaptive structured/explore split.** `calc-worker.ts:155` hardcodes 0.6
  ("will adapt in future cycles" — not implemented). Structured discovery returns few rows where the
  curated space is mined out (knife=3); explore keeps yielding (milspec 661, restricted 181). A real
  adaptive split would shift effort to explore where structured is exhausted — an exploration-efficiency
  win at $0. (Open: needs its own measurement.)
- **Be honest about the post-cliff ceiling.** The cliff (Jun08) is **~80% real market compression**
  (output prices fell 20–42% Apr→Jun while inputs stayed flat; ~85% bilateral liquidity freeze in the
  cliff week), ~17% model/data distortion of magnitude, ~0% self-inflicted regression. **No amount of
  compute or freshness manufactures profit that the market isn't paying.** These levers maximize how much
  of the *real* remaining edge we surface and keep accurate — they do not reverse the market.

---

## 6. Recommended sequence

| step | action | cost | complexity | expected gain |
|---|---|---|---|---|
| **1** | **P0a** — parallelize + batch reprice loop | $0 | medium | profit numbers 12d-stale → <1d-stale (accuracy, not new rows) |
| **2** | **P0b** — flatten WORKER_ROUNDS to 6 parallel workers, skew to gun tiers | $0 | low | 2.5–3× explore-seconds/tier → ~2–3× novel profitable gun trade-ups |
| **3** | **P1** — move 4.7-min setup off critical path | $0 | low–med | +~10% discovery time/cycle |
| **4** | §4.7.1 — widen CSFloat priority tier to near-profitable + HV inputs | ~$0 | low | most of the freshness benefit multi-key would buy |
| **5** | §4.7.2 — close 29→35/min checker gap | $0 | low | ~20% blanket staleness improvement |
| **6** | §4.7.4 — 2-key round-robin pilot (per-IP decision gate) | 1 key | low | resolves keys-vs-pods empirically |
| **7** | **P3** — vertical scale to CPX51 (only after 8 cores saturate) | ~€25/mo Δ | trivial | ~2× discovery throughput |
| **8** | keys-on-one-box (if pilot scales) up to CPU/PG-write/per-IP limit | N keys | medium | each key ~halves remaining blanket staleness + lockout resilience |
| **9** | **P4 / pods** (only if per-IP throttle is real AND fresh-everything required) | €80–150/mo | high | sub-24h blanket freshness; ~19 keys for full corpus — likely over-engineered |

**Why this order:** the box is paid for and ~70% idle during discovery; the two binding constraints are
**software caps**, both $0 to remove. The CSFloat multi-auth project is the most expensive lever and buys
only the *second-order* benefit (fresher speculative data → maybe new contracts), so it sits behind the
free software fixes and the cheap priority-tier/pilot experiments. Vertical (P3) and horizontal (P4)
scaling only make sense once P0 actually saturates the 8 cores — until then you'd be paying for idle
hardware.

---

## 7. Open questions (load-bearing unknowns)
- **Is CSFloat's limit per-IP in addition to per-key?** Not derivable from code; the 2-key-same-IP pilot
  (step 6) is the decision gate for keys-vs-pods.
- **Does CSFloat ToS permit multiple keys/accounts per operator?** Not checked; determines whether key
  acquisition is even feasible.
- **How many *additional* profitable contracts would fresher speculative data actually surface
  post-cliff?** The entire ROI of multi-auth hinges on this; with only ~21 profitable covert_knife on
  Jun22, the upside may be small — which is exactly why it's last.
- **Does `lookupOutputPrice` hit the in-memory cache or fall through to PG on the hot path?** P0a.1
  assumes mostly cache; trace the fallback tiers before relying on it.
- **Main-thread `mergeTradeUps` cost at 6× worker concurrency** — could become the new bottleneck; needs
  a load test (PG conn headroom exists, but the merge is serialized on main).
