## What I changed

- Added a focused reproduction test:
  - `tests/integration/collection-filter-repro.test.ts`
- Test setup creates only unprofitable active trade-ups for `Test Collection Beta`, then applies `collection=Test Collection Beta` filter on `/api/trade-ups`.
- Test asserts:
  1. DB has active non-theoretical trade-ups for that collection (`COUNT(DISTINCT t.id) > 0`), and
  2. API should return at least one row for the same collection filter.

## Result

- The test fails as expected on current code:
  - API returns `trade_ups.length = 0` despite matching rows existing in DB.

## Why this reproduces the reported bug

- It captures the exact mismatch surface: collection appears to have trade-ups, but filtered table is empty.
- This isolates backend filtering behavior in `/api/trade-ups` for collection filters.

## Risk / reviewer focus

- Test adds `collection_names` column in-test to match route assumptions.
- Reviewer should focus on collection-filter query behavior (especially implicit `profit_cents > 0` path) as likely root-cause candidate.
