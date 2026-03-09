# Trade-Up Bot — Session Notes

## Session: 2026-03-09 (Continued)

### Best Trade-Ups Found

**#1 BEST: Wildfire + Danger Zone (51.4% chance!)**
- Cost: $171 | 4x M4A4 The Battlestar (Wildfire) + 1x AWP Neo-Noir (Danger Zone)
- Bowie Knife (Wildfire, 6.67%/finish) + Navaja/Stiletto/Talon/Ursus (Danger Zone, 0.45%/finish)
- 31 of ~55 outcomes profitable
- Best: Talon Fade FN $961 (+$790)

**#2: Wildfire Only -> Bowie Knife (50% chance)**
- Cost: $158 | 5x M4A4 The Battlestar (Wildfire Collection)
- 6 of 12 Bowie finishes are profitable (pure coin flip!)

**#3: Huntsman + Snakebite (49.2% chance)**
- Cost: $156 | 4x Desert-Strike (Huntsman) + 1x In Living Color (Snakebite)
- Best: Sport Gloves Nocts WW $686 (+$530)

**#4 Best $200-300: Danger Zone Mix (45.5% chance)**
- Cost: $226 | Danger Zone collection inputs

### Data Stats (Latest — Session 2)
- 605+ profitable knife trade-ups total (was 531 at start of session 2)
- 51.4% max chance to profit
- 27,762 total knife trade-ups in DB
- Daemon running continuous optimization, finding ~15-23 new budget trade-ups per pass

### Code Changes — Session 2
1. **Steam bot removal** (~1,480 lines deleted):
   - Deleted: steam-engine.ts, steam-daemon.ts, SteamApp.tsx
   - Cleaned: main.tsx (simplified to single App), index.ts (removed /api/steam/status), index.css, TradeUpTable.tsx (removed steam link mode)

2. **Engine refactoring continued** (engine.ts: 3358 → 2607 lines, -22%):
   - NEW: engine/core.ts — calculateOutputFloat, calculateOutcomeProbabilities
   - NEW: engine/data-load.ts — getListingsForRarity, getOutcomesForCollections, getNextRarity
   - NEW: engine/selection.ts — addAdjustedFloat, selectForFloatTarget (parametric count), selectLowestFloat
   - NEW: engine/store.ts — TradeUpStore class
   - NEW: engine/evaluation.ts — evaluateTradeUp
   - NEW: engine/db-ops.ts — saveTradeUps, saveKnifeTradeUps, updateCollectionScores
   - NEW: engine/knife-evaluation.ts — getKnifeFinishesWithPrices, evaluateKnifeTradeUp
   - Deduplicated knife selection helpers → use parametric selectForFloatTarget(count=5)
   - Total: 10 engine submodules, 1,174 lines extracted

3. **Bug fix: Phase 8/9 clearFirst** (CRITICAL):
   - Reverse lookup and StatTrak phases called saveKnifeTradeUps(clearFirst=true)
   - This wiped ALL 27k+ knife trade-ups every 6th optimization pass
   - Fixed: now use saveTradeUps(db, profitable, false, "covert_knife") to append

4. **UI improvements**:
   - Added filter presets: "Best Odds $150-300", "High Upside", "Low Risk", "Profitable", "All"
   - Compact 4-column filter grid layout (was single row)
   - 3-tier chance color coding: green (50%+), yellow (30-50%), gray (<30%)
   - Updated CLAUDE.md with new module structure

### Pending Tasks
- [ ] Web app: more UI polish, consider @tanstack/react-table (already installed but unused)
- [ ] Continue engine.ts refactoring (remaining ~2607 lines: discovery, explore, optimize functions)
- [ ] Clean up old steam_* trade-ups from DB (need to run when daemon is idle)
- [ ] Fetch more knife/glove sale history (506 records is thin)
- [ ] Look for time inefficiencies in sync.ts (hardcoded 3-5s sleeps)

### Daemon Status
- PID: 35525 (restarted at 06:24 with clearFirst fix)
- Running continuous optimization passes
- Full recalc every 6th pass + budget hunts + breakpoint optimizer + random explore
- Phase 8/9 now correctly append results instead of wiping
