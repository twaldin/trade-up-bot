# Trade-Up Bot — Remaining Improvements

Prioritized. Items marked DONE have been completed and committed.

---

## Active Features (Working)

- **Knife/Glove trade-ups** — 395 profitable, $104 best, profit streaks tracking
- **Classified→Covert** — 478 profitable, $32.73 best
- **Restricted→Classified** — variable (0-294 profitable), thin margins
- **Mil-Spec→Restricted** — variable (100-2100 profitable), tiny margins
- **Original Staircase** (50 Classified → 5 Covert → 1 Knife) — 95 profitable, $85 best
- **DMarket continuous fetcher** — 2 RPS, inline staleness, Extraordinary coverage
- **Theory engine** — knife + classified + restricted + milspec theories
- **Data Viewer** — all rarities, unified listing table, scatter chart
- **Calculator** — (building) user inputs specific skins, sees predicted outcomes

## Removed Features

- ~~Scanner (arbitrage + float sniper)~~ — KNN with 3-5 obs unreliable for rare items, pattern-unaware
- ~~StatTrak trade-ups~~ — 100% Skinport-only output pricing, no CSFloat sale data
- ~~Generic staircases (RC/RCK/MRC)~~ — intermediate stage variance too high without Monte Carlo

---

## Priority 1: Data Quality

### 1. Restricted/Mil-Spec sale history (BUILDING)
- Restricted: ~20% → growing ~300 sales/cycle
- Mil-Spec: ~5% → growing ~240 sales/cycle
- No code change needed — just time

### 2. Phase-qualified Doppler observations (BUILDING)
- Staleness checker now records sold Dopplers with phase name
- Zero phase-qualified obs so far — needs ~50+ cycles
- Enables accurate per-phase pricing for Doppler knife trade-ups

### 3. Unify price_data and price_observations
- CSFloat sale history stores individuals in `sale_history` AND `price_observations` (DONE)
- But `price_data` aggregates are still independently fetched — could derive from observations instead
- Low priority since the backfill already connected the two tables

---

## Priority 2: Accuracy

### 4. Zero-price knife outcomes inflate EV
- When a knife finish has no price data, it's skipped (probability doesn't sum to 1.0)
- Effect: ~5-15% EV inflation for trade-ups with many unpriced outcomes
- 22 Extraordinary skins are trade-locked (Dead Hand) — will resolve when they unlock
- Fix: normalize EV by total probability

### 5. DB growth management
- DB grows ~400MB/cycle from merge-save accumulation
- Stale TTL reduced to 2 days (from 7)
- May need periodic VACUUM or more aggressive purging
- Consider: cap total trade-ups per type (e.g., keep top 50K only)

---

## Priority 3: Features

### 6. Trade-Up Calculator (BUILDING)
- User inputs specific skins + floats, sees predicted outcomes
- Reuses existing evaluation engine
- New page at /calculator

### 7. Monte Carlo staircase simulator
- Separate process that runs probability simulations on trade-up chains
- Would make multi-stage staircases actionable
- Large effort (~4 hours), enables re-enabling generic staircases with accurate variance

### 8. Re-enable StatTrak
- Needs CSFloat ST sale data accumulation (months)
- Or DMarket sale history integration (can't distinguish sold vs delisted)
- Low priority — ST market is thin

---

## Priority 4: Polish

### 9. Verify button recalculates EV
- Currently only updates input costs when prices change
- Should also re-evaluate output prices with current market data

### 10. DataViewer remaining polish
- Specific filter bugs may surface with use
- Search could be more responsive
- Collection drill-down could show trade-up opportunities

### 11. Frontend performance
- Memoization opportunities in TradeUpTable (row rendering)
- Lazy loading for expanded trade-up details
- Already fast enough for normal use

---

*Last updated: 2026-03-16 02:30*
