# Test Suite Design

## Philosophy
Tests should validate **behavior and correctness**, not implementation details.
A good test fails when the code is wrong, not when the code is refactored.

## Unit Tests (server/engine/)

### Float Calculation (`core.test.ts`)
- Output float from 10 identical inputs = expected adjusted float
- Output float with mixed float ranges produces correct weighted average
- Edge case: all inputs at min_float → output at min_float
- Edge case: all inputs at max_float → output near max_float
- Condition boundary: 0.069999 input produces FN output, 0.070001 produces MW

### Trade-Up Evaluation (`evaluation.test.ts`)
- Profitable trade-up: cost < EV → positive profit, correct ROI
- Unprofitable trade-up: cost > EV → negative profit
- Chance to profit: 3/5 outcomes profitable → 60% chance (weighted by probability)
- Zero-value outcomes handled gracefully (no division by zero)
- Marketplace fees correctly deducted from output prices

### Knife Evaluation (`knife-evaluation.test.ts`)
- Single-knife collection: correct probability distribution
- Multi-collection: probabilities weighted by input proportions
- Doppler phases expanded correctly (each phase separate outcome)
- Glove finishes included when collection has glove gen

### Merge-Save (`db-ops.test.ts`)
- New trade-up inserted correctly
- Existing trade-up updated with better stats
- Missing trade-ups NOT marked stale (sig-skipping behavior)
- Global trim removes worst ROI, preserves profitable
- Trim preserves knife trade-ups (highest value tier)

### Price Cache (`pricing.test.ts`)
- CSFloat sale price takes priority over DMarket floor
- DMarket floor used as gap-fill when CSFloat unavailable
- Skinport floor used when both CSFloat + DMarket missing
- KNN pricing for knife/glove skins at specific floats
- Seller fees correctly deducted per marketplace

### Fee Calculations (`fees.test.ts`)
- CSFloat buyer cost: price * 1.028 + 30 (cents)
- DMarket buyer cost: price * 1.025
- Skinport buyer cost: price * 1.0 (no buyer fee)
- Seller proceeds after fees (CSFloat 2%, DMarket 2%, Skinport 12%)

## Integration Tests (server/routes/)

### Claims Flow (`claims.test.ts`)
- Claim → listings marked claimed_by → trade-up shows lock
- Claim → Confirm → listings deleted from DB → trade-up stale
- Claim → Release → listings unclaimed → trade-up available
- Claim → Expire (30 min) → daemon releases
- Can't claim stale trade-up
- Can't claim theoretical trade-up
- Can't re-claim after confirm
- Listing-level conflict: reject if listing already claimed
- Rate limit: 11th claim in 1 hour → 429
- Non-pro user → 403

### Verify Flow (`verify.test.ts`)
- Active listing → status "active"
- Sold listing → deleted, status "sold", propagated to other trade-ups
- Price changed → updated in DB, recalculated stats
- Skinport listing → price-proximity check
- Rate limit: basic 10/hr, pro 20/hr
- Free user → 403

### Trade-Up List (`trade-ups.test.ts`)
- Free tier: 10 trade-ups per type, 3hr delay
- Basic tier: 30-min delay, unlimited
- Pro tier: real-time, unlimited
- Show stale OFF: no partial/stale in results
- Show stale ON: includes partial/stale with badges
- Auto-correction: active with missing inputs → corrected to partial
- Claimed listings hidden from other users
- my_claims filter returns only user's claimed trade-ups

### Auth (`auth.test.ts`)
- Steam login → session created → user stored
- /api/auth/me returns user data
- Tier gating: free/basic/pro endpoint access

## Stress Tests

### Concurrent Users (`stress/concurrent.test.ts`)
- 50 users browsing trade-ups simultaneously during daemon Phase 4b
- Measure P50/P95/P99 response times
- Verify Redis cache hit rate > 90%
- Verify no 500 errors during daemon writes

### Claim Contention (`stress/claims.test.ts`)
- 5 users claiming trade-ups with overlapping listings
- Verify only 1 claim succeeds per listing
- Verify other users get 409 conflict
- Measure claim response time under contention

### DB Lock Testing (`stress/db-lock.test.ts`)
- API reads during daemon mergeTradeUps (30K row transaction)
- API reads during Phase 4b recalc
- Verify read-only connections aren't blocked
- Measure worst-case response time

## Running Tests
```bash
# Unit tests
npx vitest run tests/unit/

# Integration tests (needs running API + test DB)
npx vitest run tests/integration/

# Stress tests (needs running API + daemon)
npx k6 run tests/stress/concurrent.js
```
