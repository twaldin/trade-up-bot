# Autoresearch Loop — Handoff

> What this loop is, how it runs, and how to pick it up. Updated 2026-08-14 after the first scheduled Deckbox fire shipped It15.
> Durable companions: `autoresearch-operating-contract.md` (SOURCE OF TRUTH), `autoresearch-results.tsv` (iteration ledger), and `../ops/autoresearch/` (host artifacts/runtime).
> These three governance files are tracked in git. Raw agent logs, heartbeats, and per-check monitoring dumps are runtime evidence and remain outside git.

---

## 1. What the loop is

A **fully-autonomous, one-lever-per-day algorithm-improvement loop** for the CS2 trade-up bot. Each day the loop:
1. verifies the last shipped change is healthy and stable,
2. formally decides whether to **keep or revert** it against its own pre-declared watch items,
3. picks the **next** improvement from a self-generated backlog (or derives a new one from telemetry),
4. ships it end-to-end: TDD → gates → adversarial review → merge → deploy → verify → log.

The goal is steady, evidenced, **reversible** improvement to trade-up discovery quality/throughput — never a big bang. Safety and honesty dominate: any prod instability triggers an immediate revert, and every decision is logged with its evidence chain so a future agent (or Tim) can audit it.

It runs as Deckbox `systemd --user` calendar timers (see §3). It is autonomous but bounded: it never touches the off-limits list (§6), never starts a lever from the monitoring service, and records HOLD when work requires human judgment.

---

## 2. Roles & the moving parts

- **Prod**: Hetzner VPS `root@178.156.239.58`, repo at `/opt/trade-up-bot`, Postgres DB `tradeupbot`, processes under `pm2` (`daemon` = discovery loop, `api` = REST + `createTables`, plus fetchers/checker/discord-bot). The executable observation path is `ops/autoresearch/bin/engine-monitor.mjs`.
- **The daemon** runs a continuous discovery cycle (~30–36 min/cycle). Each cycle enumerates candidate 10→1 (and 5→1 knife) trade-ups across six rarity tiers, scores them with the **frozen `trade_up_score`** formula (a DB trigger — OFF-LIMITS), and upserts survivors.
- **Concurrent repository work:** always fetch before branching and again before publication; rebase a private autoresearch branch only when conflict-free and semantically safe. Never overwrite or discard another contributor's work.

---

## 3. Durable Deckbox scheduler

Deckbox is authoritative. The committed units live under `ops/autoresearch/systemd/` and run from `/home/tim/omp-firstmate/projects/trade-up-bot`:

- `trade-up-bot-engine-monitor.timer`: minute 11 and 41 of every UTC hour. Its service performs read-only SSH/DB collection and appends `heartbeats/monitor.jsonl`.
- `trade-up-bot-autoresearch-fire.timer`: 10:30 UTC daily. Its service invokes OMP non-interactively and is the only scheduled job allowed to ship a lever; it appends `heartbeats/daily.jsonl`.
- `trade-up-bot-autoresearch-watchdog.timer`: every 15 minutes UTC. It writes `watchdog-status.json`, with STALE thresholds of 90 minutes for monitoring and 26 hours for the daily fire. The artifact expires after 30 minutes so watchdog silence cannot leave a frozen green result.

All calendar timers use `Persistent=true`. The calendar primitive gives a finite next elapse and catches up a missed activation after downtime; `OnBootSec` plus `OnUnitActiveSec` is not used because an already-elapsed boot trigger cannot seed a timer that has never run.

State defaults to `~/.local/state/trade-up-bot/autoresearch/`. The first mate reads the silence/failure signal in one command:

```bash
node ops/autoresearch/bin/read-watchdog.mjs
```

Prepared does not mean installed. The first mate runs `ops/autoresearch/install.sh install` after publication; it proves stale/fresh behavior, executes real one-shots, verifies loaded units and finite next elapses, then enables the timers. Roll back with `ops/autoresearch/install.sh rollback`.

Before install, Deckbox must have the `tim`-owned mode-0600 `~/.config/trade-up-bot/autoresearch.env` with `TEST_DATABASE_URL` for the dedicated localhost-only `tradeupbot_test` role/database. The installer and daily wrapper verify the file, test-shaped database name, role identity, and live connection; a miss fails rather than skipping integration.

The services run with `NoNewPrivileges`, no capabilities, read-only system/home mounts, private temp/devices, and explicit write allowlists. Docker sockets are inaccessible. The daily worker can write its checkout, state, OMP/package caches, and user runtime; it can use ordinary network access for the unprivileged test DB, GitHub/OMP, and SSH to the documented VPS. It can read but not write the Deckbox gh/SSH configuration and cannot use `sudo`.

GSC/GA4 is not a fourth timer. It remains bound to the captain's authenticated browser/CDP session and must be supplied separately; the engine loop neither blocks silently on it nor claims it as automated evidence.

---

## 4. Daily-fire protocol (the contract, condensed)

1. **Gate:** require the dedicated unprivileged test-database preflight, a clean/synced checkout, and fresh successful monitor/expiry-aware-watchdog evidence. Missing or expired artifacts stop the fire. If the prior lever is under 24 hours old, record OBSERVE and ship nothing.
2. **Evaluate first:** formally KEEP or REVERT the last lever against its declared watch items. Production crash/OOM/restart-loop/DB/cadence failure caused by the lever means immediate revert/redeploy and no new work.
3. **Pick at most one:** additive, bounded, measurable, and evidence-backed. HOLD or an investigation is a valid complete fire.
4. **Execute:** branch from current `main`; TDD red→green; run typecheck, unit, and integration gates; obtain a fresh OMP adversarial review with zero unresolved blockers.
5. **Publish/deploy:** push the private branch, open and squash-merge a PR after gates/review, wait for the exact-head GitHub deploy, verify the VPS head, and explicitly restart `daemon` when daemon/engine code changed (the workflow reloads only `api`).
6. **Record:** capture honest board/lever evidence and append an exact-format TSV row for a ship or formal decision. A shipped lever ends as `shipped-stabilizing`; the following eligible fire evaluates it after the stabilization day.
7. **One lever per day is a ceiling.** Never fabricate M1/M2; use `NA` plus the reason when no honest measurement is available.

The investigation-first pattern remains valid for risky or modeling-heavy levers: the investigation is the complete unit for one fire, with GO/NO-GO and an implementation/TDD plan; implementation may occur only on a later fire.

---

## 5. Metrics glossary

- **M1** — median `trade_up_score` of the top-100 active contracts. Primary quality proxy. Floor ~51; the D&N dislocation drives it up to ~133.
- **ge50 / ge30 / ge10** — count of active contracts with `trade_up_score ≥ 50 / 30 / 10`.
- **max / nulls** — max active score; count of active rows with NULL score (should be 0).
- **staircase** — count of active `type='staircase'` contracts (50 Classified → 5 Covert → 1 Knife).
- **knife_active** — count of active `type='covert_knife'`.
- **`e2:%` provenance** (`discovered_via`) — mints from the E2 reverse-boundary-targeting pass (`e2:greedy`, `e2:knapsack`). **Purge-sensitive counter** — judge on mint FLOW (increases over time), not absolute level. Analogous families: `s1:*` (Step-1 single-collection), `s2:*`, `k1:*`/`k2:*` (knife), `k2:*` (knife E2).
- Board queries: `listing_status='active'`, columns `trade_up_score`, `type`, `discovered_via`. `trade_up_score` is frequently negative across the board (most enumerated trade-ups aren't profitable) — that's normal; what matters is whether a lever adds contracts that *compete* near the board's working range.

Access pattern (peer-auth fails as `-U postgres`; use the DSN from `.env`):
```bash
ssh root@178.156.239.58 'cd /opt/trade-up-bot && \
  DBURL=$(grep -oP "(?<=^DATABASE_URL=).*" .env | tr -d "\""); psql "$DBURL" -c "..."'
```

---

## 6. HARD off-limits (never touch autonomously)

- **Pricing files**: `engine/pricing.ts`, `knn-pricing.ts`, `fees.ts`, `condition-multipliers.ts` *values*.
- **The frozen `trade_up_score` formula / DB trigger.**
- **CSFloat rate-limit buffers.**
- **Non-additive migrations** (only additive DDL, applied manually).
- **Flagged-for-Tim**: the D&N dedup/diversity pass on the API surface — it would improve the product but *lowers M1 optically*, so it needs a human call on metric interpretation. Do not do it autonomously.
- Global: no `as any` / `as unknown as`; no `Co-Authored-By`/Claude attribution in commits; don't touch `git config user.email/name`; use the repository-owner `gh` token without switching the globally active account.

---

## 7. OMP adversarial review

- Run a fresh review agent against the complete diff, contract constraints, observable tests, and named revert signal.
- A crashed, missing, or unparseable review is not approval. Address every concrete blocker and re-run with fresh context.
- Sandboxed environment failures are not permission to ignore a gate: reproduce the affected command in the real checkout and record the grounded outcome.
- Review is a safety gate, not authority to widen the chosen lever or the off-limits list.

---

## 8. Benign patterns (do NOT mis-read as incidents)

- **Skinport WS observation-flush timeouts** (`skinport-ws.ts:99`) — batch dropped, KNN feedstock only, harmless.
- **`api` SIGINT restarts** — Tim deploying; clean/empty error log, restart count bumps.
- **pm2-logrotate at midnight** — `cat` the rotated `daemon-out__YYYY-MM-DD_00-00-00.log` **together with** `daemon-out.log` to see across the boundary.
- **Phase-1 Housekeeping purge** — drops expired *preserved* trade-ups (>24h); causes benign dips in `*_active` counts that recover.
- **Restart resets `cycleCount`** → staircase fires on cycle 1 by design (It9 first-cycle rule).

---

## 9. Iteration history (what's shipped)

Original backlog (E1–E4, cadence) was exhausted by It9; everything since is self-generated from telemetry.

| It | Lever | Status |
|----|-------|--------|
| 0 | 3-lever throughput deploy (float-targeting, bulk reprice, memory-gated workers) | stabilized |
| 1–4 | E1 `trade_up_score` column + sort; E3 knapsack; D staircase wired; E2 reverse-targeting | KEEP |
| 5–8 | detailed in the TSV, including E4-cleanup surgical dead-code removal (It8 precedent) | KEEP |
| 9 | Staircase cadence every-4 → every-2 + first-post-restart-cycle fire | KEEP-confirmed |
| 10 | E2 target cap 16 → 24 (cap-saturated; linear cost) | KEEP-confirmed |
| 11 | Dead-code bundle: `cooldownLoop` + `phase5GenericCalc` removed (−303 net) | KEEP-confirmed |
| 12 | E2 target cap 24 → 32 (still saturated; flow accelerated) | KEEP-confirmed |
| 13 | Knife-tier value-first collection ordering (`orderKnifeCollectionsByValue`) | **KEEP-confirmed (2026-07-27)** |
| 14 | E2 dead-greedy path removal | **KEEP — manual dispatch, PR #129, squash `b6edba8`, 24h clean (2026-08-11)** |
| 15 | S20 deep-rank swap explore strategy (`swapInputAtRank`, ranks 2–8) | **shipped-stabilizing (2026-08-14, PR #130, squash `8a84704`)** |

Key recurring thesis: **many candidate collections, one deadline** → order/target the highest-value work FIRST so a deadline cut starves only the cheapest work (E4-Step-3 / gun-E2 / knife-ordering all share this shape).

---

## 10. Current state & next action (2026-08-15)

- The Deckbox units are installed and live; the 2026-08-15 fire (run `daily-2026-08-15T103012-016Z-2616585`) was an observe-only fire per the <24h stabilization gate.
- Iteration 15 (S20 deep-rank swap) is `shipped-stabilizing` at ~22.8h: PR #130, squash `8a84704`, prod at `b3bd037`. Observed healthy: daemon online, 0 unstable restarts, error log 0 bytes, no OOM/crash/DB signals, 41 cycles at 31.9–35.4 min (avg ~33.6 vs 33.4 baseline).
- S20 watch-item evidence (read-only, 2026-08-15 ~10:30 UTC): mint flow 41,484 rows/24h with 3,352 at ge50 (current score) and max 174; active `explore:S20` 26,089 rows / 1,157 ge50. Classified softmax share saturated at **98%** — earned by real yield (23–396 mints per ~6k samples/pass), not the padding artifact. S16/S10 are NOT starved: 3,382 / 2,143 rows minted in 24h with continuous hourly flow; they hold 874 / 962 active ge50 rows.
- Board M1=82 / ge50=3004 / ge10=23,419 / max=175 / nulls=0 vs It15 baseline M1=50 / ge50=63. Interpretation caution: much of the board-wide rise is reprice/regime movement (S10/S16 rows older than 24h were rescored upward), so do not attribute the full delta to S20; S20's fresh ge50 mints are the directly attributable component.
- **Next fire:** make the formal It15 KEEP/REVERT decision (window complete). Specifically confirm the 98% classified share is not collapsing classified-tier diversity over a longer horizon, and that cycle times stay ~33 min.

---


## 11. Continuity incidents

### 2026-07-26 → 2026-08-13 — scheduler-silent gap

The last normal monitor record was Check 405 at approximately 2026-07-26 00:25 UTC. The daily and monitoring jobs were Claude `CronCreate` entries (`5e948b55` and `dd7ff0ed`) that explicitly lived only inside one session and auto-expired after seven days; there was no host cron/launchd/systemd definition, external heartbeat, or stale alert. The final initiating event (session exit, crash, closure, or later expiry) cannot be distinguished, but the persistence failure is proved. Production continued cycling, so product health masked operator-loop death. Iteration 14 shipped only through a manual 2026-08-10/11 dispatch. This gap is the reason Deckbox calendar timers plus an independent heartbeat watchdog are now mandatory.
