# Review: rescued branch `vps-local-changes-2026-06-10`

Reviewed 2026-06-10 (advisor + fresh-context reviewer). The branch holds 5 files of uncommitted changes rescued from the production VPS working tree (commit `50bc538` on base `8954686`→`8394686`). Branch typechecks clean, zero forbidden casts, **zero tests**. Verdicts:

| File | Intent | Verdict | Plan |
|---|---|---|---|
| `server/daemon/phases/housekeeping.ts` | Gate orphan purge to every 10th cycle (anti-join over 11M-row table every cycle today) | **PORT** | 015 |
| `server/engine/knn-pricing.ts` | Scoped KNN observation loading + sargable date predicate + binary-search windows (fixes full 180-day load on web requests via listing-sniper) | **PORT** with fixes (bind-param chunking, tests, `Number(age_days)` coercion) | 016 |
| `server/routes/collections.ts` | Two query rewrites | **PARTIAL** — port hunk 1 (listing_counts CTE); discard hunk 2 (reads `trade_up_collection_index`) | 015 |
| `server/routes/data.ts` | Dataviewer query rewrites (MATERIALIZED CTEs) | **PARTIAL** — port with fix: multi-collection skins inflate `listing_count` via the skin_collections join (old `COUNT(DISTINCT l.id)` was immune) | 015 |
| `server/routes/trade-ups.ts` | Replace GIN collection filter with hand-made `trade_up_collection_index` table + per-sort btree ordering | **DISCARD** — conflicts with plan 007's batched counts (re-inlines removed subqueries), depends on out-of-repo schema, trigger overhead on the write path plan 010 optimized | — |

## Production cleanup required (operator decision)

Verified live on the VPS (2026-06-10): `trade_up_collection_index` EXISTS, **2,439 MB**, maintained by an ACTIVE trigger `trg_trade_up_collection_index` on `trade_ups`/`trade_up_inputs`. Since the VPS was reset to main, **nothing reads this table** — but every daemon write still pays the trigger. Recommended (after user sign-off):

```sql
-- inspect first
\d trade_up_collection_index
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('trade_ups'::regclass,'trade_up_inputs'::regclass);
-- then drop trigger(s) first, then the table (frees ~2.4GB, removes write-path trigger overhead)
```

If cold single-collection `/api/trade-ups` queries are still slow after the drop, the sanctioned mitigation is main's own documented one (composite/partial index shaping), not this table.

Full diff preserved at branch `vps-local-changes-2026-06-10` (origin) and `/tmp/vps-local-changes-2026-06-10.diff`.
