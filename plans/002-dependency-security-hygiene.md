# Plan 002: Patch vulnerable dependencies and remove dead ones

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- package.json package-lock.json`
> If these changed since planning, re-run `npm audit --omit=dev` and re-verify
> the "Current state" claims before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (test gate should exist so this lands behind it; can run independently if 001 is delayed)
- **Category**: security
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

`npm audit --omit=dev` (run 2026-06-10) reports 4 vulnerabilities: `react-router` 7.13.1 (2 high — including GHSA-49rj-9fvp-4h2h, plus XSS/open-redirect/DoS advisories; note the RCE vector targets React Router's *server* runtime, which this client-only `BrowserRouter` SPA does not exercise, so real-world severity here is lower than the headline — but the upgrade is trivial) and `ws` 8.20.0 (moderate, uninitialized memory disclosure GHSA-58qx-3vcg-4xpx — `ws` IS used server-side by the Skinport WebSocket client, and also nested under `engine.io-client`). Separately the manifest carries dead weight that misleads future work: `@fontsource/inter` is never imported anywhere, `@tanstack/react-table` is in devDependencies and never imported, and `@types/pg` sits in production `dependencies`.

## Current state

- `package.json:27` — `"@fontsource/inter": "^5.2.8"` in dependencies. Verified dead: `grep -rn "fontsource" src/ shared/ index.html scripts/` matches only `src/index.css:5: @import "@fontsource-variable/geist";`.
- `package.json:62` — `"@tanstack/react-table": "^8.20.0"` in devDependencies. Verify dead before removing (Step 3).
- `package.json:30` — `"@types/pg": "^8.18.0"` in `dependencies` (should be devDependencies; all other `@types/*` already are).
- `package.json:50` — `"react-router-dom": "^7.13.1"`; `package.json:58` — `"ws": "^8.20.0"`.
- `npm audit --omit=dev` output (2026-06-10): react-router 7.0.0–7.14.2 high (fix available), ws 8.0.0–8.20.0 moderate (fix available), `engine.io-client` depends on vulnerable ws.
- `tests/unit/package-contract.test.ts` asserts package.json properties and is currently modified+uncommitted in the working tree — run it after every manifest change.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Audit     | `npm audit --omit=dev`   | 0 vulnerabilities (after fix) |
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Build     | `npm run build`          | exit 0 (includes postbuild prerender + SEO verification) |

## Scope

**In scope**:
- `package.json`, `package-lock.json`
- `tests/unit/package-contract.test.ts` (only if its assertions reference a removed/moved dep)

**Out of scope**:
- Any source-code change. If an upgrade forces source changes (router API breakage), STOP.
- The `overrides` block in package.json — leave as is.
- `date-fns` — it is a real (transitive-peer) dependency of `react-day-picker`; Plan 003 may change that picture. Do not remove it here.

## Git workflow

- Branch: `advisor/002-dependency-security-hygiene`
- Commit style: `fix(deps): patch react-router and ws advisories, prune dead deps`
- Do NOT push or open a PR unless instructed. No Co-Authored-By trailers.

## Steps

### Step 1: Patch the advisories

Run `npm audit fix` (no `--force`). This should bump `react-router-dom`/`react-router` past 7.14.2 and `ws` past 8.20.0 within existing semver ranges.

**Verify**: `npm audit --omit=dev` → `found 0 vulnerabilities`. `npm ls react-router-dom ws` → versions outside the vulnerable ranges.

### Step 2: Confirm the app still builds and routes still work

**Verify**: `npm run typecheck` → exit 0; `npm run test:unit` → all pass; `npm run build` → exit 0 (the postbuild prerender exercises react-router rendering for `/`, `/faq`, `/blog/*` etc., which is a real routing smoke test).

### Step 3: Prune dead dependencies

1. Confirm each is unreferenced (expect zero matches):
   - `grep -rn "@fontsource/inter" src/ shared/ server/ scripts/ index.html`
   - `grep -rn "@tanstack/react-table" src/ shared/ server/ scripts/`
2. `npm uninstall @fontsource/inter @tanstack/react-table`
3. Move `@types/pg`: `npm uninstall @types/pg && npm install -D @types/pg`

**Verify**: `npm run typecheck` → exit 0 (proves `@types/pg` still resolves from devDependencies); `npx vitest run tests/unit/package-contract.test.ts` → pass.

### Step 4: Full gate

**Verify**: `npm run test:unit && npm run build` → all pass, build exit 0.

## Test plan

- No new tests. The package-contract test plus typecheck/build are the regression net.

## Done criteria

- [ ] `npm audit --omit=dev` → 0 vulnerabilities
- [ ] `grep -n "@fontsource/inter\|@tanstack/react-table" package.json` → no matches
- [ ] `@types/pg` listed under devDependencies, not dependencies
- [ ] `npm run typecheck`, `npm run test:unit`, `npm run build` all exit 0
- [ ] Only `package.json`, `package-lock.json` (and possibly the contract test) modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `npm audit fix` wants a semver-major bump (e.g. react-router 8.x) or `--force` — report instead.
- Typecheck or build breaks after the bump (router API change) — report the exact errors; source changes are out of scope.
- Either "dead" dependency turns out to be imported somewhere — leave it, note it in the report.

## Maintenance notes

- `react-router` advisories will recur; the `test` CI job from Plan 001 plus a periodic `npm audit` is the watch.
- If Plan 003's calendar work removes `react-day-picker`, `date-fns` and `@date-fns/tz` leave the client graph too — revisit the manifest then.
