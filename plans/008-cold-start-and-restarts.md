# Plan 008: Cut API cold-start time and shrink the deploy downtime window

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- server/db.ts server/index.ts .github/workflows/deploy.yml server/auth.ts`
> On drift, compare "Current state" excerpts; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches startup/migration logic and the deploy pipeline)
- **Depends on**: 001 (CI gate), ideally lands after 004/005 so a restart's first requests are cheap
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

Every production deploy (every push to main) restarts the API and pays, before `app.listen()` can run:

1. **A full tsx re-transpile of the ~29K-line server TS graph** — `.github/workflows/deploy.yml:48` runs `rm -rf /root/.cache/tsx && pm2 restart api` on every deploy, unconditionally discarding the transpile cache.
2. **The whole migration suite in `createTables`** (`server/db.ts:45-642`): an advisory lock, dozens of ALTER/CREATE INDEX IF NOT EXISTS catalog statements (cheap), and — expensive — **two full-table scans of the ~1.25M-row `trade_ups` table**: `SELECT COUNT(*) ... WHERE output_skin_names = '{}' AND outcomes_json IS NOT NULL ...` (db.ts:519-521) and `SELECT COUNT(*) ... WHERE collection_names = '{}'` (db.ts:548-550). Neither predicate is usefully indexed; `outcomes_json` is a fat TEXT column, so these scans read most of the table's heap on every boot.
3. The smoke check in deploy.yml literally documents the resulting 502 window ("may be transient pm2 restart window").

A `SKIP_STARTUP_MIGRATIONS=1` escape hatch exists (`server/index.ts:143`) but nothing in the repo sets it, and skipping migrations entirely is the wrong default (fresh schema changes would never apply). The right fix is a schema-version gate: run the migration body only when the code's schema version differs from the database's.

## Current state

```ts
// server/index.ts:141-148
(async () => {
  const pool: pg.Pool = initDb();
  if (process.env.SKIP_STARTUP_MIGRATIONS === "1") {
    console.log("Skipping startup migrations");
  } else {
    await createTables(pool);
  }
  initRedis();
```

```ts
// server/db.ts:45-56 (createTables entry; full function runs ~60 statements + the two scans)
export async function createTables(pool: pg.Pool): Promise<void> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(1)");
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'trade_ups' LIMIT 1"
    );
    ...
```

- `sync_meta` key/value table + `getSyncMeta`/`setSyncMeta` helpers already exist (db.ts:644-654) — use them for versioning.
- `app.listen(PORT, ...)` at `server/index.ts:1122`; no SIGTERM handling, no `process.send('ready')`. `process.on("uncaughtException"/"unhandledRejection")` handlers exist at the bottom.
- `server/auth.ts:110-111`: `const baseUrl = process.env.BASE_URL || "http://localhost:3001";` — cookie `secure` flag derives from this string; nothing asserts https in production.
- Deploy steps (deploy.yml:46-48): `git pull` on VPS, clear tsx cache, `pm2 restart api`. The PM2 process file lives on the VPS, not in the repo.
- `createTables` is also called by the daemon and by tests — the version gate must be safe for all callers (tests use the `tradeupbot_test` DB; check `tests/integration/setup.ts` for how it creates schema before changing semantics).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Integration | `npm test`             | all pass (exercises createTables against tradeupbot_test) |
| Boot timing | `time npx tsx server/index.ts` (Ctrl-C after listen log) | see steps |

## Scope

**In scope**:
- `server/db.ts` (version gate)
- `server/index.ts` (ready signal, SIGTERM, BASE_URL assert)
- `.github/workflows/deploy.yml` (tsx-cache line, pm2 verb)
- `tests/` for the new gate behavior

**Out of scope**:
- Building a server JS artifact (esbuild bundle) — real but L-effort; recorded as deferred follow-up in README.
- PM2 cluster mode / the VPS-side ecosystem file — document required VPS commands in the report instead of guessing at remote state.
- The migration statements themselves — do not reorder or rewrite any ALTER/CREATE.

## Git workflow

- Branch: `advisor/008-cold-start-and-restarts`; commits `perf(server): gate startup migrations on schema version`, `ci: stop clearing tsx cache on deploy`, etc. No Co-Authored-By trailers.

## Steps

### Step 1: Test first — schema version gate

Integration test (`tests/integration/schema-version-gate.test.ts`, model on existing integration tests):
- Call `createTables(pool)` twice; after the first call `getSyncMeta(pool, "schema_version")` equals the exported constant; assert the second call completes in < 500ms (the gate short-circuits) — measure with `Date.now()`.
- Assert that after manually `setSyncMeta(pool, "schema_version", "0")`, `createTables` runs the full body again (e.g. it restores the correct version value).

**Verify**: test fails against current code (no `schema_version` key written).

### Step 2: Implement the gate

In `server/db.ts`:

1. `export const SCHEMA_VERSION = "2026-06-10.1";` with a comment: *bump this string whenever anything inside createTables changes*.
2. At the top of `createTables`, BEFORE acquiring the advisory lock:

```ts
const current = await getSyncMeta(pool, "schema_version").catch(() => null);
if (current === SCHEMA_VERSION) return; // schema already at this version — skip migrations
```

(`getSyncMeta` queries `sync_meta`, which may not exist on a fresh DB — the `.catch(() => null)` covers that; fall through to the full run.)
3. At the bottom of the `try` block (after all migrations, before `finally`): `await setSyncMeta(pool, "schema_version", SCHEMA_VERSION);`

The advisory lock semantics stay intact for the non-skip path; concurrent boots where one process completes migrations leave the version set, and the other process's pre-lock check may still pass — that's fine, it will take the lock, find everything IF NOT EXISTS, and write the same version.

**Verify**: Step 1 test passes; `npm test` fully green (integration setup still works on fresh test DB); `time npx tsx server/index.ts` on dev DB: boot-to-listen log noticeably faster on second run (record both times).

### Step 3: Production BASE_URL assertion

In `server/index.ts`, immediately inside the async IIFE: 

```ts
if (process.env.NODE_ENV === "production" && !(process.env.BASE_URL || "").startsWith("https")) {
  throw new Error("BASE_URL must be set to an https URL in production");
}
```

**Verify**: `NODE_ENV=production npx tsx server/index.ts` without BASE_URL → exits with that error; normal dev boot unaffected.

### Step 4: Graceful restart plumbing

1. Capture the server handle: `const server = app.listen(PORT, () => { ... existing callback ... });` and inside the callback's first line add `process.send?.("ready");` (enables PM2 `wait_ready` when configured on the VPS).
2. Add once, near the existing process handlers:

```ts
process.on("SIGTERM", () => {
  console.log("SIGTERM received — draining");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref(); // hard deadline
});
```

(`server` must be in scope — declare `let server: ReturnType<typeof app.listen>` at module level if needed.)
3. In deploy.yml step "Git pull main + tsx-cache clear + pm2 restart api": remove `rm -rf /root/.cache/tsx &&` entirely, and change `pm2 restart api` → `pm2 reload api`. Update the step name accordingly.
4. In the report, include the one-time VPS commands the operator must run for `wait_ready` to take effect (e.g. setting `wait_ready: true, listen_timeout: 15000, kill_timeout: 10000` in the VPS-side PM2 config and `pm2 save`) — do not attempt to run them.

**Verify**: `npm run typecheck` exit 0; boot locally, send `kill -TERM <pid>` → "SIGTERM received" logged, process exits 0 promptly; `grep -n "rm -rf /root/.cache/tsx" .github/workflows/deploy.yml` → no match; `grep -n "pm2 reload api" .github/workflows/deploy.yml` → 1 match.

## Test plan

- Step 1 integration test (gate skip + re-run on version mismatch).
- Existing integration suite (`npm test`) proves fresh-DB creation still works.
- Manual timing evidence (before/after boot-to-listen) recorded in the commit message.

## Done criteria

- [ ] Second consecutive boot skips migrations (< 500ms in `createTables`) and the two trade_ups full-table COUNT scans do not run (verify via PG: `SELECT query FROM pg_stat_activity` during boot, or simply by the timing assertion)
- [ ] `SCHEMA_VERSION` constant exists with the bump-on-change comment
- [ ] deploy.yml no longer clears the tsx cache; uses `pm2 reload`
- [ ] SIGTERM drains and exits; `process.send('ready')` emitted after listen
- [ ] Production https assertion in place
- [ ] `npm run typecheck`, `npm run test:unit`, `npm test` all pass
- [ ] `plans/README.md` updated, including the operator's VPS follow-up note

## STOP conditions

- `tests/integration/setup.ts` creates schema through a path that the version gate would break (read it first).
- The daemon's startup (server/daemon entry) relies on createTables re-running backfills every boot for correctness — check `server/daemon.ts` / `server/daemon/index.ts` for assumptions before gating; if the daemon depends on the per-boot backfill of `output_skin_names`/`collection_names`, report.
- `pm2 reload` is rejected by the deploy environment (older PM2) — leave `restart` and note it.

## Maintenance notes

- **The contract**: anyone editing `createTables` must bump `SCHEMA_VERSION`, or production will skip their migration. The constant's comment carries this; reviewers must enforce it. A unit test asserting "createTables source hash changes ⇒ version changed" is possible follow-up if violations happen.
- The deferred big win is pre-building the server with esbuild (`node dist-server/index.js`, sub-second boot, no tsx at runtime). Worth doing if deploy frequency stays daily; estimated L because of `__dirname`/import.meta and dynamic-import patterns in the codebase.
