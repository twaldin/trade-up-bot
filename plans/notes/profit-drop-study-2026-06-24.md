# Why Did Prime Dead Hand Trade-Up Profits Plummet?

**A deep-research forensic study of the June 2026 "covert_knife" cliff**

_Date: 2026-06-24 · Repo: trade-up-bot · DB: tradeupbot (Postgres 16, prices in integer cents)_

---

## 1. Executive Summary

**One-line answer: The cliff was a real, market-driven collapse — Dead Hand glove/knife OUTPUT prices fell 20–42% (April→June) while INPUTS held flat, closing the trade-up spread; an ~85% bilateral liquidity freeze in the week of June 8 turned that gradual slide into a sub-week cliff. It was NOT us removing false profits (every profit-math file was last edited in March 2026 and ran unchanged through the entire window), and NOT a discovery regression (coverage held steady and the only self-inflicted bug landed two days AFTER profits already hit zero).**

The owner's hopeful hypothesis — _"my own commits removed phantom profits in this window"_ — is **FALSIFIED for the cliff window**. The scary hypothesis — _"I broke discovery / starved the data"_ — is **also FALSIFIED**. What remains is the honest, business-neutral truth: a maturing collection's economics closed, and the bot faithfully reported it.

### Attribution at a glance

| Cause | Share | Type | Verdict |
|---|---|---|---|
| Real market compression (output prices fell, inputs flat) | ~60% | Market | Genuine, in raw third-party sales |
| Liquidity collapse / bilateral volume freeze (cliff-week trigger) | ~20% | Market | Genuine; turned slide into cliff |
| Survivorship-biased avg_cost inflation | ~12% | Model/data artifact | Exaggerates magnitude, doesn't create cliff |
| KNN output over-valuation on thin comps | ~5% (opposing sign) | Model artifact | Props profits UP, cannot cause the drop |
| Self-inflicted post-cliff discovery stall (plan-016 OOM/RangeError) | ~0% of cliff | Code regression | Real bug, landed 2 days too late to matter |

**Bottom line: ~80% genuine market move, ~17% model-side distortion of magnitude (not direction), ~0% regression-caused.**

---

## 2. The Cliff

### Scope correction (FACT — load-bearing)

`market_snapshots` and `snapshot_tradeups` track **only `type='covert_knife'`** (`SELECT DISTINCT type FROM market_snapshots` → 1 row). There is **no per-cycle historical timeline for the other 5 tiers** — only point-in-time `trade_ups` + `peak_profit_cents`. All day-level cliff forensics below are **knife/glove-tier only**; cross-tier comparison (§2.4) is peak-vs-now.

Note on the tier label: `covert_knife` is a misnomer — it spans covert→**knife** AND covert→**glove** outputs. At peak, the top-25 was genuinely MIXED: Nomad Knife Doppler (696 rows, max 1698c) AND Driver Gloves (579 rows, max 1613c). Neither single-output framing is complete.

### 2.1 Day-level timeline (FACT, queried 2026-06-24)

Daily covert_knife from `market_snapshots`, cents:

| Day | max_best | avg_best | max profitable_count | coverage_skins | coverage_listings |
|---|---|---|---|---|---|
| Jun 01 | 1261 | 1092 | 6374 | 529 | 233,520 |
| Jun 02 | 1308 | 1101 | 4778 | 529 | 245,679 |
| Jun 03 | 1129 | 1129 | 2037 | 527 | 240,854 |
| Jun 04 | 1098 | 846 | 2900 | 528 | 243,449 |
| Jun 05 | 623 | 585 | 1369 | 529 | 237,324 |
| Jun 06 | 615 | 551 | 1339 | 528 | 244,329 |
| Jun 07 | 545 | 517 | 374 | 527 | 236,813 |
| **Jun 08** | **549** | **433** | **65** | 529 | 244,560 |
| **Jun 09** | **−51** | **−51** | **0** | 528 | 238,122 |
| Jun 10 | −156 | −166 | 0 | 529 | 242,630 |
| Jun 11 | −129 | −174 | 0 | 529 | 251,070 |

**Query (reproducible):**
```sql
SELECT date_trunc('day', snapshot_at)::date d, MAX(best_profit_cents) max_best,
       ROUND(AVG(best_profit_cents)) avg_best, MAX(profitable_count) max_pc
FROM market_snapshots
WHERE snapshot_at >= '2026-06-01' AND snapshot_at < '2026-06-12'
GROUP BY 1 ORDER BY 1;
```

### 2.2 Shape: an 8-day slide with a hard terminal break

`profitable_count` bleeds out continuously over 8 days: **6374 → 4778 → 2037 → 2900 → 1369 → 1339 → 374 → 65 → 0**. This is the signature of a **continuous economic decay, not a single-day code step** (a regression produces a cliff in one snapshot; this is a slope). The decay actually started ~Jun 2–4; the hard terminal break is the **Jun 8 23:00 → Jun 9 08:00 UTC** window (best 94 → −51, count → 0).

The grounding "collapse week = Jun 8" is correct as the _terminal_ week. The true onset is earlier (Jun 2–4).

### 2.3 What died (FACT, `snapshot_tradeups` grouped by input collections × week)

| Input collections (output) | May 25 wk | Jun 1 wk | Jun 8 wk | Fate |
|---|---|---|---|---|
| **Dead Hand + Fever** (★ Nomad Knife Doppler) | 2597 rows, max **1698**, avg 1277 | max 1261, avg 760 | 34 rows, max **−337** | **Died outright; vanishes from top-25 after Jun 8** |
| Fever alone | max 1653, avg 1182 | — | survived to Jun 22 (max 135) | Near-break-even remnant |
| Dead Hand + Prisma 2 | — | peak (max **1308**) | — | Caused brief Jun 15–17 dead-cat bounce (max 1022), then died |
| Prisma / Prisma 2 alone | — | — | appear Jun 8+ | Unprofitable fillers (avg −126 to −296) surfaced once good combos gone |

**The single dominant profit engine was Dead Hand + Fever → ★ Nomad Knife Doppler (Phase 1–4 / Ruby) FN** — 1041+591+554 top-25 appearances across May25/Jun1. Secondary: Navaja Doppler and Driver Gloves (Wave Chaser/Garden) combos. **It is specifically Dead-Hand-anchored trade-ups that died.** Fever-only persists at break-even.

### 2.4 Cross-tier: knife lost the most, lower tiers survived (FACT, `trade_ups`, point-in-time)

| Tier | med_peak | p95_peak | ever_profitable | profitable_now | % survive |
|---|---|---|---|---|---|
| covert_knife | 1857 | 22837 | 19651 | **8** | **0.0%** |
| classified_covert | 160 | 2437 | 61056 | 4974 | 8.1% |
| restricted_classified | 19 | 417 | 59286 | 13374 | 22.6% |
| milspec_restricted | 9 | 91 | 57817 | 12865 | 22.3% |
| industrial_milspec | 5 | 36 | 30502 | 44 | 0.1% |
| consumer_industrial | 226 | 517 | 182 | 0 | 0.0% |

The **high-value knife layer collapsed totally** (8 of 19,651 profitable). The **bread-and-butter low-margin tiers (restricted/milspec) are intact** at 20%+ survival, but their peaks were tiny (≤25c median). The loss is concentrated in the one tier that ever made real money per contract.

> **Caveat on `peak_profit_cents`:** knife peaks of 50,996c ($510) on Operation Hydra input combos **never appeared in realistic snapshots** (capped ~1700c) and now show −5K to −31K. INFERENCE (well-supported): these are **KNN over-extrapolation on illiquid Hydra knife outputs**, not real money. When quoting "what was lost," use the **~1700c snapshot_tradeups figure**, not `peak_profit_cents` max.

---

## 3. Causal Attribution

### Ranked causes & verdict

**[HIGH] 1. Real market compression (~60%).** Output prices fell, inputs held flat — independent of our code. Raw `price_observations` source='sale': Driver Gloves FT median **19,736 (Apr27) → 14,545 (May25) → 15,864 (Jun08)**; Nomad Doppler avg **~58,000 (May11) → 40,619 (Jun01)**. Inputs ~flat: Queen's Gambit + Fully Tuned medians **5,837 (May25) → 6,299 (Jun08), +8%**. The decline started in April/May (pre-cliff) — a continuous slide, not a step.

**[HIGH] 2. Liquidity collapse / bilateral freeze (~20%) — the proximate cliff trigger.** Sale volume dropped ~85% on BOTH sides simultaneously (a market-freeze signature, not per-side supply). Driver Gloves sale n: 487(May25)→100→84→2(Jun15). Input sale n: 311(May25)→30→37. This also starves the bot of cheap live LISTINGS, raising executable cost even at flat sale prices. The hard break is Jun 8 23:00 → Jun 9 08:00 UTC.

**[MEDIUM] 3. Survivorship-biased avg_cost inflation (~12%) — model/data artifact, NOT a code change.** As cheap input listings were bought out, only higher-cost combos survived the top-25, mechanically inflating reported avg_input_cost **+16% (19,483→22,648)** despite raw input sales rising only ~8%. distinct_inputs collapsed 466→597→310→86. This makes the _reported_ curve fall harder than true economics — exaggerates magnitude, does not create the cliff. Present in both old and new code (math untouched since March).

**[MEDIUM] 4. KNN output over-valuation on thin comps (~5%, OPPOSING sign).** With glove sale liquidity <100/wk, the float-sensitive KNN priced outputs off sparse/stale comps, holding implied output EV at ~22–23K (Jun08–15) while raw glove sales printed ~16K. This makes the bot **OVER-value outputs — propping reported profit UP, not down.** It cannot have caused the cliff; if anything it softened the reported drop. Listed only because it distorts the reported _shape_.

**[HIGH-confidence, ~0% of cliff] 5. Self-inflicted post-cliff discovery stall.** plan-016 KNN port RangeError + Phase-5 OOM (`a9d7417`, `37948fe`, dated **2026-06-11**). A REAL regression — but it landed **2 days AFTER** profitable_count already hit 0 (Jun 9), and never zeroed discovery (resume-from-state held total_tradeups at 35–41K through the stall). Zero contribution to the cliff itself.

### Verdict

**~80% genuine market move · ~17% model-side distortion of magnitude (not direction) · ~0% regression.** The cliff is predominantly a real, maturing-collection market collapse. Our own pricing makes the _reported_ drop look somewhat sharper than true economics (survivorship bias) while simultaneously over-valuing surviving outputs (KNN lag) — these warp the curve's shape but cannot manufacture the drop, because the underlying margin compression exists in the raw third-party sale data regardless of our code.

---

## 4. The Git Ledger

**Headline: No profit-affecting math changed in the cliff window.** Every profit-path file was last edited in **March 2026** and ran unchanged through the entire May 26 → Jun 25 snapshot history.

### 4.1 Last-touched dates of profit-math files (FACT, `git log -1`)

| File | Last math commit | Date |
|---|---|---|
| `server/engine/fees.ts` | `2530a43` | **2026-03-26** |
| `server/engine/pricing.ts` | `f327c83` | **2026-03-29** |
| `condition-multipliers.ts` | — | 2026-03-28 |
| `evaluation.ts` / `core.ts` | — | 2026-03-20 |
| `knn-pricing.ts` | (only post-March: 06-10/06-11 port) | — |

The Skinport 12%→8% seller-fee fix and the float-exact KNN / output-float-ceiling / sticker-premium purges all shipped **March 16–29, 2026** — months before the cliff, already baked into the May peak (1698c). They cannot produce a June-8 step. The May 26→Jun 8 snapshot history already ran on the corrected model.

### 4.2 The June 10–11 mass deploy (FACT — all POST-cliff)

`git log --since=2026-06-09 --until=2026-06-12` is one mass deploy of perf plans 001–021 (rescued uncommitted VPS work), landing **2 days after** the Jun 8→9 break. Classification of the profit-relevant commits:

| Hash | Date | What | Classification |
|---|---|---|---|
| `00a941d` | 06-10 | KNN port step 2: load/cache split, sargable predicate, `Number(age_days)` coercion | **NEUTRAL (perf)** — plan-016 STOP-condition: "any ratio snapshot change = bug." knnTimeDecay, weights, `KNN_MAX_OBS_AGE_DAYS=180`, median logic unchanged. |
| `4baabd1` | 06-10 | KNN port steps 3-4: scoped loading, pair chunking, binary-search ±0.04 window, memoization | **NEUTRAL (perf)** — loading mechanics + new chunk-size const; no fee/float/cap/decay constant touched. |
| `999d4a5` | 06-10 | fold `peak_profit_cents` into INSERT, batch input inserts | **NEUTRAL** — `Math.max(profit_cents,0)` matches old "UPDATE only when profit>0"; profit/roi/EV unchanged from engine. |
| `1055b38` / `a6422fa` | 06-10 | batch merge reads / hoist condition pools | **NEUTRAL (perf)** — query batching + loop hoist, no logic change. |
| `302db56` `33aa2d2` `16c71ce` `63a19da` | 06-10 | batch CSFloat sale/observation inserts, jitter retries | **NEUTRAL** — ingest batching only. |
| `a9d7417` | 06-11 | replace `allRows.push(...rows)` spread with for-of loop | **REAL REGRESSION (self-inflicted, then fixed)** — the 06-10 port crash-looped the daemon with RangeError on >125K-row chunks. Introduced BY the port, fixed next day. **Post-cliff.** |
| `37948fe` | 06-11 | free stale global `_knnCache` before scoped build (Phase 5 OOM relief) | **REAL REGRESSION (self-inflicted, then fixed)** — plan-016 made global + scoped caches coexist (~hundreds of MB), OOM-killing the daemon before workers forked → "fully stalled" 06-10/11. Fixed 06-11; swap widened 2GB→6GB. **Post-cliff.** |
| `c2b3212` | 06-11 | collection-index drop | **NEUTRAL** — freed ~2.4GB dead trigger-maintained table; memory relief, not a discovery feature. |
| `8af4038` | 06-11 | CPX41 rescale + PG retune | **NEUTRAL** — "discovery resumed, incident closed." |

**Ledger summary:** 0 commits removed false profits in the window. 0 commits changed profit math. 2 commits (`a9d7417`, `37948fe`) were real self-inflicted regressions — both dated 2026-06-11, both AFTER profits hit 0 on Jun 9, both fixed same-day. They explain a brief post-cliff _throughput_ dip (3–9 cycles/day Jun 10–13 vs ~45/day after) but **not** the profit collapse.

---

## 5. Market-Side Evidence

### 5.1 Output prices fell hard, April→June (FACT, raw third-party sales)

`price_observations`, source='sale', FT band, weekly avg (cents):

| Output (FT) | Apr 20/27 | May 11 | May 25 | Jun 08 | peak→cliff |
|---|---|---|---|---|---|
| Driver Gloves Wave Chaser | 34,021 | 26,638 | 22,088 | 19,763 | **−42%** |
| Driver Gloves Hand Sweaters | 23,718 | 18,807 | 14,716 | 15,731 | **−34%** |
| All Driver Gloves (median) | 20,000 | 17,692 | 14,545 | 15,864 | **−21%** |
| ★ Nomad Knife Doppler (avg) | — | ~58,000 | — | 40,619 (Jun01) | **−30%** |

The whole output basket repriced down 20–42% across the cliff window. **Raw third-party sale prints — not model output — so this is market fact, not artifact.**

### 5.2 Inputs did NOT rise → compression is output-side (FACT)

`price_observations` source='sale', weekly median: AWP|Queen's Gambit 6,073→6,170; Glock-18|Fully Tuned 5,786→6,410 (May25→Jun08). Flat-to-slightly-up. Margin compression came **from the output side**, not an input pump.

### 5.3 Bilateral liquidity freeze in the cliff week (FACT)

Weekly sale counts: Driver Gloves sales 2,024(May11) → 873(May25) → 171(Jun01) → **135(Jun08)** → 56(Jun15). Dead Hand input sales 311(May25) → 30(Jun01) → **37(Jun08)**. A simultaneous ~85% drop in BOTH input and output volume in the cliff week is a classic **market-froze / panic** pattern, not a one-sided supply story.

### 5.4 Coverage held steady — NOT data starvation (FACT, queried 2026-06-24)

Through the entire cliff: `coverage_skins` steady **527–529**; `coverage_listings` held **233K–251K** (see §2.1 table). `api_sale_remaining` and `api_listing_remaining` were healthy (the 0/3 listing-remaining values are sparse-low-cycle-day artifacts on Jun 3/6/9/10, not lockouts). The bot did NOT go blind. (`api_individual_remaining` is 100% NULL / never logged — cannot be directly tested — but rising coverage makes individual-pool starvation implausible.)

### 5.5 Calendar-aligned external shocks (web research, corroborated)

1. **Souvenir Trade-Up Update (IEM Cologne 2026), launched May 22, 2026.** Valve admitted souvenir skins into trade-up contracts. Documented effect: inputs and outputs move in opposite directions — souvenir _inputs_ pumped, normal-quality covert/glove _outputs_ DUMPED via panic selling and preemptive undercutting. Butterfly/Karambit/rare gloves dropped **40–70% within hours**. Lands 2.5 weeks before the Jun-8 collapse — exactly the lag for sale prints to roll into weekly data.
2. **Broader 2026 CS2 market crash.** "$160–170M wiped in 48h post-update"; "knives and gloves dropped almost 50% since major updates"; market cap down ~50% from peak. A new Covert→knife/glove trade-up mechanic "fundamentally altered trade-up profitability" — cheap covert "fuel" spiked, premium outputs crashed.
3. **Dead Hand lifecycle.** 7-day trade lock expired ~Mar 19; FN gloves hit the open market, glove supply +~1,100%, prices "settle toward equilibrium as terminal supply flows through" — already pushing outputs down through April–May. The May 22 update + macro crash accelerated it into the June cliff.

_Sources: skincasereviewer.com/blog/cs2-souvenir-tradeup-update-blog · community.skin.club/en/news/the-cs2-skin-market-keeps-crashing-in-2026 · skinlords.com/blog/knife-and-glove-prices-plummet-due-to-cs2s-new-knife-trade-up-feature · steamanalyst.com/guides/dead-hand-trade-up._

### 5.6 The one model-side divergence (INFERENCE, well-supported)

| Week | avg_input_cost | avg_implied_output_EV (KNN) | best_profit | avg_roi |
|---|---|---|---|---|
| May25 | 19,598 | 20,875 | 1,698 | +6.5% |
| Jun01 | 21,480 | 22,322 | 1,308 | +3.9% |
| **Jun08** | **25,096** | **24,822** | **549** | **−1.1%** |
| Jun15 | 24,247 | 24,320 | 1,022 | +0.3% |

Paradox: the bot's _priced_ output EV ROSE to 24,822 even as raw spot glove sales fell to ~15,864 median. Two effects: (a) **survivorship bias** in avg_cost (distinct combos 527→141→30; only expensive combos survived, inflating avg_input_cost +28% without a true input rise); (b) **KNN lag** off stale/sparse comps holding output EV ~55% above spot. Both distort the reported curve. Critically, the KNN effect props profits UP — it cannot have manufactured the cliff. The cliff is in the raw sales regardless.

---

## 6. Were the May Profits Ever Real / Claimable?

**Partially. The headline peak (1698c, Dead Hand + Fever → Nomad Knife Doppler FN) was anchored in real market conditions but was likely thinner and more fragile than reported, for three reasons:**

1. **The dominant ~1700c trade-up was REAL in shape** — it appeared consistently across hundreds of top-25 rows over multiple weeks (2597 rows in the May25 week), priced off a then-liquid glove/knife output market with real sale prints in the 20K–58K range. This was not a single-snapshot phantom.

2. **But "claimable" requires liquidity that was already thinning.** The bot buys from the cheapest LIVE listings; we have no `listing`-source price history for these skins (only `sale`/`skinport_sale`), so the cheapest-buy trajectory is inferred, not measured. As sale volume fell (873→171→135/wk), the cheap inputs the model assumed were increasingly bought-out — meaning the _executable_ margin was below the reported margin even at peak. You could likely have claimed _some_ of the 1698c, but not at the depth/repeatability the snapshot count implies.

3. **The 50,996c ($510) "peaks" were model artifacts, full stop.** Those Operation Hydra knife combos never appeared in realistic snapshots (capped ~1700c) and were KNN over-extrapolation on illiquid outputs. They were never real money. **Anyone quoting "$510 trade-ups" was quoting a pricing artifact, not the market.**

**Verdict: the realistic peak (~1700c) was real-but-fragile and partially claimable; the extreme peaks (peak_profit_cents max) were never claimable. The drop to zero is honest — it reflects a real market that closed, with the model's survivorship + KNN-lag distortions making the reported peak look slightly fatter and the reported decline slightly sharper than the true economics.**

This is a _good_ result for trust: the bot didn't crash because it was lying and got caught; it reported a real opportunity that the market subsequently removed.

---

## 7. Open Questions / What to Verify Next

1. **No daily timeline for the 5 non-knife tiers.** `market_snapshots` is knife-only. We cannot say whether the (small) restricted/milspec peaks died on the same Jun-8 boundary or earlier — only current state (§2.4) is known. _To verify: add per-tier snapshotting going forward, or reconstruct from `snapshot_tradeups` if any non-knife rows exist (they don't currently)._

2. **No `listing`-source price history for the Dead Hand inputs/outputs.** The actual cheapest-buy (executable) cost trajectory across the cliff is inferred, not measured. This is the single biggest gap in proving the §6 "claimability" claim. _To verify: check whether the daemon stored historical min-listing per cycle anywhere; if not, start logging it._

3. **`api_individual_remaining` is 100% NULL (0/807 rows).** The individual-pool-starvation hypothesis cannot be tested directly. Rising coverage makes it implausible, but it's an untested edge. _To verify: instrument the column._

4. **`peak_profit_cents` has no timestamp.** We don't know WHEN each row's peak occurred relative to the cliff. `preserved_at` / `output_repriced_at` exist but were not queried per-row here. _To verify if synthesis needs peak timing: join those columns._

5. **Quantifying the March false-profit fixes.** I did NOT byte-diff the March KNN/fee changes against pre-March behavior to count how many phantom knives those removed. They're out of the cliff window and irrelevant to it (snapshot history starts 2026-05-26, already on the corrected model), but if the owner wants to know the historical impact of those fixes, that's a separate study.

6. **The Jun 15–17 dead-cat bounce (max 1022c, Dead Hand + Prisma 2).** Confirm whether this was a genuine brief arbitrage window or a transient KNN comp-staleness artifact before it, too, died.

---

_End of study. All FACT rows are queried against production tradeupbot or read from git on 2026-06-24. INFERENCE rows are flagged inline._

---

## Multi-KPI reframe: chance-to-profit + bounded downside

_Appended 2026-06-25. Reframes the "profit drop" around more than raw `profit_cents` (EV − cost): (1) `chance_to_profit` = Σ probability of outcomes whose value > cost, and (2) bounded-downside framing "X% chance to clear $N, worst case −$M on a $C stake". Mathematically all of this reduces to EV, but the framing surfaces contracts that raw-EV ranking buries._

### Semantics check (FACT — read from `server/engine/utils.ts`)

- `computeChanceToProfit(outcomes, cost)` = sum of outcome probabilities where `estimated_price_cents > totalCostCents`. It is the literal "hit rate."
- `computeBestWorstCase` returns **profit relative to cost**: `bestCase = max(output) − cost`, `worstCase = min(output) − cost`. So in every table below, `best_case_cents` / `worst_case_cents` are signed profit, not raw value. A negative `worst_case_cents` is a partial loss, and **fraction of stake recovered in the worst case = `(worst_case_cents + total_cost_cents) / total_cost_cents = 1 + worst_pct`**.

### 1. Did chance / spread collapse on the same June 8 cliff as EV? (FACT)

`market_snapshots` (covert_knife, the only tier with a timeline) — `avg_chance` vs the EV columns across the cliff:

| Day | avg_chance | max_best_profit (c) | avg_profit (c) | max_roi | profitable_count (sum) |
|-----|-----------|---------------------|----------------|---------|------------------------|
| 2026-05-30 (peak era) | 0.244 | 1698 | 368 | 8.98 | 144,289 |
| 2026-06-05 | 0.226 | 623 | 143 | 3.16 | 7,196 |
| 2026-06-07 | 0.223 | 545 | 97 | 2.41 | 1,219 |
| **2026-06-08 (cliff)** | **0.226** | 549 | 109 | 2.28 | **93** |
| 2026-06-09 | 0.222 | **−51** | 0 | −0.23 | **0** |
| 2026-06-12 | 0.233 | −151 | 0 | −0.62 | 0 |
| 2026-06-24 (now) | 0.258 | 111 | 61 | 0.56 | 432 |

**Finding: chance_to_profit did NOT collapse. EV did.** From the May-30 peak era to the Jun-9 trough, `avg_profit` went 368 → 0, `max_best_profit` went 1698 → −51 (sign flip), `profitable_count` went 144K → 0 — but `avg_chance` barely moved (0.244 → 0.222, −9%) and has since *risen* to 0.258 (highest in the window) as of now. The knife outputs still "hit" (land above cost) about a quarter of the time both before and after the cliff; what changed is that the **margin when they hit** thinned to near zero and the cheapest executable input cost crept up enough to flip the sign.

`snapshot_tradeups` (per-row, knife) confirms the spread also held: `avg_spread` (best−worst profit) was 321,355c on 2026-05-26 and 312,932c on 2026-06-25 — essentially flat across the whole window, ±3%. The *distribution shape* of outcomes did not compress; only its position relative to cost shifted.

**Interpretation (INFERENCE): a meaningful part of the headline "profit drop to 0" is a ranking/framing artifact of EV-thresholding.** The contracts that scored `profit_cents > 0` vanished, but the *same contracts* still clear cost ~22–26% of the time with an unchanged best/worst spread. Under a "high chance, bounded downside" lens the tier degraded gradually (margin thinned), not catastrophically (it did not stop working).

### 2. Realistic downside — what fraction of the stake is actually at risk? (FACT)

You almost never lose 100%. The floor is the worst output's value, not zero. From `snapshot_tradeups` (knife timeline), `worst_pct = worst_case_cents / total_cost_cents` and recovered-fraction `= 1 + worst_pct`:

| Day | avg_worst_profit (c) | avg_cost (c) | avg worst_pct | worst-case stake **recovered** |
|-----|----------------------|--------------|---------------|-------------------------------|
| 2026-05-26 | −15,500 | 19,794 | −0.783 | ~22% |
| 2026-06-12 | −19,358 | 24,538 | −0.791 | ~21% |
| 2026-06-25 | −17,586 | 21,915 | −0.801 | ~20% |

For knives the worst case is brutal (~−80% of stake) and stable across the cliff — knives are a high-variance tier. But across the **current `trade_ups` table by tier** (active rows), the worst-case-as-%-of-stake varies enormously:

| Type (active) | n | avg_chance | avg_profit (c) | avg worst_profit (c) | avg worst_pct | worst-case recovered |
|---------------|---|-----------|----------------|----------------------|---------------|----------------------|
| restricted_classified | 94,004 | 0.195 | −9,405 | −18,666 | −0.707 | ~29% |
| classified_covert | 103,597 | 0.219 | −6,751 | −12,812 | −0.390 | **~61%** |
| milspec_restricted | 106,084 | 0.290 | −7,253 | −9,120 | −0.769 | ~23% |
| covert_knife | 180,582 | 0.259 | −10,928 | −36,363 | −0.855 | ~15% |
| industrial_milspec | 326,930 | 0.333 | −2,516 | −6,011 | −0.926 | ~7% |
| consumer_industrial | 211,462 | 0.326 | −7,327 | −9,604 | −0.976 | ~2% |

**Finding: "you don't lose everything" is true and tier-dependent.** The *typical* (table-wide average) worst case is a partial loss of 39–98%, not a wipeout — but the cheap tiers (consumer/industrial) recover almost nothing in the worst case (~2–7%) because their floor output is near-worthless, while `classified_covert` keeps ~61% of stake even in its worst outcome. The honest headline is **"worst case you keep most of your money in covert-output trade-ups; in knife and low-tier trade-ups the worst case is near-total loss."** The blanket "almost no trade-up loses 100%" claim holds on average but is weakest exactly where the marketing is most tempting (cheap-entry low tiers).

### 3. Today's "good under bounded-downside framing" trade-ups that raw-profit ranking buries (FACT)

Query: active `trade_ups`, gun tiers, `chance_to_profit ≥ 0.6 AND profit_cents > 0`. This class **exists and is large** but is ranked low by the default `profit_cents DESC` sort because its per-contract profit is small (sub-$5):

| Type | rows with chance≥0.6 & profit>0 | of those, worst_pct > −0.20 (bounded) | best (least-negative) floor |
|------|-------------------------------|---------------------------------------|------------------------------|
| restricted_classified | 1,916 | 1,916 (100%) | −0.036 (~96% recovered) |
| classified_covert | 481 | 465 | −0.292 (~71% recovered) |
| milspec_restricted | 0 | 0 | — |

Concrete examples, phrased honestly:

| Tier | chance | clear (profit) | worst case | stake | Phrasing |
|------|--------|----------------|-----------|-------|----------|
| restricted_classified | 100% | +$0.18 | −$0.13 | $8.46 | "100% chance to clear ~$0.18, worst case −$0.13 on an $8.46 stake (you keep 99%+)" |
| classified_covert | 100% | +$4.32 | +$2.03 | $52.65 | "100% chance to profit; even the worst output clears +$2.03 on a $52.65 stake" |
| classified_covert | 100% | +$2.84 | +$0.55 | $54.13 | "100% chance to clear ~$2.84, worst case still +$0.55 on a $54.13 stake — zero downside" |
| classified_covert | 100% | +$2.81 | +$1.24 | $37.86 | "Every outcome profitable: +$1.24 to +$7.42 on a $37.86 stake" |

Note the strongest examples are **`chance_to_profit = 1.0` with a positive worst case** — i.e. literally *every* output clears cost. Raw-EV ranking sorts these below a single high-variance knife combo with a fatter headline number, so a profit-DESC UI hides the safest contracts on the board. (INFERENCE: these are low-stake, low-margin "grind" trade-ups; they are exactly what a risk-averse or volume user would want, and exactly what the current default sort buries.)

### 4. What the engine optimizes now vs. what it could (FACT — read-only, no code changed)

**Discovery / retention (`server/engine/store.ts`):**
- Retention rule: keep a trade-up if `profit_cents > 0` **OR** `chance_to_profit ≥ 0.25`. Chance is already a first-class *survival* gate — high-chance EV-negative contracts are deliberately kept (confirmed in `engine/CLAUDE.md`).
- Ranking score: `tradeUpScore = profit_cents + (ctp > 0.25 ? ctp * 5000 : 0)`. Profit is the primary axis in **cents**; chance adds at most 5,000c (one-time bonus, not scaled). So a contract with +$60 profit and 30% chance outranks a 100%-chance +$3 contract (6000+1500 vs 300+5000 → 7500 vs 5300). **Chance is a tiebreaker among similar-profit contracts, not a co-equal ranking axis.**
- `best_case_cents` / `worst_case_cents` are **computed and persisted** (`db-save.ts`, `db-revive.ts`, `db-stats.ts`) but are **not part of the discovery score at all** — downside never influences what the daemon surfaces or retains.

**API / UI (`server/routes/trade-ups.ts`):**
- Default list sort is `profit_cents DESC` (`sortMap[sort] ?? "t.profit_cents"`, default `sort="profit"`).
- All the multi-KPI plumbing already exists as optional sorts/filters: `sort=chance|best|worst`, and filters `min_chance/max_chance`, `min_win` (`best_case_cents ≥`), `max_loss` (`worst_case_cents ≥`). Frontend reads these in `TradeUpTable.tsx`, `CalculatorPage.tsx`, `MyTradeUpsPage.tsx`, `TradeUpSharePage.tsx`.

**Would a multi-KPI rank change what surfaces? Yes (INFERENCE).** The data is fully present; only the *default ordering* is profit-first. A composite default such as sorting first on `chance_to_profit DESC` within a downside floor (`worst_pct > −0.2`), then `profit_cents DESC`, would lift the 1,916 restricted_classified and 465 classified_covert bounded contracts above high-variance knife headlines — without any change to discovery or the math. No engine code was modified for this study.

### 5. Honest + marketable phrasing template

The template that is simultaneously honest and good for marketing, derived directly from the persisted KPIs:

> **"{chance_to_profit}% chance to clear ${profit_cents/100}, worst case {worst_case_cents<0 ? "−" : "+"}${|worst_case_cents|/100} on a ${total_cost_cents/100} stake."**

When `worst_case_cents ≥ 0`, escalate to the strongest honest claim: **"Every outcome is profitable — guaranteed +${worst_case_cents/100} to +${best_case_cents/100} on a ${total_cost_cents/100} stake."** Optionally append the recovered-fraction for losing-floor contracts: **"worst case you keep {round((1+worst_pct)*100)}% of your stake."** This avoids the two dishonest extremes — the old "$510 profit" KNN artifact (§6) and the implicit "you could lose it all" — by always quoting the real, bounded floor.

_End of multi-KPI reframe. FACT rows queried against production `tradeupbot` and read from repo source on 2026-06-25; INFERENCE rows flagged inline._
