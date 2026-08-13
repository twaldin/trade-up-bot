# Deckbox autoresearch scheduler

This directory is the repository-owned deployment artifact for TradeUpBot's durable engine/autoresearch loop. The repository previously had no operations-artifact convention; `ops/autoresearch/` keeps host units, their executable runtime, the installer, and its proof together without mixing them into application code or ephemeral `.monitoring` output.

The committed files are prepared artifacts. Committing them does not install, enable, or start anything. The first mate owns publication and the Deckbox enable step.

## Schedule and mechanism

Deckbox (`tim`'s lingering systemd user manager) is authoritative:

| Timer | UTC schedule | Purpose | Freshness limit |
|---|---|---|---|
| `trade-up-bot-autoresearch-fire.timer` | daily at 10:30 | Run one bounded autonomous engine iteration through OMP, including authorized push/merge/deploy or an honest observe/hold result | 26 hours |
| `trade-up-bot-engine-monitor.timer` | minute 11 and 41 of every hour | Read PM2, production head, M1/M2 board, E2 provenance, cadence, and error metadata over read-only SSH | 90 minutes |
| `trade-up-bot-autoresearch-watchdog.timer` | every 15 minutes | Turn missing, stale, or failed heartbeats into `watchdog-status.json` and a failed one-shot unit | 15-minute check cadence |

Every timer uses `OnCalendar=... UTC` and `Persistent=true`. `OnCalendar` is deliberate: a calendar timer has a well-defined next elapse and `Persistent=true` catches up one missed activation after Deckbox downtime. `OnBootSec` plus `OnUnitActiveSec` was rejected because a timer installed after its one boot trigger has elapsed may never self-seed; it can have neither a last activation nor a finite next activation.

The units use `/home/tim/omp-firstmate/projects/trade-up-bot`, an explicit PATH containing Deckbox's Node/Bun installations, and only an optional `EnvironmentFile` path. Unit text contains no secret. OMP uses the existing user-scoped authentication; GitHub and VPS access use the existing user-scoped `gh` and SSH configuration. Do not copy tokens, SSH keys, browser cookies, or Google sessions into this repository or the environment file.

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

Each append-only heartbeat has UTC start/finish timestamps, the checkout git head, exit status, a specific `whatItDid` summary, and run/result provenance. The watchdog reports `OK`, `DEGRADED`, or `STALE`; missing heartbeats count as `STALE`, and a fresh nonzero fire counts as `DEGRADED` rather than masking failure with a new timestamp.

The first mate reads the complete silence signal in one command:

```bash
cat ~/.local/state/trade-up-bot/autoresearch/watchdog-status.json
```

For unit diagnostics, use `systemctl --user status trade-up-bot-autoresearch-watchdog.service` and `journalctl --user-unit trade-up-bot-autoresearch-watchdog.service`. No external alert credential or destination is required; the durable artifact and failed unit are the first-mate reporting surface.

## Install and verification

After these files land in the authoritative checkout, the first mate runs:

```bash
cd /home/tim/omp-firstmate/projects/trade-up-bot
ops/autoresearch/install.sh install
```

Installation is intentionally fail-closed. It:

1. proves the simulated missed-fire path reports `STALE`, then proves successful self-test fires produce fresh heartbeats;
2. validates unit syntax and copies the units to `~/.config/systemd/user/`;
3. reloads the user manager and asserts every unit is loaded;
4. runs the real read-only engine-monitor one-shot successfully;
5. runs one real autonomous daily-fire one-shot successfully (this may push/merge/deploy under the operating contract);
6. runs the watchdog successfully and verifies its artifact is `OK`;
7. enables the three timers, asserts each timer is active, and rejects an empty, `n/a`, zero, unparsable, or non-future `NextElapseUSecRealtime`.

The explicit real daily run prevents a newly installed scheduler from appearing healthy before it has ever fired. To re-run non-mutating installed-state assertions:

```bash
ops/autoresearch/install.sh verify
```

Optional non-secret overrides are documented in `autoresearch.env.example`. The user may copy it to `~/.config/trade-up-bot/autoresearch.env`; it is never required.

## Rollback

Rollback disables/stops the timers, stops the services, removes only these installed unit files, reloads the user manager, and clears failed-unit state:

```bash
ops/autoresearch/install.sh rollback
```

Rollback deliberately preserves `~/.local/state/trade-up-bot/autoresearch/` and `~/.config/trade-up-bot/autoresearch.env` for audit/recovery. Removing either requires a separate explicit operator action.

## Browser evidence boundary

GSC and GA4 remain bound to the captain's authenticated Chrome/CDP session. They are not queried, proxied, or represented as automated evidence by these units. Browser evidence must be supplied separately by the captain; its absence cannot silently block or falsify the engine loop.
