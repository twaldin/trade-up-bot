# Overnight Monitoring Notes

## Baseline (before changes)
- VPS IP: 178.156.239.58
- Daemon running on 3-vCPU Hetzner
- Worker batching: Batch 1 (knife+classified), Batch 2 (restricted+milspec), Batch 3 (industrial)
- Random exploration: 500 knife + 300 classified per cycle
- Deterministic: ~45 float targets (knife), ~9 float targets (gun)
- Cycle target: 12 min

## Improvement Ideas (prioritized)
1. Add swap optimization to gun discovery (knife has it, gun doesn't)
2. Increase random exploration iterations (currently very low)
3. Add collection-profit-weighted deterministic search (spend more combos on historically profitable collections)
4. Cross-condition pair generation in deterministic (MW+FT pairs, FN+MW pairs — different conditions often yield different output conditions)
5. "Near-miss" tracking — trade-ups within $2 of profitable get flagged, re-evaluated when listings change
6. Adaptive float targeting — build histogram of output float ranges, target transitions that actually exist in data
7. Multi-offset sliding windows — instead of offset 0,5,10, try offsets derived from price clustering

---

## Hourly Check Log

### 2026-03-17 06:00 — Baseline + First Deployment

**Baseline Stats:**
| Type | Total | Profitable | Max Profit | Avg Profit |
|------|-------|-----------|-----------|-----------|
| covert_knife | 7,364 | 603 | $129.98 | $59.69 |
| classified_covert | 22,045 | 580 | $2.61 | $0.71 |
| restricted_classified | 36,826 | 689 | $1.17 | $0.14 |
| milspec_restricted | 18,886 | 0 | $0 | - |
| industrial_milspec | 12,558 | 93 | $0.15 | $0.06 |

**Coverage:** 677 Covert skins (34,776 listings), 301 Classified (16,985), 463 Restricted (19,530), 672 Mil-Spec (29,370), 178 Industrial (11,400)
**CSFloat refs:** 5,571
**Cycle time:** 13.5 min (slightly over 12 target)
**Cooldown:** +218 explored, 36 improved per cycle
**Staleness:** 84% of verified listings already gone

**Key Observations:**
- milspec_restricted has ZERO profitable — 18,886 stored all negative EV. Needs more listing coverage or better pricing
- Knife profits dominate ($130 max) but classified is thin ($2.61 max)
- Cooldown already producing 36 improvements/cycle (swap optimization on knife)
- Gun trade-ups had NO swap optimization or cross-condition exploration

**Changes Deployed (commit 0b27890):**
1. Added swap optimization (strategy #6) to gun randomExplore — 15 candidates per slot swap
2. Added cross-condition random exploration (strategy #7) — FN+FT, MW+FT mixing
3. Made randomExplore generic (accepts inputRarity) — works for all tiers now
4. Added 200-iter random exploration to restricted/milspec/industrial calc phase
5. Added restricted/milspec exploration (500 iter each) to cooldown loop, alternating by batch
6. Net: ~3x more random combinations explored per cycle across all tiers

**Expected Impact:** More profitable trade-ups found via swap optimization on existing profitable combos. Cross-condition mixing finds output float sweet spots missed by pure-condition search. Lower-rarity tiers get exploration for the first time.

### 2026-03-17 07:17 — First check after deployment (1 cycle completed)

**Stats after Cycle 1 with new code:**
| Type | Total | Profitable | Max Profit | Avg Profit | Delta Profitable |
|------|-------|-----------|-----------|-----------|-----------------|
| covert_knife | 6,763 | 635 | $129.98 | $58.93 | +32 |
| classified_covert | 16,022 | 207 | $2.64 | $0.76 | -373 |
| restricted_classified | 49,981 | 1,248 | $1.17 | $0.16 | +559 |
| milspec_restricted | 21,134 | 0 | $0 | - | 0 |
| industrial_milspec | 13,709 | 102 | $0.15 | $0.06 | +9 |

**Process health:** All 3 online, 0 crashes. API 30m uptime, daemon 17m (restarted for deploy).
**Coverage:** Covert 677/34,782 (+6), Classified 301/16,997 (+12), Restricted 463/19,785 (+255), Mil-Spec 672/29,675 (+305), Industrial 178/11,563 (+163)
**CSFloat refs:** 5,598 (+27)
**Cycle time:** 12.6 min (improved from 13.5 baseline)
**Cooldown:** +247 explored, 55 improved (up from 218/36 — swap optimization on gun tiers working!)
**Staleness:** 70 checked, 52 removed (74%)
**DMarket:** Cycle 9, 191 API calls, 8,605 listings/cycle — healthy

**Discovery results from Cycle 1:**
- Knife: 4,653 found (220 profitable), explore +2 new/7 improved, revival 217 revived/90 improved
- Classified: 30,000 found (216 profitable), explore +16 new/0 improved
- Restricted: 30,000 found (606 profitable), explore +14 new/2 improved (**NEW — first time exploring**)
- Milspec: 20,677 found (0 profitable), explore +2 new/0 improved
- Industrial: 5,540 found (0 profitable), explore +1 new/0 improved

**Key Observations:**
1. **Restricted exploded: +559 profitable** (689→1,248). New exploration is finding real profit — 14 new + 2 improved in just one cycle.
2. **Classified dropped: -373 profitable** (580→207). Concerning but likely from stale listing purge + merge-save cycling. Total also dropped 22K→16K. Many listings went stale (517 purged + 52 removed by verify). This naturally reduces profitable count as inputs disappear.
3. **Knife up +32** (603→635). Swap optimization contributing — 7 improved in explore + 90 improved via revival.
4. **Cooldown improvements up 53%** (36→55). Swap optimization on gun tiers is additive.
5. **Milspec still zero** — 672 skins/29,675 listings but zero profit. This rarity tier may structurally lack profitable combinations due to pricing gaps (output Restricted skins are cheap, input Mil-Spec skins are also cheap, margins too thin). Not actionable without pricing improvements.
6. **Listing churn is massive** — 74-84% of verified listings are already gone. Freshness is critical.

**Assessment:** No changes needed yet. Restricted improvement is clearly positive. Classified drop is concerning but explained by natural listing churn. Will observe 2+ more cycles to see trends stabilize.

