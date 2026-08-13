# Deckbox autoresearch scheduler

This directory is the repository-owned deployment artifact for TradeUpBot's durable engine/autoresearch loop. The repository previously had no operations-artifact convention; `ops/autoresearch/` keeps host units, their executable runtime, the installer, and its proof together without mixing them into application code or ephemeral `.monitoring` output.

The committed files are prepared artifacts. Committing them does not install, enable, or start anything. The first mate owns publication and the Deckbox enable step.

## Schedule and mechanism

Deckbox (`tim`'s lingering systemd user manager) is authoritative:

| Timer | UTC schedule | Purpose | Freshness limit |
|---|---|---|---|
| `trade-up-bot-autoresearch-fire.timer` | daily at 10:30 | Run one bounded autonomous engine iteration through OMP, including authorized push/merge/deploy or an honest observe/hold result | 26 hours |
| `trade-up-bot-engine-monitor.timer` | minute 11 and 41 of every hour | Read PM2, production head, M1/M2 board, E2 provenance, cadence, and error metadata over read-only SSH | 90 minutes |
| `trade-up-bot-autoresearch-watchdog.timer` | every 15 minutes | Turn missing, stale, or failed heartbeats into `watchdog-status.json` and a failed one-shot unit | artifact expires after 30 minutes |

Every timer uses `OnCalendar=... UTC` and `Persistent=true`. `OnCalendar` is deliberate: a calendar timer has a well-defined next elapse and `Persistent=true` catches up one missed activation after Deckbox downtime. `OnBootSec` plus `OnUnitActiveSec` was rejected because a timer installed after its one boot trigger has elapsed may never self-seed; it can have neither a last activation nor a finite next activation.

The units use `/home/tim/omp-firstmate/projects/trade-up-bot`, an explicit PATH containing Deckbox's Node/Bun installations, and an `EnvironmentFile` path rather than embedded secrets. The daily service requires `~/.config/trade-up-bot/autoresearch.env` (mode 0600, owned by `tim`) with `TEST_DATABASE_URL` for the dedicated localhost-only `tradeupbot_test` role/database. The wrapper connects and verifies both database and role before starting OMP; missing, unreadable, production-shaped, or unreachable configuration fails the fire and writes a failed heartbeat. OMP, GitHub, and VPS access use existing user-scoped authentication. Do not copy tokens, SSH keys, browser cookies, or Google sessions into this repository.

The daily unit's `EnvironmentFile` is mandatory. The monitor/watchdog references are deliberately optional so loss of the DB configuration breaks the daily fire but cannot also kill the failure reporters; they retain safe default state paths and freshness limits. Install/verify still reject a missing file.

`AUTORESEARCH_MAX_TIME` defaults to `330m`. Overrides must be positive integer seconds or one unit (`19800`, `330m`, or `5h`); compound durations such as `5h30m` are rejected before the database or agent starts, and the failed attempt is heartbeated.

### Service privilege boundary

All services set `NoNewPrivileges=true`, empty capability/ambient-capability sets, `PrivateTmp=true`, `PrivateDevices=true`, `ProtectSystem=strict`, `ProtectHome=read-only`, native syscall architecture, no realtime scheduling, and kernel/control-group/clock/hostname protections. The daily agent may write only the authoritative checkout, autoresearch state, OMP/package caches, and its user runtime directory. It needs ordinary outbound TCP/Unix sockets for the localhost test database, GitHub/`gh`, OMP authentication, and SSH to the VPS; it reads the existing gh and SSH configuration but cannot write either. The monitor gets outbound network plus only the state directory writable. The watchdog has no Internet address family and can write only state.

The Docker socket is explicitly inaccessible to every service. Integration tests use the dedicated unprivileged PostgreSQL role; they never require Docker, a docker-group grant, `sudo`, or host capabilities. `NoNewPrivileges` deliberately makes the host's `sudo` policy unusable from the unattended agent. Autonomous deploy authority covers repository/GitHub/VPS operations in the contract, not Deckbox root.

## Durable state and one-command status

Runtime artifacts default to:

```text
~/.local/state/trade-up-bot/autoresearch/
  heartbeats/daily.jsonl
  heartbeats/monitor.jsonl
  runs/<run-id>/result.json
  runs/<run-id>/agent-output.log
  watchdog-status.json
```

Each append-only heartbeat has UTC start/finish timestamps, the checkout git head, exit status, a specific `whatItDid` summary, and run/result provenance. The watchdog reports `OK`, `DEGRADED`, or `STALE`; missing heartbeats count as `STALE`, and a fresh nonzero fire counts as `DEGRADED` rather than masking failure with a new timestamp. Its artifact also carries `generatedAt`, `expiresAt`, and `maximumArtifactAgeSeconds=1800`. A frozen former `OK` therefore expires 30 minutes after generation.

The first mate must use the expiry-aware reader, not raw `cat`, so watchdog-timer silence is evaluated at read time:

```bash
node ops/autoresearch/bin/read-watchdog.mjs
```

For unit diagnostics, use `systemctl --user status trade-up-bot-autoresearch-watchdog.service` and `journalctl --user-unit trade-up-bot-autoresearch-watchdog.service`. No external alert credential or destination is required; the durable artifact and failed unit are the first-mate reporting surface.

## Install and verification

Before any unit mutation, run the non-mutating host preflight. After it passes, install from the authoritative checkout:

```bash
cd /home/tim/omp-firstmate/projects/trade-up-bot
ops/autoresearch/install.sh preflight
ops/autoresearch/install.sh install
```

Installation is intentionally fail-closed. It:

1. requires the 0600 `tim`-owned environment file and successfully verifies the dedicated `tradeupbot_test` database/role before touching units;
2. proves missing DB configuration fails, simulated missed heartbeats report `STALE`, fresh self-test fires report `OK`, and an old frozen `OK` watchdog artifact reads as `STALE`;
3. validates hardened unit syntax and copies the units to `~/.config/systemd/user/`;
4. reloads the user manager and asserts every unit is loaded;
5. runs the real read-only engine-monitor one-shot successfully;
6. runs one real autonomous daily-fire one-shot successfully (this may push/merge/deploy under the operating contract);
7. runs the watchdog and verifies the expiry-aware reader returns current `OK`;
8. enables the three timers, asserts each timer is active, and rejects an empty, `n/a`, zero, unparsable, or non-future `NextElapseUSecRealtime`.

The explicit real daily run prevents a newly installed scheduler from appearing healthy before it has ever fired. To re-run non-mutating installed-state assertions:

```bash
ops/autoresearch/install.sh verify
```

`autoresearch.env.example` documents the required DSN and optional non-secret overrides. The real password stays only in the host file; never commit it.

## Rollback

Rollback disables/stops the timers, stops the services, removes only these installed unit files, reloads the user manager, and clears failed-unit state:

```bash
ops/autoresearch/install.sh rollback
```

Rollback deliberately preserves `~/.local/state/trade-up-bot/autoresearch/` and `~/.config/trade-up-bot/autoresearch.env` for audit/recovery. Removing either requires a separate explicit operator action.

## Browser evidence boundary

GSC and GA4 remain bound to the captain's authenticated Chrome/CDP session. They are not queried, proxied, or represented as automated evidence by these units. Browser evidence must be supplied separately by the captain; its absence cannot silently block or falsify the engine loop.
