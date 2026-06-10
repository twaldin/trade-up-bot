# Plan 005: Cache and parallelize the SEO/meta route request path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- server/index.ts server/og-image.ts server/routes/sitemap.ts`
> On drift, compare "Current state" excerpts before proceeding; mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (rewrites hot handlers; crawler HTML must stay byte-equivalent)
- **Depends on**: 004 (uses the shell-HTML constant; if 004 hasn't landed, read `dist/index.html` once at startup instead — do NOT keep per-request reads)
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

The SEO landing pages are also the *human-facing* pages, and the human path is the slow one:

- `/skins/:slug` runs **8 sequential PG queries** per request (`server/index.ts:539-657`); the code's own comment says the cold path is "5s+". A Redis cache exists — but both the read (`server/index.ts:519`) and the write (`:842`) are wrapped in `if (isCrawler(ua))`, so **human visitors never benefit and can never warm it**.
- `/trade-ups/collection/:slug` runs an **unbounded `SELECT DISTINCT ON` join** between `trade_up_inputs` (≈11M rows per `server/db.ts:537` comment) and `trade_ups` (`server/index.ts:206-212`) *before* the crawler check — non-crawlers use the result only as `tradeUps.length` in a meta description.
- Three handlers re-read `dist/index.html` from disk **per request** (`server/index.ts:296`, `~370`, `~507`, `~851`) while the `/trade-ups` handler demonstrates the read-once pattern at `:861`.
- `/og/trade-ups/:id.png` re-renders satori + a **synchronous** resvg rasterization per request (`server/og-image.ts:202` region) with only an HTTP `Cache-Control` header — Discord/Twitter/Slack/Telegram each re-fetch it, and the sync render stalls every in-flight request on the single Node process. Fonts are fetched from Google Fonts at module load (`server/og-image.ts:12-23`).
- Two of four sitemap endpoints run heavy joins per fetch with no caching (`server/routes/sitemap.ts:133`, `:182`), while `sitemap-skins.xml` (`:155`) shows the cache pattern 25 lines away.
- All SEO handlers end in `catch { next(); }` — DB failures silently degrade with zero logging (7 sites in `server/index.ts`).

## Current state

Key excerpts (verify each before editing):

```ts
// server/index.ts:519 — cache read gated on crawler
if (isCrawler(ua)) try {
  const { cacheGet } = await import("./redis.js");
  const cached = await cacheGet<string>(cacheKey);
  ...
// server/index.ts:842 — cache write gated on crawler
if (isCrawler(ua)) try {
  const { cacheSet } = await import("./redis.js");
  await cacheSet(cacheKey, html, 3600).catch(() => {});
```

```ts
// server/index.ts:206 — unbounded query runs for ALL user agents
const { rows: tradeUps } = await pool.query(`
  SELECT DISTINCT ON (t.id) t.id, t.type, t.total_cost_cents, t.profit_cents, ...
  FROM trade_up_inputs ti JOIN trade_ups t ON ti.trade_up_id = t.id
  WHERE ti.collection_name = $1 AND t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0
  ORDER BY t.id, t.profit_cents DESC
`, [collectionName]);
```

```ts
// server/index.ts:850-852 — per-request disk read (one of 4 sites)
const indexPath = path.join(__dirname, "..", "dist", "index.html");
if (!fs.existsSync(indexPath)) return next();
res.send(injectMetaIntoSpa(fs.readFileSync(indexPath, "utf-8"), meta));
```

The `/skins/:slug` query chain (lines 539–657): `skinMeta` → `collections` → `condPrices` → `tradeUps` → `inputStats` → `outputStats` (try/catch) → `priceTrend` → `siblings`. Only `siblings` depends on `collections`; everything else depends only on `skinName`.

Sitemap contrast (`server/routes/sitemap.ts:151-175`): `sitemap-skins.xml` does `cacheGet("sitemap_skins_xml")` → query → `cacheSet(..., 3600)`. The repo's Redis helpers are `cacheGet`/`cacheSet` from `server/redis.js` (JSON values) and `getRedis()` for the raw ioredis client.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Integration | `npm test`             | all pass (needs local `tradeupbot_test` PG) |
| Manual smoke | `npx tsx server/index.ts` + curl | see steps |

## Scope

**In scope**:
- `server/index.ts` — only the handlers named above
- `server/og-image.ts`
- `server/routes/sitemap.ts`
- `tests/unit/` and/or `tests/integration/` for new tests

**Out of scope**:
- `server/seo.ts` (`buildSeoHtml`, `injectMetaIntoSpa`) — crawler HTML must remain byte-identical.
- `cachedRoute` in `server/redis.ts` (Plan 006).
- Route handlers under `server/routes/` other than sitemap.ts.

## Git workflow

- Branch: `advisor/005-seo-route-request-path`; commit per step, `perf(server): ...` style. No Co-Authored-By trailers.

## Steps

### Step 1: Read the SPA HTML once

At the top of the async startup IIFE (after `const pool = initDb()` region), compute once:

```ts
const distDir = path.join(__dirname, "..", "dist");
const spaHtmlPath = fs.existsSync(path.join(distDir, "_shell.html"))
  ? path.join(distDir, "_shell.html") : path.join(distDir, "index.html");
const spaHtml: string | null = fs.existsSync(spaHtmlPath) ? fs.readFileSync(spaHtmlPath, "utf-8") : null;
```

Replace all four per-request `fs.readFileSync(indexPath)` sites with `if (!spaHtml) return next(); res.send(injectMetaIntoSpa(spaHtml, meta));`.

**Verify**: `grep -n "readFileSync" server/index.ts` → only the startup reads remain (the `.env` loader, `spaHtml`, and the line-861 `indexHtml`); `npm run typecheck` exit 0; `npm run test:unit` pass.

### Step 2: Un-gate the `/skins/:slug` cache and parallelize its queries

1. Split the cache into two keys: keep `seo_skin:${slug}` for crawler HTML (existing), add `seo_skin_meta:${slug}` storing the small meta object `{ title, description, url, robots, ogImage }`.
2. Move the cache READ above the crawler branch: crawlers check `seo_skin:`, humans check `seo_skin_meta:`; on hit, humans get `injectMetaIntoSpa(spaHtml, cachedMeta)` immediately (zero DB queries).
3. On miss, run the pipeline with the independent queries parallelized:

```ts
const [collections, condPrices, tradeUps, inputStats, outputStatsResult, priceTrend] =
  await Promise.all([...]); // each existing query verbatim; wrap the outputStats one so its failure resolves to null instead of rejecting (it already has a try/catch — preserve that semantics)
```

`skinMeta` stays first (it 404s), `siblings` runs after (depends on `collections`).
4. After building `html` and `meta`, write BOTH caches unconditionally (3600s TTL each).

**Verify**: `npm run typecheck` exit 0. Manual: boot server; `curl -s localhost:3001/skins/<any-slug-from-your-db> -A "Mozilla/5.0" -o /dev/null -w "%{time_total}\n"` twice — second request must be dramatically faster and `X-Cache: HIT` style behavior observable by adding the same `X-Cache` header the crawler path already sets; `curl -s -A "Googlebot" ...` returns full HTML with `<h1>` (crawler output unchanged — diff it against a pre-change capture).

### Step 3: Same treatment for `/collections/:slug` and `/trade-ups/collection/:slug`

- `/collections/:slug`: add `seo_collection:${slug}` (crawler HTML) + `seo_collection_meta:${slug}` (meta object), checked before any DB work, written after, 3600s.
- `/trade-ups/collection/:slug`: for non-crawlers, replace the unbounded query with a cached count: key `coll_tu_count:${collectionName}`, TTL 1800s, value from `SELECT COUNT(DISTINCT ti.trade_up_id)::int AS count FROM trade_up_inputs ti JOIN trade_ups t ON ti.trade_up_id = t.id WHERE ti.collection_name = $1 AND t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0` (this query already exists at `server/index.ts:414-418` — reuse its shape). The crawler branch keeps the full query but caches its rendered HTML under `seo_coll_tu:${slug}` 1800s.

**Verify**: same curl pattern as Step 2 for both routes, crawler + human variants; second hits fast.

### Step 4: Log the swallowed errors

Change every `catch { next(); }` in these handlers (7 sites — `grep -n "catch { next(); }" server/index.ts`) to:

```ts
catch (err) {
  console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err);
  next();
}
```

**Verify**: `grep -c "catch { next(); }" server/index.ts` → 0; `npm run typecheck` exit 0.

### Step 5: Cache the OG image and vendor its fonts

1. In the `/og/trade-ups/:id.png` handler (`server/index.ts:170-189`), before rendering: `const redis = getRedis(); const cached = redis && await redis.getBuffer(`og:tradeup:${req.params.id}`);` → on hit, send the buffer. After rendering: `redis?.set(key, png, "EX", 3600).catch(...)` (PNG is a Buffer — use the raw client, NOT `cacheSet`, which JSON-stringifies).
2. In `server/og-image.ts`, make `loadFonts()` check `server/fonts/` first: if `Inter-Regular.ttf` and `Inter-Bold.ttf` exist there, `fs.readFileSync` them; otherwise fall back to the existing Google Fonts fetch. Then (operator-verifiable step) download the two Inter TTFs into `server/fonts/` so production has no boot-time Google dependency. A `server/fonts/` directory already exists — check what's in it first; if suitable TTFs are already there, just use them.

**Verify**: `npm run typecheck` exit 0; boot server, request an existing trade-up's OG image twice: `curl -s -o /dev/null -w "%{time_total}\n" localhost:3001/og/trade-ups/<id>.png` — second call ≤ ~20ms; `file` on the downloaded PNG → PNG image data 1200 x 630.

### Step 6: Cache the two uncached sitemaps

Copy the `sitemap-skins.xml` cacheGet/cacheSet pattern (`server/routes/sitemap.ts:155-169`) onto `sitemap-collections.xml` (key `sitemap_collections_xml`) and `sitemap-collection-tradeups.xml` (key `sitemap_coll_tu_xml`), TTL 3600.

**Verify**: `npm run typecheck`; boot server, fetch each sitemap twice; second response has `X-Cache: HIT` (add the header as sitemap-skins does).

## Test plan

- New integration test `tests/integration/seo-route-cache.test.ts` (model after an existing test in `tests/integration/`): seed one skin + listing via fixtures, hit `/skins/:slug` twice with a browser UA, assert second response carries the cache-hit marker and equal body; hit once with Googlebot UA, assert `<h1>` present.
- Existing: `npm run test:unit` must stay green (several tests assert `server/index.ts` source strings — update string expectations only where the moved lines are quoted, preserving intent).
- `npm test` full run before finishing.

## Done criteria

- [ ] Human (non-crawler) requests to `/skins/:slug`, `/collections/:slug`, `/trade-ups/collection/:slug` are served from Redis on second hit (zero PG queries — verifiable by stopping... do not stop PG; instead assert via response-time + X-Cache header)
- [ ] `grep -c "catch { next(); }" server/index.ts` → 0
- [ ] OG PNG served from Redis on repeat requests
- [ ] Both previously-uncached sitemaps cached with 3600s TTL
- [ ] `npm run typecheck`, `npm run test:unit`, `npm test` all pass
- [ ] Crawler HTML for a sample skin page is byte-identical pre/post change (capture before starting)
- [ ] `plans/README.md` updated

## STOP conditions

- Crawler HTML diff is non-empty for the sample page (capture with `curl -A "Googlebot"` before any change).
- `getRedis()`/`getBuffer` is unavailable or behaves differently than described in `server/redis.ts` — re-read that file and report.
- The `/skins/:slug` Promise.all changes observable output ordering/content in any way.
- No local PG database available to boot the server for the curl verifications.

## Maintenance notes

- Meta caches mean a skin's title/description can lag reality by up to an hour — acceptable for SEO metadata; if product wants fresher counts, lower TTLs rather than re-gating.
- The daemon's cycle-end cache invalidation (`cacheInvalidatePrefix("tu:")`, `server/daemon/index.ts:755`) does NOT clear `seo_*` keys — intentional (they're time-based). If stale SEO pages are ever reported, add `seo_` to the invalidation prefix list.
- Plan 006's single-flight wrapper further protects these handlers at TTL expiry.
