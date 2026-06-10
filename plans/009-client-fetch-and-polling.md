# Plan 009: Move cache warming server-side and stop background polling in hidden tabs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- src/App.tsx src/hooks/useStatus.ts src/components/data-viewer/LiveFeed.tsx src/components/TradeUpTable.tsx server/daemon/index.ts`
> On drift, compare "Current state" excerpts; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (independent of 003–008)
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

- **Every app-shell page load fires two fire-and-forget fetches whose responses are discarded** (`src/App.tsx:294-297`): `/api/collections` and `/api/skin-data?rarity=all&limit=200` — potentially hundreds of KB of JSON downloaded on mobile purely to warm the *server's* Redis cache. Warming belongs on the server: the daemon already refreshes `global_stats` at the end of each cycle (`server/daemon/index.ts:720`), so there is an established hook point.
- **Polling ignores tab visibility**: the 60s global-stats poll (`src/App.tsx:273-288`) runs for every visitor in every tab forever; the LiveFeed admin panel polls every 3s (`src/components/data-viewer/LiveFeed.tsx`, `setInterval(poll, 3000)`); `useStatus` polls every 60s when enabled (admins). Hidden tabs burn battery, mobile data, and server requests.
- **`preparedTradeUps` recomputes on every render** (`src/components/TradeUpTable.tsx:461-479`): 50 rows of derived state (chance/best/worst/missing-count computation) re-derived on every keystroke/expand/sort state change.

## Current state

```tsx
// src/App.tsx:292-297
// Prefetch data + collections pages on mount to warm Redis cache
// Responses are discarded — when user navigates, the Redis cache serves instantly
useEffect(() => {
  fetch("/api/collections").catch(() => {});
  fetch("/api/skin-data?rarity=all&limit=200").catch(() => {});
}, []);
```

```tsx
// src/App.tsx:272-288 (global stats poll — runs for all users)
useEffect(() => {
  const fetchStats = () => fetch("/api/global-stats", { credentials: "include" })...
  fetchStats();
  const interval = setInterval(fetchStats, 60_000);
  return () => clearInterval(interval);
}, []);
```

```ts
// server/daemon/index.ts:705-725 region (cycle end — verified hook point)
await setCycleVersion(cycleTs);          // :708
await cacheSet("global_stats", { ... }); // :720
// :755 — cacheInvalidatePrefix("tu:") also runs here
```

The API server also self-warms `type_counts` and four `skins:*` keys at boot via HTTP self-fetch (`server/index.ts:1160-1186`) — boot warming is guarded by cacheGet checks and is fine; the gap is *re*-warming when TTLs (1800s) lapse between daemon cycles and restarts.

`useStatus` (src/hooks/useStatus.ts) already takes `pollInterval` and is enabled-gated (admins only via `useStatus(userIsAdmin)` in App.tsx:265).

Conventions: React 19 function components, hooks, no external state libs. Vitest for unit tests (jsdom availability unverified — prefer extracting pure logic over DOM-testing hooks).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Build     | `npm run build`          | exit 0              |

## Scope

**In scope**:
- `src/App.tsx`, `src/hooks/useStatus.ts`, `src/components/data-viewer/LiveFeed.tsx`, `src/components/TradeUpTable.tsx`
- `server/daemon/index.ts` (cycle-end warming block only)
- `tests/unit/` for extracted helpers

**Out of scope**:
- `server/index.ts` boot warming (works; leave it).
- Any UI/UX change beyond identical-looking behavior.
- React Query/SWR adoption — rejected as over-engineering for this codebase's conventions.

## Git workflow

- Branch: `advisor/009-client-fetch-and-polling`; commits `perf(web): ...` / `perf(daemon): ...`. No Co-Authored-By trailers.

## Steps

### Step 1: Delete the client-side warm-up fetches

Remove the `useEffect` at `src/App.tsx:292-297` entirely (including its comment).

**Verify**: `grep -n "skin-data?rarity=all&limit=200" src/App.tsx` → no match; `npm run typecheck` exit 0.

### Step 2: Warm those keys from the daemon's cycle end

In `server/daemon/index.ts`, immediately after the existing `cacheSet("global_stats", ...)` block (~line 720), add a best-effort warm of what the deleted client fetches used to warm:

```ts
// Warm the route caches the web app reads first (was previously client-triggered).
// Self-HTTP so the API's own route logic+cache keys are reused; failures are non-fatal.
for (const url of [
  "http://localhost:3001/api/collections",
  "http://localhost:3001/api/skin-data?rarity=all&limit=200",
]) {
  await fetch(url).then(r => r.body?.cancel?.(), () => {}).catch(() => {});
}
```

Also refresh `type_counts` here via direct SQL (the daemon owns the data): reuse the exact query from `server/index.ts:1163-1173` and `cacheSet("type_counts", counts, 1800)`.

Note: the daemon runs `cacheInvalidatePrefix("tu:")` at ~:755 — place the warming AFTER that invalidation so it re-populates rather than getting wiped. Read the surrounding code and put this block after the invalidation, before the cycle-complete log.

**Verify**: `npm run typecheck` exit 0; `npm run test:unit` pass (daemon-state unit tests must stay green). If a local daemon run is feasible (PG + Redis up), run one cycle with a short time budget and confirm the warm log/keys (`redis-cli keys 'skins:*'`).

### Step 3: Visibility-gate the pollers

1. `src/App.tsx` global-stats effect: skip fetches while hidden and refresh immediately on return:

```tsx
useEffect(() => {
  const fetchStats = () => { if (document.hidden) return; ...existing fetch... };
  fetchStats();
  const interval = setInterval(fetchStats, 60_000);
  const onVis = () => { if (!document.hidden) fetchStats(); };
  document.addEventListener("visibilitychange", onVis);
  return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVis); };
}, []);
```

2. Same `if (document.hidden) return;` guard at the top of the `poll` function in `LiveFeed.tsx` (3s interval) and inside `useStatus`'s interval callback (`src/hooks/useStatus.ts`, the `setInterval` at ~line 48).

**Verify**: `npm run typecheck` exit 0; manual: `npm run dev`, open the app, switch to another tab for 2+ minutes, check the network panel shows no `/api/global-stats` requests while hidden and one immediately on return.

### Step 4: Memoize preparedTradeUps

In `src/components/TradeUpTable.tsx`, wrap the computation at line ~461 in `useMemo`:

```tsx
const preparedTradeUps = useMemo(() => tradeUps.map((rawTu) => { ...unchanged body... }),
  [tradeUps, priceOverrides, loadedInputs, loadedOutcomes]);
```

The four deps are the exact external values read inside the body (verify by reading the full map body, lines 461–479+, before committing to the dep list; add any other captured state it reads — e.g. if `getMissingCount`/`getDisplayListingStatus` read component state, include those values).

**Verify**: `npm run typecheck` exit 0; `npm run build` exit 0; manual: expanding a row in the table still updates instantly and displayed numbers are unchanged.

## Test plan

- Extract nothing new unless needed; the polling guards are thin DOM glue. If `useStatus` has existing unit tests (check `tests/unit/`), extend them for the hidden-tab skip by stubbing `document.hidden` — otherwise rely on the manual verification, and say so in the report.
- `npm run test:unit` + `npm run build` green.

## Done criteria

- [ ] No discarded warm-up fetches in App.tsx
- [ ] Daemon warms `collections`, `skin-data` (all/200), and `type_counts` at cycle end, after the `tu:` invalidation
- [ ] All three pollers skip work when `document.hidden`
- [ ] `preparedTradeUps` memoized with a correct dep list
- [ ] `npm run typecheck`, `npm run test:unit`, `npm run build` all pass
- [ ] `plans/README.md` updated

## STOP conditions

- The daemon's cycle-end block structure differs from the excerpt (invalidation/warming order unclear) — report rather than guessing placement.
- `preparedTradeUps` body reads state you can't confidently enumerate in deps — report the variables instead of shipping a stale-closure bug.
- Mobile Safari quirk: if `visibilitychange` handling conflicts with an existing listener elsewhere in the file, report.

## Maintenance notes

- If the daemon is down for extended periods, route caches now go cold after their TTLs with no client-side warmer; the API's boot-time warming still covers restarts. If users report slow first navigation during daemon outages, the right fix is a small `setInterval` re-warm in `server/index.ts`, not restoring client fetches.
- Reviewers should check the `useMemo` dep array against the map body line by line.
