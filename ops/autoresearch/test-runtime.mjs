#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const temporary = mkdtempSync(join(tmpdir(), "trade-up-bot-autoresearch-test-"));
const state = join(temporary, "state");
const environment = {
  ...process.env,
  AUTORESEARCH_REPO_DIR: repo,
  AUTORESEARCH_STATE_DIR: state,
};

function run(script, args = [], expectedStatus = 0, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, [join(here, "bin", script), ...args], {
    cwd: repo,
    env: { ...environment, ...extraEnvironment },
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, `${script} exited ${result.status}: ${result.stderr || result.stdout}`);
  return result;
}

function assertUnitHardening() {
  const systemdDir = join(here, "systemd");
  for (const name of [
    "trade-up-bot-autoresearch-fire.service",
    "trade-up-bot-engine-monitor.service",
    "trade-up-bot-autoresearch-watchdog.service",
  ]) {
    const unit = readFileSync(join(systemdDir, name), "utf8");
    for (const directive of [
      "NoNewPrivileges=true",
      "PrivateTmp=true",
      "PrivateDevices=true",
      "ProtectSystem=strict",
      "ProtectHome=read-only",
      "CapabilityBoundingSet=",
      "AmbientCapabilities=",
      "InaccessiblePaths=-/var/run/docker.sock -/run/docker.sock",
    ]) {
      assert.match(unit, new RegExp(`^${directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `${name} lacks ${directive}`);
    }
  }

  const daily = readFileSync(join(systemdDir, "trade-up-bot-autoresearch-fire.service"), "utf8");
  assert.match(daily, /^EnvironmentFile=%h\/\.config\/trade-up-bot\/autoresearch\.env$/m);
  assert.match(daily, /^ReadWritePaths=.*projects\/trade-up-bot.*\.local\/state\/trade-up-bot\/autoresearch/m);
  assert.doesNotMatch(daily, /ReadWritePaths=.*\.ssh/);
  assert.doesNotMatch(daily, /ReadWritePaths=.*\.config\/gh/);

  const watchdog = readFileSync(join(systemdDir, "trade-up-bot-autoresearch-watchdog.service"), "utf8");
  assert.match(watchdog, /^RestrictAddressFamilies=AF_UNIX$/m);
  assert.doesNotMatch(watchdog, /RestrictAddressFamilies=.*AF_INET/);
}

try {
  assertUnitHardening();
  const missingDatabase = run("check-test-database.mjs", [], 1, { TEST_DATABASE_URL: "" });
  assert.match(missingDatabase.stderr, /TEST_DATABASE_URL is required/);
  const productionShapedDatabase = run("check-test-database.mjs", [], 1, {
    TEST_DATABASE_URL: "postgresql://role:password@127.0.0.1:5432/tradeupbot",
  });
  assert.match(productionShapedDatabase.stderr, /dedicated tradeupbot_test database/);

  const heartbeatDir = join(state, "heartbeats");
  mkdirSync(heartbeatDir, { recursive: true });
  const malformedDuration = run("autoresearch-fire.mjs", [], 1, {
    AUTORESEARCH_MAX_TIME: "5h30m",
    TEST_DATABASE_URL: "",
  });
  assert.match(malformedDuration.stderr, /one duration unit/);
  const malformedDurationHeartbeat = JSON.parse(
    readFileSync(join(heartbeatDir, "daily.jsonl"), "utf8").trim().split("\n").at(-1),
  );
  assert.equal(malformedDurationHeartbeat.exitStatus, 1);
  assert.match(malformedDurationHeartbeat.error, /received \"5h30m\"/);

  const failedFire = run("autoresearch-fire.mjs", [], 1, { TEST_DATABASE_URL: "" });
  assert.match(failedFire.stderr, /TEST_DATABASE_URL is required/);
  const failedHeartbeat = JSON.parse(
    readFileSync(join(heartbeatDir, "daily.jsonl"), "utf8").trim().split("\n").at(-1),
  );
  assert.equal(failedHeartbeat.exitStatus, 1);
  assert.match(failedHeartbeat.error, /TEST_DATABASE_URL is required/);

  const oldTimestamp = "2026-08-10T00:00:00.000Z";
  const oldBase = {
    schemaVersion: 1,
    timestamp: oldTimestamp,
    startedAt: oldTimestamp,
    finishedAt: oldTimestamp,
    gitHead: "b6edba8cbc08522344dc51811317ef5c1c43c7a2",
    exitStatus: 0,
    whatItDid: "simulated formerly successful fire",
  };
  writeFileSync(join(heartbeatDir, "daily.jsonl"), `${JSON.stringify({ ...oldBase, kind: "daily-fire", runId: "daily-old" })}\n`);
  writeFileSync(join(heartbeatDir, "monitor.jsonl"), `${JSON.stringify({ ...oldBase, kind: "engine-monitor", runId: "monitor-old" })}\n`);

  run("watchdog.mjs", ["--now", "2026-08-13T12:00:00.000Z"], 2);
  const stale = JSON.parse(readFileSync(join(state, "watchdog-status.json"), "utf8"));
  assert.equal(stale.status, "STALE");
  assert.deepEqual(stale.checks.map((check) => check.status), ["STALE", "STALE"]);

  run("autoresearch-fire.mjs", ["--self-test"]);
  run("engine-monitor.mjs", ["--self-test"]);
  run("watchdog.mjs", ["--now", new Date().toISOString()]);

  const fresh = JSON.parse(readFileSync(join(state, "watchdog-status.json"), "utf8"));
  assert.equal(fresh.status, "OK");
  assert.deepEqual(fresh.checks.map((check) => check.status), ["OK", "OK"]);

  const freshRead = JSON.parse(run("read-watchdog.mjs", ["--now", fresh.generatedAt]).stdout);
  assert.equal(freshRead.status, "OK");
  assert.equal(freshRead.expiresAt, fresh.expiresAt);

  const afterExpiry = new Date(Date.parse(fresh.expiresAt) + 1000).toISOString();
  const expiredRead = JSON.parse(run("read-watchdog.mjs", ["--now", afterExpiry], 2).stdout);
  assert.equal(expiredRead.status, "STALE");
  assert.match(expiredRead.reason, /own timer may be silent/);

  const dailyLines = readFileSync(join(heartbeatDir, "daily.jsonl"), "utf8").trim().split("\n");
  const freshDaily = JSON.parse(dailyLines.at(-1));
  assert.equal(freshDaily.exitStatus, 0);
  assert.equal(freshDaily.selfTest, true);
  assert.match(freshDaily.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(freshDaily.gitHeadAfter, /^[0-9a-f]{40}$/);
  assert.match(freshDaily.whatItDid, /heartbeat path/);

  process.stdout.write(`PASS heartbeatStale=${stale.status} fresh=${fresh.status} artifactExpired=${expiredRead.status} dailyHeartbeat=${freshDaily.timestamp}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
