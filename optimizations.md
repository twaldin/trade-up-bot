# Trade-Up Bot Performance Optimization Report

**Date**: 2026-03-17
**VPS**: 178.156.239.58 (tradeupbot.app)
**Specs**: AMD EPYC-Rome 3 vCPU, 4GB RAM, 75GB SSD, no swap

## Executive Summary

The app is **not placebo slow** — there are real, measurable bottlenecks. The `/api/collections` endpoint takes **15.7 seconds** to respond. The root causes are:

1. **Correlated subqueries** in the collections route scanning millions of rows per collection
2. **1.7GB WAL file** never checkpointed — SQLite reads must scan the WAL on top of the 2.2GB main DB
3. **ANALYZE never run** — SQLite query planner is flying blind on index selection
4. **2MB SQLite page cache** on a 3.9GB database — constant disk I/O
5. **No HTTP compression** — nginx and Express both send uncompressed JSON
6. **No browser caching headers** — every navigation re-fetches all data
7. **RAM pressure** — 4 Node processes use ~1.6GB, DB files total 3.9GB, no swap

The VPS itself is adequate for this workload once the software issues are fixed. No need to upgrade hardware.

---

## Measured API Response Times (localhost, no network)

| Route | Time | Size | Verdict |
|-------|------|------|---------|
| `/api/status` | 185ms | 1.6KB | OK |
| `/api/trade-ups?type=covert_knife&limit=20` | 135ms | 17KB | OK |
| `/api/skin-data?page=1&limit=20` | 103ms | 17KB | OK |
| `/api/collections` | **15,709ms** | 23KB | **CRITICAL** |
| `/api/outcome-stats` (1 skin) | 52ms | 119B | OK |

---

## Database Stats

| Table | Row Count |
|-------|-----------|
| `trade_up_inputs` | **1,840,990** |
| `trade_ups` | 195,753 |
| `price_observations` | 126,042 |
| `listings` | 121,594 |
| `sale_history` | 118,459 |
| `skins` | 3,366 |

| Metric | Value | Problem |
|--------|-------|---------|
| DB file size | 2.2GB | Normal |
| WAL file size | **1.7GB** | **Should be <50MB** |
| `ANALYZE` run? | **Never** | **Query planner blind** |
| `cache_size` | -2000 (2MB) | **Way too small** |
| `page_size` | 4096 | OK |

---

## CRITICAL Fixes (Do These First)

### 1. Fix the WAL checkpoint + SQLite pragmas

**File**: `server/db.ts` — add after WAL mode is set

The 1.7GB WAL means SQLite never checkpoints. Every read must scan the WAL in addition to the main DB, doubling I/O. This alone could halve query times.

```typescript
// Add these pragmas right after journal_mode = WAL
db.pragma('wal_autocheckpoint = 1000');  // checkpoint every 1000 pages (~4MB)
db.pragma('cache_size = -64000');         // 64MB page cache (was 2MB!)
db.pragma('mmap_size = 268435456');       // 256MB mmap for faster reads
db.pragma('temp_store = memory');         // temp tables in RAM
```

Also run a one-time WAL checkpoint on the VPS immediately:
```bash
sqlite3 /opt/trade-up-bot/data/tradeup.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

**Impact**: Should reduce all query times by 30-50% and shrink WAL from 1.7GB to near-zero.

### 2. Run ANALYZE

**File**: `server/db.ts` — add at end of schema initialization

```typescript
db.exec('ANALYZE');
```

Without ANALYZE, SQLite doesn't know table sizes or index selectivity. It may choose full table scans over index lookups. This is a single command that dramatically improves query planning.

Also run once on VPS:
```bash
sqlite3 /opt/trade-up-bot/data/tradeup.db "ANALYZE;"
```

**Impact**: Query planner can now pick optimal indexes. Especially helps the correlated subqueries in collections.

### 3. Rewrite `/api/collections` — the 15.7s endpoint

**File**: `server/routes/collections.ts`

The current query has **4 correlated subqueries** that each scan massive tables (1.84M inputs, 121K listings, 118K sales) **per collection row** (~50 collections = ~200 full-table scans).

**Fix**: Replace with pre-aggregated batch queries joined in JS:

```typescript
router.get("/api/collections", (_req, res) => {
  try {
    // Base collection info - single GROUP BY
    const base = db.prepare(`
      SELECT c.id, c.name,
        COUNT(DISTINCT sc.skin_id) as skin_count,
        SUM(CASE WHEN s.rarity = 'Covert' AND s.name NOT LIKE '★%' THEN 1 ELSE 0 END) as covert_count
      FROM collections c
      JOIN skin_collections sc ON c.id = sc.collection_id
      JOIN skins s ON sc.skin_id = s.id AND s.stattrak = 0
      GROUP BY c.id, c.name
    `).all();

    // Listing counts - single pass over listings
    const listingCounts = new Map(
      db.prepare(`
        SELECT sc.collection_id, COUNT(DISTINCT l.id) as cnt
        FROM listings l
        JOIN skins s ON l.skin_id = s.id
        JOIN skin_collections sc ON s.id = sc.skin_id
        WHERE l.stattrak = 0
        GROUP BY sc.collection_id
      `).all().map((r: any) => [r.collection_id, r.cnt])
    );

    // Sale counts - single pass over sale_history
    const saleCounts = new Map(
      db.prepare(`
        SELECT sc.collection_id, COUNT(*) as cnt
        FROM sale_history sh
        JOIN skins s ON sh.skin_name = s.name
        JOIN skin_collections sc ON s.id = sc.skin_id
        WHERE s.stattrak = 0
        GROUP BY sc.collection_id
      `).all().map((r: any) => [r.collection_id, r.cnt])
    );

    // Profitable trade-up stats - single pass over trade_up_inputs
    const profitStats = new Map(
      db.prepare(`
        SELECT i.collection_name, COUNT(*) as cnt, MAX(t.profit_cents) as best
        FROM trade_ups t
        JOIN trade_up_inputs i ON t.id = i.trade_up_id
        WHERE t.is_theoretical = 0 AND t.profit_cents > 0
        GROUP BY i.collection_name
      `).all().map((r: any) => [r.collection_name, { cnt: r.cnt, best: r.best }])
    );

    // Merge in JS
    const collections = base.map((c: any) => ({
      name: c.name,
      skin_count: c.skin_count,
      covert_count: c.covert_count,
      listing_count: listingCounts.get(c.id) ?? 0,
      sale_count: saleCounts.get(c.id) ?? 0,
      profitable_count: profitStats.get(c.name)?.cnt ?? 0,
      best_profit_cents: profitStats.get(c.name)?.best ?? 0,
    }));

    // Sort by listing_count DESC
    collections.sort((a: any, b: any) => b.listing_count - a.listing_count);

    // Enrich with knife/glove pool
    const enriched = collections.map((c: any) => {
      const pool = collectionKnifePool.get(c.name);
      return { ...c,
        knife_type_count: pool?.knifeTypes.length ?? 0,
        glove_type_count: pool?.gloveTypes.length ?? 0,
        finish_count: pool?.finishCount ?? 0,
        has_knives: (pool?.knifeTypes.length ?? 0) > 0,
        has_gloves: (pool?.gloveTypes.length ?? 0) > 0,
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

**Impact**: Goes from 200 correlated subqueries → 4 batch queries. Expected: 15.7s → <500ms.

### 4. Add HTTP compression

**File**: `server/index.ts`

```bash
npm install compression @types/compression
```

```typescript
import compression from 'compression';
// ... after app creation
app.use(compression());
```

Currently all JSON is sent uncompressed. The 23KB collections response would compress to ~3-4KB. The 17KB trade-ups responses would compress similarly.

**Impact**: 3-5x smaller payloads, faster perceived load times especially on mobile/slow connections.

### 5. Add nginx gzip (belt + suspenders with Express compression)

**File**: `/etc/nginx/sites-enabled/tradeup` on VPS

Add inside the `server` block for HTTPS:

```nginx
# Gzip
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css application/json application/javascript text/xml;
gzip_min_length 256;

# Proxy buffering
proxy_buffering on;
proxy_buffer_size 16k;
proxy_buffers 4 16k;

# Cache static assets
location ~* \.(js|css|png|jpg|ico|svg|woff2)$ {
    proxy_pass http://127.0.0.1:3001;
    proxy_cache_valid 200 1d;
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

**Impact**: Even if Express compression is added, nginx gzip is more efficient (C vs JS) and offloads CPU from Node.

---

## HIGH Priority Fixes

### 6. Add response caching headers to API routes

**File**: `server/index.ts` or individual route files

```typescript
// For data that changes each daemon cycle (~10 min):
res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');

// For truly static data (collections list, filter options):
res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
```

Currently the browser re-fetches everything on every page navigation. With `stale-while-revalidate`, the browser serves cached data instantly and refreshes in the background.

**Impact**: Navigation between pages feels instant. Repeat visits don't wait for API.

### 7. Add missing composite index for listings

**File**: `server/db.ts` — add to index creation section

```sql
CREATE INDEX IF NOT EXISTS idx_listings_skin_stattrak_price
  ON listings(skin_id, stattrak, price_cents);
```

This covers the most common listing query pattern (get floor price for a skin by stattrak status). Without it, queries must scan all listings for a skin_id then filter.

**Impact**: Faster floor price lookups throughout the app, especially in buildPriceCache().

### 8. Cache the collections response in memory

**File**: `server/routes/collections.ts`

Even after the query rewrite, collections data changes only when the daemon runs. Cache it with daemon-cycle invalidation (same pattern used in trade-ups route):

```typescript
let collectionsCache: { data: any; cycle: number; ts: number } | null = null;

router.get("/api/collections", (_req, res) => {
  const now = Date.now();
  const currentCycle = getCurrentDaemonCycle(db); // reuse from trade-ups

  if (collectionsCache && collectionsCache.cycle === currentCycle && now - collectionsCache.ts < 60000) {
    return res.json(collectionsCache.data);
  }

  // ... run queries ...
  collectionsCache = { data: enriched, cycle: currentCycle, ts: now };
  res.json(enriched);
});
```

**Impact**: After first load, collections returns instantly from memory until next daemon cycle.

### 9. Schedule periodic WAL checkpoint + VACUUM

**File**: `server/db.ts` or daemon housekeeping phase

```typescript
// Run every hour in the daemon's housekeeping phase
db.pragma('wal_checkpoint(PASSIVE)');

// Run VACUUM weekly (or on daemon --fresh)
// VACUUM rewrites DB file, reclaiming space from deleted rows
db.exec('VACUUM');
```

The current 1.7GB WAL means the daemon is writing heavily but SQLite isn't folding WAL pages back into the main DB. This bloats I/O for all readers.

**Impact**: Keeps WAL small, reduces I/O, prevents DB file bloat from deleted trade-ups.

---

## MEDIUM Priority Fixes

### 10. Increase VPS swap

Currently 0 swap on 4GB RAM. During discovery phases, daemon (892MB) + 2 workers (250MB each) + DMarket fetcher (166MB) + API server (94MB) = **1.65GB Node.js alone**. Add SQLite memory-mapped I/O and you're at risk of OOM.

```bash
# On VPS:
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Impact**: Safety net against OOM killer during peak memory usage.

### 11. Fix N+1 in free tier trade-ups endpoint

**File**: `server/routes/trade-ups.ts` around line 155-184

The free tier endpoint loads inputs with individual queries per trade-up (up to 50 queries). Should use the same batch-load pattern as the paginated endpoint (lines 364-377).

**Impact**: Free tier requests go from ~50 queries to 2 queries.

### 12. Add index for price_observations by skin_name

**File**: `server/db.ts`

```sql
CREATE INDEX IF NOT EXISTS idx_price_observations_skin
  ON price_observations(skin_name);
```

The KNN cache rebuild (`ensureKnnCache()`) loads all 126K observations every 5 minutes. With this index, it could incrementally load only changed skins.

**Impact**: Faster KNN cache rebuilds, especially as observations grow.

### 13. Pre-compute filter options in daemon

**File**: `server/routes/trade-ups.ts` lines 14-57 (filter-options endpoint)

The filter options endpoint scans all `trade_up_inputs` (1.84M rows) for distinct skin names and collections. This could be pre-computed by the daemon into a small cache table.

```sql
CREATE TABLE IF NOT EXISTS filter_cache (
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Daemon writes distinct values after each merge-save. API reads from cache table instantly.

**Impact**: Filter options load from cached table instead of scanning 1.84M rows.

---

## LOW Priority / Nice-to-Haves

### 14. Add `Connection: keep-alive` to nginx upstream

```nginx
upstream api {
    server 127.0.0.1:3001;
    keepalive 16;
}
```

Reuses TCP connections between nginx and Node, avoiding connection setup overhead per request.

### 15. Run ANALYZE periodically (not just on init)

```typescript
// In daemon housekeeping phase, every ~6 hours
db.exec('ANALYZE');
```

As data distribution changes, ANALYZE keeps query plans optimal.

### 16. Add ETag support for trade-ups

Use the daemon cycle number as an ETag. If the browser sends `If-None-Match` with the same cycle, return 304 Not Modified (zero body).

```typescript
const etag = `"cycle-${currentCycle}"`;
res.set('ETag', etag);
if (req.headers['if-none-match'] === etag) {
  return res.status(304).end();
}
```

---

## Summary: Implementation Priority

| # | Fix | Expected Impact | Effort |
|---|-----|----------------|--------|
| 1 | WAL checkpoint + pragma tuning | 30-50% faster all queries | 10 min |
| 2 | Run ANALYZE | Better query plans everywhere | 2 min |
| 3 | Rewrite `/api/collections` | 15.7s → <500ms | 30 min |
| 4 | Express compression middleware | 3-5x smaller responses | 5 min |
| 5 | Nginx gzip + caching | Faster delivery, less bandwidth | 10 min |
| 6 | Cache-Control headers | Instant page navigation | 15 min |
| 7 | Composite listing index | Faster price lookups | 2 min |
| 8 | Collections response cache | Instant repeat loads | 10 min |
| 9 | Periodic WAL checkpoint | Prevents WAL bloat recurrence | 5 min |
| 10 | Add swap | OOM safety net | 5 min |
| 11 | Fix free tier N+1 | 50 queries → 2 | 15 min |
| 12 | price_observations index | Faster KNN rebuilds | 2 min |
| 13 | Pre-compute filter options | Fast filter loading | 20 min |

**Total estimated effort for critical fixes (1-5): ~1 hour**
**Expected result: All pages load in <500ms, navigation feels instant**

---

## What It's NOT

- **Not a bad VPS**: 3 vCPU + 4GB is fine for this workload once SQLite is tuned
- **Not a fundamentally bad architecture**: SQLite + Express is appropriate for single-server deployment
- **Not placebo**: The 15.7s collections response is objectively broken, and the 1.7GB WAL is a real I/O multiplier
