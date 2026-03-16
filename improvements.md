# Trade-Up Bot — Remaining Improvements

Prioritized. Items marked DONE have been completed.

---

## Active Features (Working)

- **Knife/Glove trade-ups** — 377 profitable, $103 best, profit streaks (17x max)
- **Classified→Covert** — 513 profitable, $32.73 best, profit streaks (21x max)
- **Restricted→Classified** — 370 profitable, $1.12 best (newly working via merge-save)
- **Mil-Spec→Restricted** — 4,782 profitable, $1.56 best
- **Staircase** (50 Classified → 5 Covert → 1 Knife) — 95 profitable, $78.95 best
- **Discovery engine** — exhaustive float-targeted discovery across all rarity tiers
- **DMarket continuous fetcher** — 2 RPS, coverage-first (Restricted priority)
- **Data Viewer** — skin browser, scatter chart, price sources
- **Calculator** — user inputs specific skins, sees predicted outcomes

## Removed Features

- ~~Theory engine~~ — float hallucination bug (used fake 0.005 floats, not real 0.04-0.06), zero profitable materializations ever. Discovery finds all profits directly.
- ~~Materialization + Phase 7 re-materialization~~ — dead code, never produced results
- ~~Scanner (arbitrage + float sniper)~~ — KNN with 3-5 obs unreliable for rare items
- ~~StatTrak trade-ups~~ — 100% Skinport-only output pricing, no CSFloat sale data
- ~~Generic staircases (RC/RCK/MRC)~~ — intermediate stage variance too high
- ~~Theory-guided wanted list~~ — redirected budget to broad coverage (more effective)

---

## Priority 1: Data Quality

### 1. Sale history coverage (BUILDING — time-dependent)
- Restricted: ~20% → growing ~300 sales/cycle
- Mil-Spec: ~5% → growing ~240 sales/cycle
- Doppler phase-qualified observations accumulating via staleness checker

### 2. DB growth management
- DB at 6.6GB, growing from merge-save accumulation
- 30K cap per type for restricted/milspec prevents OOM
- Needs periodic VACUUM (last was days ago)
- Consider: cap stale trade-ups more aggressively

---

## Priority 2: Discovery Improvements

### 3. Dense float targets (DONE — 2026-03-16)
- Knife: 9 → ~45 float targets (dense around condition boundaries)
- Generic: 3 → 9 fixed coverage points
- Contributed to Restricted breakthrough (0 → 370 profitable)

### 4. Random exploration expanded (DONE — 2026-03-16)
- Classified: 200 → 500 iterations/cycle
- Knife: 0 → 300 iterations/cycle (was defined but never called!)
- Knife explore saves directly to DB but hasn't found profitable yet (small numbers game)

### 5. Chance-to-profit as first-class metric (DONE)
- TradeUpStore keeps trade-ups with >25% chance even if EV-negative
- Discovery bypasses profit/ROI filters for high-chance trade-ups
- evaluateTradeUp/evaluateKnifeTradeUp compute chance_to_profit directly

### 6. Further discovery ideas (NOT YET DONE)
- **More permutations for knife**: try all 5 condition-pure groups per collection (FN-only, MW-only, etc.) — currently does this but only from the cheapest pool. Could try 2nd and 3rd cheapest windows within each condition.
- **Cross-condition pair targeting**: for 2-collection knife combos, try mixing FN from collection A with FT from collection B at each split (currently float-targets the merged pool)
- **Incremental re-evaluation**: only re-evaluate combos where listing data changed since last cycle
- **Collection profitability scoring**: prioritize CSFloat budget toward historically profitable collections

---

## Priority 3: Features

### 7. Trade-Up Calculator (BUILDING)
- User inputs specific skins + floats, sees predicted outcomes
- Needs: skin autocomplete, rarity enforcement (can't mix rarities)
- New page at /calculator

### 8. Industrial Grade support
- TradeUpSpy shows Industrial→Mil-Spec trade-ups ($0.23 skins)
- We don't cover this tier yet — need DMarket fetcher to include Industrial Grade
- Ultra-cheap, automatable via DMarket purchase API

### 9. Zero-price knife outcomes inflate EV
- When a knife finish has no price data, it's skipped (probability doesn't sum to 1.0)
- Effect: ~5-15% EV inflation for trade-ups with many unpriced outcomes
- Fix: normalize EV by total probability

---

## Priority 4: Polish

### 10. Verify button should recalculate full EV
- Currently only updates input costs when prices change
- Should also re-evaluate output prices with current market data

### 11. DataViewer improvements
- Search responsiveness
- Collection drill-down showing trade-up opportunities

### 12. Deployment
- VPS for 24/7 operation
- Auth system + subscription tiers for monetization

---

*Last updated: 2026-03-16 07:55*
