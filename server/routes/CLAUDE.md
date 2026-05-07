# Routes Reference

Express API on port 3001 (proxied by Vite at 5173 in dev). All routers are registered in `server/index.ts`.

## Routers
- `status.ts`, `status-helpers.ts` — public stats, daemon status, sync meta
- `trade-ups.ts` — list, detail, filters, output-side joins
- `data.ts` — collections / skins data feed + crawler-friendly HTML
- `collections.ts`, `snapshots.ts` — collections page + snapshot viewer
- `calculator.ts` — manual trade-up calculator
- `claims.ts` — claim / release / auto-expire
- `my-trade-ups.ts` — user-claimed history
- `stripe.ts` — checkout sessions + webhook for Basic / Pro tier
- `discord.ts` — Discord OAuth + bot webhook endpoints
- `sitemap.ts` — `sitemap.xml` + `robots.txt`
- `listing-sniper.ts` — Pro-tier listing alerts

## Auth & Tiers
Steam OpenID auth. Sessions live in SQLite (`data/sessions.db`).

| Tier | Price | Delay | Claims | Verify | Links |
|------|-------|-------|--------|--------|-------|
| Free | $0 | 3 hr | No | No | Yes |
| Basic | $5/mo | 30 min | 5/day | 10/hr | Yes |
| Pro | $15/mo | 0 | 10/hr | 20/hr | Yes |

## Claims System
- `POST /api/trade-ups/:id/claim` — locks listing IDs for 30 min.
- `DELETE /api/trade-ups/:id/claim` — releases early.
- Serialized: `pg_advisory_xact_lock(tradeUpId)` plus listing-level `FOR UPDATE`.
- Auto-expire endpoint uses `FOR UPDATE SKIP LOCKED` to coexist with the daemon.
- Claimed listings are filtered from discovery (`AND claimed_by IS NULL`).
- Partial-claim status propagates to all trade-ups sharing a claimed listing.
- Redis `active_claims` (300s TTL) is the read-side source of truth.

## Verification
- `POST /api/verify-trade-up/:id` — re-checks input listings via CSFloat / DMarket.
- Sold / delisted state propagates to ALL trade-ups sharing the listing.
- Records sale observations (KNN feedstock).
- Recalculates trade-up cost when prices changed.

## Rate Limiting
Redis-backed: `checkRateLimit()` / `getRateLimit()` in `server/redis.ts`. Limits returned in API responses for the frontend.

## Caching
Redis via `cachedRoute()` middleware. Notable TTLs:
- trade-up list — 30s
- global-stats — 60s
- collections — 5 min
- skin-data — 2 min
- status — 60s

## API Keys (env)
- `CSFLOAT_API_KEY`, `DMARKET_PUBLIC_KEY`, `DMARKET_SECRET_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
- Redis: `localhost:6379` (no auth)
