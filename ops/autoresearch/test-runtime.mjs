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

try {
  const heartbeatDir = join(state, "heartbeats");
  mkdirSync(heartbeatDir, { recursive: true });
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

  const dailyLines = readFileSync(join(heartbeatDir, "daily.jsonl"), "utf8").trim().split("\n");
  const freshDaily = JSON.parse(dailyLines.at(-1));
  assert.equal(freshDaily.exitStatus, 0);
  assert.equal(freshDaily.selfTest, true);
  assert.match(freshDaily.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(freshDaily.gitHeadAfter, /^[0-9a-f]{40}$/);
  assert.match(freshDaily.whatItDid, /heartbeat path/);

  process.stdout.write(`PASS stale=${stale.status} fresh=${fresh.status} dailyHeartbeat=${freshDaily.timestamp}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
