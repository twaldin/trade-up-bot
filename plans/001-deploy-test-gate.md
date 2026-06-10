# Plan 001: Gate production deploys and pushes on the test suite

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- .github/workflows/deploy.yml package.json scripts/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

Every push to `main` deploys straight to the production Hetzner VPS with **zero test execution**: `.github/workflows/deploy.yml` runs `npm ci → npm run build → rsync → pm2 restart` and only a post-deploy curl smoke check. Separately, the project's `CLAUDE.md` states "Pre-push hook runs `tsc --noEmit` + vitest. Don't skip it." — but no pre-push hook exists (`.git/hooks/` contains only `.sample` files). The purpose-built performance budgets in `tests/stress/engine-perf.test.ts` are referenced by no hook, no workflow, and no script. Plans 002–011 in this directory make performance-sensitive changes to the engine, routes, and build pipeline; without this gate, a regression ships to production on push. This plan is the verification baseline for everything else.

## Current state

- `.github/workflows/deploy.yml` — single `deploy` job:
  ```yaml
  # deploy.yml:12-32 (abridged)
  jobs:
    deploy:
      runs-on: ubuntu-latest
      timeout-minutes: 15
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: "20", cache: "npm" }
        - name: Install deps
          run: npm ci
        - name: Build (Vite + prerender)
          run: npm run build
        # ... then SSH setup, rsync dist/, git pull + pm2 restart on the VPS
  ```
- `package.json` scripts (verified): `"typecheck": "tsc --noEmit"`, `"test": "vitest run tests/unit/ tests/integration/"`, `"test:unit": "vitest run tests/unit/"`, `"test:stress": "vitest run tests/stress/"`.
- Integration tests require a local PostgreSQL database `tradeupbot_test` (see `tests/integration/setup.ts`) — **not available in CI** unless a service container is added. Unit and stress tests are in-process.
- `git config core.hooksPath` is currently set to the absolute path `.git/hooks` in this clone; the directory has no active hooks.
- `tests/unit/package-contract.test.ts` asserts properties of `package.json` — it is also currently **modified and uncommitted** in the working tree (see git status). Do not revert those local modifications; work with the file as it exists.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Stress    | `npm run test:stress`    | all pass            |
| Contract test | `npx vitest run tests/unit/package-contract.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/deploy.yml`
- `package.json` (scripts section only)
- `scripts/git-hooks/pre-push` (create)
- `tests/unit/package-contract.test.ts` (only if its assertions must learn about the new script)

**Out of scope**:
- Any change to the deploy steps themselves (rsync target, pm2 commands) — that is Plan 008's territory.
- Adding a PostgreSQL service container for integration tests in CI — optional follow-up, not required here.
- Husky or any new dependency. Use plain git hooks.

## Git workflow

- Branch: `advisor/001-deploy-test-gate`
- Commit style: conventional prefix, e.g. `ci: gate deploy on typecheck + unit + stress tests` (matches repo history: `fix:`, `feat(seo):`, `test(seo):`)
- Do NOT push or open a PR unless the operator instructed it. No Co-Authored-By trailers.

## Steps

### Step 1: Establish the baseline locally

Run `npm run typecheck`, `npm run test:unit`, and `npm run test:stress` on a clean checkout. All three must pass **before** you change anything. Record the run times (the stress suite should be seconds, not minutes).

**Verify**: all three commands exit 0. If any fails pre-existing, STOP and report — the gate cannot be added on a red baseline.

### Step 2: Add a `test` job to deploy.yml and make `deploy` depend on it

Add before the `deploy` job:

```yaml
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - name: Install deps
        run: npm ci
      - name: Typecheck
        run: npm run typecheck
      - name: Unit tests
        run: npm run test:unit
      - name: Stress / perf budgets
        run: npm run test:stress
```

and add `needs: test` to the `deploy` job. Leave every existing deploy step untouched.

**Verify**: `node -e "const y=require('fs').readFileSync('.github/workflows/deploy.yml','utf8'); if(!/needs:\s*test/.test(y)||!/test:/.test(y)) process.exit(1)"` → exit 0. Also visually confirm indentation matches the file's 2-space style.

### Step 3: Create the pre-push hook

Create `scripts/git-hooks/pre-push` (executable):

```bash
#!/bin/sh
# Pre-push gate promised by CLAUDE.md: typecheck + unit tests.
set -e
npm run typecheck
npm run test:unit
```

`chmod +x scripts/git-hooks/pre-push`. Then add to `package.json` scripts:

```json
"prepare": "git config core.hooksPath scripts/git-hooks"
```

(`prepare` runs on `npm install`, so every clone gets the hook. It only sets repo-local config — it must not touch `user.email`/`user.name`.)

**Verify**: `npm run prepare && git config core.hooksPath` → prints `scripts/git-hooks`; `sh scripts/git-hooks/pre-push` → exit 0 (runs typecheck + unit suite).

### Step 4: Reconcile the package-contract test

Run `npx vitest run tests/unit/package-contract.test.ts`. If it asserts an exhaustive script list or similar and now fails because of `prepare`, extend the test to cover the new script (do not weaken existing assertions).

**Verify**: `npm run test:unit` → all pass.

## Test plan

- The new CI job is itself the test artifact; no new unit tests beyond the package-contract reconciliation in Step 4.
- Final full run: `npm run typecheck && npm run test:unit && npm run test:stress` → all exit 0.

## Done criteria

- [ ] `.github/workflows/deploy.yml` contains a `test` job and `deploy` has `needs: test`
- [ ] `scripts/git-hooks/pre-push` exists, is executable, and exits 0 when run
- [ ] `package.json` has the `prepare` script; `git config core.hooksPath` → `scripts/git-hooks`
- [ ] `npm run typecheck && npm run test:unit && npm run test:stress` all exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 baseline fails — pre-existing red tests must be reported, not fixed here.
- `npm run test:stress` takes longer than ~5 minutes or requires a database (it should be in-process; if not, report and propose moving it out of the CI gate).
- `tests/unit/package-contract.test.ts` failures cannot be resolved by *adding* an assertion (i.e. the test design conflicts with a `prepare` script).

## Maintenance notes

- Integration tests (`npm run test:integration`) still run only locally because they need the `tradeupbot_test` PG database. Adding a `postgres` service container to the `test` job is the natural follow-up; deferred to keep this plan small.
- Reviewers should check that the `deploy` job is *blocked* by the test job in the Actions UI on the first post-merge push.
