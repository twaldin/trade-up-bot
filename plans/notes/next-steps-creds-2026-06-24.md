# Next Steps & Credentials — Fetcher Health Runbook (2026-06-24)

**Audience:** the owner, running these commands himself. This is a DOCUMENT ONLY runbook — nothing here was applied to production. Every command is copy-pasteable.

**Scope:** the three live fetchers we want healthy — **buff**, **csfloat**, **dmarket** — plus anything found broken during the 2026-06-24/25 live check. **bitskins is intentionally dead — leave it.** (`bitskins-fetcher` is not in the pm2 list; this is expected, do not restart it.)

---

## TL;DR — live state as of 2026-06-25 ~07:00 UTC (all FACT, queried)

| Fetcher | Verdict | Freshness (`staleness_checked_at`) | Listings | Cred state |
|---|---|---|---|---|
| **dmarket** | HEALTHY — no action | **1.0h** avg | 406,554 | public+secret key pair OK; fetcher cycle 2840, errorsThisHour=5, `updatedAt` 06:57Z |
| **buff** | HEALTHY but noisy — no action needed now | **11.3h** avg (`staleness_checked_at`) / 22.5h via `price_updated_at` | 124,124 | cookie present (319 bytes, multi-field), `cookieHealthy:true`, last success 2026-06-25T06:27Z; intermittent 429 backoffs |
| **csfloat** | STRUCTURAL staleness, NOT a bug | **462h** avg (blanket); **3.1h** on profitable-backed listings | 925,888 | single `CSFLOAT_API_KEY`; checker pool 32,270/50K remaining, not the bottleneck |

**Discovery is NOT starved.** Latest `covert_knife` snapshot (06:43Z): 184,189 trade-ups evaluated, **8 profitable**, best_profit 125c, coverage 276,713 listings. Daemon produced 43 snapshots in the last 24h. The low profitable count is **real post-cliff market compression** (output prices fell 20–42% Apr→Jun while inputs stayed flat), not a fetcher/discovery failure. **No restart-for-starvation action is warranted.** See "Quick wins" for why.

---

## DMarket — HEALTHY, no action

**What it is:** continuous bulk fetcher, its own loop, no shared lockout. Auth is a **key PAIR** (HMAC-signed requests), not a single key.

**Creds (in `/opt/trade-up-bot/.env`):**
- `DMARKET_PUBLIC_KEY=...`
- `DMARKET_SECRET_KEY=...`

**How to check health:**
```bash
# Freshness (the real signal — use staleness_checked_at, NOT price_updated_at):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT COUNT(*) cnt, ROUND(AVG(EXTRACT(EPOCH FROM (now()-staleness_checked_at))/3600)::numeric,1) avg_h FROM listings WHERE source='dmarket'\""
# Healthy = avg_h ~1.0

# Fetcher heartbeat (look at updatedAt + errorsThisHour):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -t -c \"SELECT value FROM sync_meta WHERE key='dmarket_fetcher_status'\""
# Healthy = updatedAt within last few minutes, errorsThisHour single digits

ssh root@178.156.239.58 "tail -40 /tmp/dmarket-fetcher.log"
```

**How to tell creds are stale:** DMarket keys don't expire on a cookie clock — they fail hard. Symptoms: `errorsThisHour` spikes, `updatedAt` stops advancing, log shows 401/signature errors. If that happens, regenerate the key pair at the DMarket developer portal and replace **both** lines in `.env`, then `pm2 restart fetcher` (the dmarket loop lives in the `fetcher` process).

**Refresh procedure (only if broken):**
```bash
# Edit /opt/trade-up-bot/.env, replace DMARKET_PUBLIC_KEY and DMARKET_SECRET_KEY, then:
ssh root@178.156.239.58 "pm2 restart fetcher"
```

> NOTE: `dmarket_fetcher_status` is stored as raw JSON with no `cookieHealthy`/`lastSuccessAt` top-level fields — query the full `value` blob (above), don't `->>'lastSuccessAt'` it (returns NULL, that's not an error).

---

## Buff.market — HEALTHY cookie, intermittent 429s (self-recovering), no action now

**What it is:** cookie-authenticated fetcher (`buff-fetcher` pm2 process). The cookie lives in **Redis**, key `buff_session_cookie`, NOT in `.env`.

**Current cookie (live):** 319 bytes, multi-field — contains `forterToken`, `Device-Id`, `csrf_token` (it is NOT forterToken-only; the "thin cookie" concern does not match the live value). `cookieHealthy:true`, last success 2026-06-25T06:27Z.

**How to check health:**
```bash
# Cookie present + length (length should be a few hundred bytes, not ~50):
ssh root@178.156.239.58 "redis-cli GET buff_session_cookie | head -c 120; echo; redis-cli STRLEN buff_session_cookie"

# Health flag + last success + last error:
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT value::json->>'cookieHealthy' healthy, value::json->>'lastSuccessAt' last_ok, value::json->>'lastError' err FROM sync_meta WHERE key='buff_fetcher_status'\""

# Data freshness:
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT COUNT(*) cnt, ROUND(AVG(EXTRACT(EPOCH FROM (now()-staleness_checked_at))/3600)::numeric,1) avg_h FROM listings WHERE source='buff'\""

# Recent log — distinguish 429 backoffs from login failures:
ssh root@178.156.239.58 "tail -25 /tmp/buff-fetcher.log | grep -iE '429|success|login|error|rate|Cycle'"
```

**How to tell the COOKIE is stale (needs refresh) vs just rate-limited (no action):**

This is the load-bearing distinction. The code (`server/buff-fetcher.ts:578-592`) has two failure paths:

- **STALE COOKIE → refresh required.** `cookieHealthy:false` AND `lastError` contains `"login required"` / `"Login Required"`. The fetcher enters sleep mode (`buff-fetcher.ts:578-586`) and re-reads Redis every 15 min until a fresh cookie appears. Freshness will climb past ~24h.
- **RATE LIMITED → NO action, self-recovers.** `cookieHealthy:true` AND `lastError = "429 rate limited"`. The fetcher backs off 60s and retries (`buff-fetcher.ts:587-592`). **This is the current live state** — log shows periodic `Rate limited — backing off 60s` lines but Cycle 64/65 still completed (~24K listings each, 0 errors). **Do nothing.**

**How to refresh the cookie (only when `cookieHealthy:false` + "login required"):**
1. Log into https://buff.market in a browser with a healthy account.
2. Open DevTools → Network → pick any authenticated XHR → copy the **full `Cookie` request-header value** (the whole string, all fields).
3. Set it in Redis:
```bash
ssh root@178.156.239.58 "redis-cli SET buff_session_cookie '<FULL_COOKIE_STRING>'"
```
4. The fetcher re-reads Redis automatically within ~15 min; no restart needed. To force it immediately:
```bash
ssh root@178.156.239.58 "pm2 restart buff-fetcher"
```
5. Confirm recovery:
```bash
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT value::json->>'cookieHealthy', value::json->>'lastSuccessAt' FROM sync_meta WHERE key='buff_fetcher_status'\""
```

> The cookie is wrapped in **single quotes** in the `redis-cli SET` — buff cookies contain `;`, `=`, and spaces that the shell will otherwise mangle. If the cookie itself contains a single quote (rare), escape it.

**Optional hardening (not required now):** if 429s ever escalate to the point cycles stop completing, the lever is slowing the request cadence in `buff-fetcher.ts`, not a cookie swap. Today's 429s are cosmetic — cycles complete.

---

## CSFloat — 462h staleness is STRUCTURAL, NOT a bug, do NOT "fix" it by restarting

**What it is:** single API key, header auth (`Authorization: <key>`), no proxy/IP coupling in code. Key is **one** env var.

**Cred (in `/opt/trade-up-bot/.env`):**
- `CSFLOAT_API_KEY=...` (single key; read by daemon, checker, claims, trade-ups routes — see `server/sync/csfloat.ts:40`, `server/csfloat-checker.ts:165`)

**Why 462h is expected and NOT actionable as a cred/health problem:**
- The `checker` process loops `GET /api/v1/listings/:id` one at a time at ~29–35/min. At observed 41,941 checks/day, touching all 925,888 csfloat listings once = **~22 days = ~530h**. That IS the 462h average. It is a rate-limit ceiling, not a stale key or a stalled process.
- The pool is NOT the live bottleneck: `csfloat_checker_status` shows `poolRemaining: 32,270` of ~50K, `currentInterval: 1765ms`. Pacing, not budget, is the limit.
- **The listings that matter are already fresh:** the checker sorts profitable-backed listings first, so the ~269 listings that price live trade-ups sit at **3.1h**. The 462h is overwhelmingly speculative coverage that doesn't back any profitable contract.

**How to check health:**
```bash
# Checker heartbeat (totalChecked should keep rising, poolRemaining > buffer):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT value::json->>'totalChecked' checked, value::json->>'poolRemaining' pool, value::json->>'currentInterval' iv, value::json->>'startedAt' started FROM sync_meta WHERE key='csfloat_checker_status'\""

# Blanket vs profitable-backed staleness (proves the prioritization is working):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT COUNT(*), ROUND(AVG(EXTRACT(EPOCH FROM (now()-staleness_checked_at))/3600)::numeric,1) avg_h FROM listings WHERE source='csfloat'\""

ssh root@178.156.239.58 "tail -40 /tmp/csfloat-checker.log"
```

**How to tell the KEY is actually stale/broken (the real failure mode to watch):**
- A dead/invalid key returns 401/403, not slow freshness. Symptom: `totalChecked` stops advancing, log shows auth errors, AND profitable-backed staleness (3.1h) starts climbing too. **If only the blanket 462h is high but `totalChecked` keeps rising and profitable-backed stays low single-digit hours, the key is FINE — do nothing.**
- **THE TRAP:** all 3 csfloat pools (listings 200/~1h, sales 500/~24h, individual 50K/~24h) share a **24h lockout** if ANY hits 0 (`server/daemon/state.ts:10-16`). If you see a sudden flatline across ALL csfloat activity for ~24h, that's a tripped lockout, not a stale key — wait it out; don't churn the key.

**Refresh procedure (only if key is genuinely revoked/401):**
```bash
# Regenerate key at app.csfloat.com, then edit /opt/trade-up-bot/.env CSFLOAT_API_KEY=..., then:
ssh root@178.156.239.58 "pm2 restart checker daemon"
```

**Do NOT** try to fix 462h by restarting the checker — a restart resets `totalChecked` and the cycle clock without changing the structural ceiling. The real lever for csfloat freshness is multi-key/pods (low ROI post-cliff) — see `plans/notes/` csfloat-scaling architecture doc; out of scope for this runbook.

---

## DO THIS NOW — ordered checklist

1. **Confirm nothing is on fire (60 seconds):**
   ```bash
   ssh root@178.156.239.58 "pm2 list"
   ```
   Expect `api, buff-fetcher, checker, daemon, discord-bot, fetcher` all `online`. (No `bitskins-fetcher` — correct.) If any show high `↺` restart counts or `errored`, investigate that process. (`api` legitimately restarts often — 17 restarts is its known retry-on-DB-lock behavior, not a problem.)

2. **Buff:** verify it's the harmless 429 state, not a stale cookie:
   ```bash
   ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT value::json->>'cookieHealthy', value::json->>'lastError', value::json->>'lastSuccessAt' FROM sync_meta WHERE key='buff_fetcher_status'\""
   ```
   - `cookieHealthy=true` + `429 rate limited` → **no action** (current state).
   - `cookieHealthy=false` + `login required` → **refresh the cookie** (Buff section above).

3. **DMarket:** confirm heartbeat is live:
   ```bash
   ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -t -c \"SELECT value::json->>'updatedAt' FROM sync_meta WHERE key='dmarket_fetcher_status'\""
   ```
   Should be within minutes of now. If stale → `pm2 restart fetcher`.

4. **CSFloat:** confirm the checker is advancing and profitable-backed listings are fresh:
   ```bash
   ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT value::json->>'totalChecked', value::json->>'poolRemaining' FROM sync_meta WHERE key='csfloat_checker_status'\""
   ```
   `totalChecked` rising + `poolRemaining` > ~150 → healthy. **Ignore the 462h blanket number.**

5. **Discovery sanity (one query):**
   ```bash
   ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT type, total_tradeups, profitable_count, best_profit_cents FROM market_snapshots WHERE type='covert_knife' ORDER BY snapshot_at DESC LIMIT 1\""
   ```
   Low `profitable_count` (single digits) is EXPECTED post-cliff and is real market compression — **not a reason to restart anything.** Only act if `total_tradeups` collapses toward 0 or no new snapshot has been written in hours.

---

## Quick wins (folded in from the causal study — highest leverage first)

1. **DO NOT restart discovery to "recover profits."** FACT: discovery is not starved — coverage_listings 276K, total_tradeups 184K, 43 snapshots/24h. The cliff was **real market compression** (~80%: glove+knife outputs fell 20–42% Apr→Jun, inputs flat; plus an ~85% bilateral liquidity freeze the week of Jun 8). A restart fixes nothing here and resets warm state. **No action.**

2. **The owner's "my commits removed false profits" hope is FALSIFIED for the cliff window — accept it and move on.** Every profit-math file (`fees.ts` Mar26, `pricing.ts` Mar29, `evaluation.ts`/`core.ts` Mar20) was unchanged through the entire May26→Jun25 snapshot history. The peak numbers already included those fixes. There is no false-profit to chase out; **no code action.**

3. **If you want MORE profitable trade-ups surfaced (the only real lever post-cliff):** the cheap win is widening the csfloat "priority" tier in `buildCheckQueue` (`server/csfloat-checker.ts:104`) from `profit_cents>0` to include near-profitable (`profit_cents > -200`) and high-value-collection inputs, so listings most likely to *become* profitable on a price move stay fresh. Near-zero cost, directly targets what multi-key would otherwise buy. (Implementation, not a creds task — flagged for prioritization only.)

4. **Recover the csfloat throughput gap for free (optional):** real pace 29/min vs configured 35/min (~17% lost to errors / 90-min queue rebuild / inline recalc). Batching the price-update recalcs and streamlining `QUEUE_REBUILD_INTERVAL_MS` recovers ~20% staleness with no new keys. Again implementation, not creds.

5. **Buff 429s:** monitor, don't churn the cookie. The current cookie is healthy; swapping it will NOT reduce 429s (rate limiting is request-cadence-bound, not cookie-bound). Only act on `login required`.

---

## How to monitor — WEEKLY

Run this block once a week (or wire it into the `/monitoring` loop). Each line is independently safe and read-only.

```bash
# 1. All processes online, restart counts sane:
ssh root@178.156.239.58 "pm2 list"

# 2. Per-source freshness (the canonical health signal — use staleness_checked_at):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT source, COUNT(*) cnt, ROUND(AVG(EXTRACT(EPOCH FROM (now()-staleness_checked_at))/3600)::numeric,1) avg_h FROM listings WHERE staleness_checked_at IS NOT NULL GROUP BY source ORDER BY cnt DESC\""
#   EXPECT: dmarket ~1h, buff ~10-25h, csfloat ~460h (csfloat high is STRUCTURAL — see csfloat section)

# 3. Buff cookie health (the one cred that expires on a clock):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT value::json->>'cookieHealthy' healthy, value::json->>'lastError' err, value::json->>'lastSuccessAt' last_ok FROM sync_meta WHERE key='buff_fetcher_status'\""
#   ACT only if healthy=false + err contains 'login required' → refresh cookie

# 4. DMarket + CSFloat heartbeats advancing:
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -t -c \"SELECT 'dmarket', value::json->>'updatedAt' FROM sync_meta WHERE key='dmarket_fetcher_status' UNION ALL SELECT 'csfloat', value::json->>'totalChecked' FROM sync_meta WHERE key='csfloat_checker_status'\""
#   EXPECT dmarket updatedAt within minutes; csfloat totalChecked higher than last week

# 5. CSFloat pool not near a lockout (any pool hitting 0 = 24h lockout for ALL three):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -t -c \"SELECT value::json->>'poolRemaining' FROM sync_meta WHERE key='csfloat_checker_status'\""
#   EXPECT comfortably above the safety buffers (100+); near 0 = approaching lockout

# 6. Discovery alive (snapshots being written, trade-ups non-zero):
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c \"SELECT MAX(snapshot_at) latest, COUNT(*) FILTER (WHERE snapshot_at > now()-interval '24 hours') snaps_24h FROM market_snapshots\""
#   EXPECT latest within ~1h, snaps_24h in the dozens
```

**Weekly triage rule:** the ONLY routine credential failure to expect is the **buff cookie expiring** (check #3). DMarket key pair and CSFloat key are long-lived and fail hard (401) rather than drifting — you'll know because their heartbeats flatline, not because freshness slowly degrades. Everything else (buff 429s, csfloat 462h) is expected noise — do not act on it.

---

## Appendix — exact live readings captured 2026-06-25 ~07:00 UTC (FACT)

- `pm2 list`: api(↺17), buff-fetcher(13D), checker(13D), daemon(13D), discord-bot(13D), fetcher(13D) — all online; NO bitskins-fetcher.
- buff: cookie 319 bytes (`forterToken=...; Device-Id=...; csrf_token=...`); `cookieHealthy:true`, lastSuccess `2026-06-25T06:27:29Z`, lastError `429 rate limited`. Log: Cycle 64 (24,313 listings, 0 errors), Cycle 65 (26,511 listings, 0 errors), interspersed `Rate limited — backing off 60s`.
- dmarket: `cycleCount:2840`, `errorsThisHour:5`, `updatedAt:2026-06-25T06:57:34Z`, `totalInserted:67,761,868`.
- csfloat: `totalChecked:564,558`, `poolRemaining:32,270`, `currentInterval:1765ms`, startedAt `2026-06-11T19:52Z`.
- freshness (`staleness_checked_at`): dmarket 1.0h (405,841), buff 11.3h (124,144), csfloat 462.0h (922,435).
- latest covert_knife snapshot (06:43Z): total_tradeups 184,189; profitable_count 8; best_profit 125c; coverage_listings 276,713.
- `.env` key names present: CSFLOAT_API_KEY, DMARKET_PUBLIC_KEY, DMARKET_SECRET_KEY, DISCORD_BOT_TOKEN/CLIENT_SECRET, STEAM_API_KEY, STRIPE_*, SESSION_SECRET, INTERNAL_API_TOKEN, BITSKINS_API_KEY (dead). Buff cookie is in **Redis**, not `.env`.
