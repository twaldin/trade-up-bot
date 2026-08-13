#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  appendHeartbeat,
  gitHead,
  isoUtc,
  makeRunId,
  repoDir,
} from "../lib/runtime.mjs";

const SELF_TEST = process.argv.includes("--self-test");
const started = new Date();
const runId = makeRunId("monitor", started);
const remoteHost = process.env.AUTORESEARCH_VPS_HOST ?? "root@178.156.239.58";
const remoteRepo = process.env.AUTORESEARCH_VPS_REPO ?? "/opt/trade-up-bot";

if (!/^[A-Za-z0-9_.@:-]+$/.test(remoteHost)) throw new Error("AUTORESEARCH_VPS_HOST contains unsupported characters");
if (!/^\/[A-Za-z0-9_./-]+$/.test(remoteRepo)) throw new Error("AUTORESEARCH_VPS_REPO must be an absolute simple path");

const SQL = String.raw`
WITH active AS (
  SELECT trade_up_score, type, COALESCE(discovered_via, 'unknown') AS discovered_via
  FROM trade_ups
  WHERE is_theoretical = false AND listing_status = 'active'
), top100 AS (
  SELECT trade_up_score FROM active
  WHERE trade_up_score IS NOT NULL
  ORDER BY trade_up_score DESC
  LIMIT 100
), provenance AS (
  SELECT discovered_via, count(*)::int AS n
  FROM active
  GROUP BY discovered_via
)
SELECT json_build_object(
  'm1MedianTop100', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY trade_up_score) FROM top100),
  'm2CountGe50', count(*) FILTER (WHERE trade_up_score >= 50),
  'countGe30', count(*) FILTER (WHERE trade_up_score >= 30),
  'countGe10', count(*) FILTER (WHERE trade_up_score >= 10),
  'nullScores', count(*) FILTER (WHERE trade_up_score IS NULL),
  'maxScore', max(trade_up_score),
  'activeRows', count(*),
  'staircaseActive', count(*) FILTER (WHERE type = 'staircase'),
  'e2Provenance', (SELECT COALESCE(json_object_agg(discovered_via, n), '{}'::json) FROM provenance WHERE discovered_via LIKE 'e2:%')
)::text
FROM active;
`;

const REMOTE_PROGRAM = String.raw`
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

function readDatabaseUrl() {
  const text = readFileSync(".env", "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) throw new Error("DATABASE_URL is empty");
    return value;
  }
  return "postgresql://localhost:5432/tradeupbot";
}

function readTail(path, bytes = 131072) {
  try {
    const text = readFileSync(path, "utf8");
    return text.slice(-bytes);
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function fileMetadata(path) {
  try {
    const stat = statSync(path);
    return { bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch (error) {
    if (error?.code === "ENOENT") return { bytes: 0, modifiedAt: null };
    throw error;
  }
}

const pm2Raw = execFileSync("pm2", ["jlist"], { encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
const arrayStart = pm2Raw.indexOf("[");
const arrayEnd = pm2Raw.lastIndexOf("]");
if (arrayStart < 0 || arrayEnd < arrayStart) throw new Error("pm2 jlist did not return JSON");
const pm2 = JSON.parse(pm2Raw.slice(arrayStart, arrayEnd + 1));
const processes = pm2.map((entry) => ({
  name: entry.name,
  status: entry.pm2_env?.status ?? "unknown",
  restartCount: entry.pm2_env?.restart_time ?? null,
  unstableRestarts: entry.pm2_env?.unstable_restarts ?? null,
  startedAt: Number.isFinite(entry.pm2_env?.pm_uptime) ? new Date(entry.pm2_env.pm_uptime).toISOString() : null,
  memoryBytes: entry.monit?.memory ?? null,
}));

const databaseUrl = readDatabaseUrl();
const boardSql = __AUTORESEARCH_BOARD_SQL__;
const boardRaw = execFileSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", boardSql], {
  encoding: "utf8",
  timeout: 30000,
  maxBuffer: 4 * 1024 * 1024,
}).trim();
const board = JSON.parse(boardRaw);

const daemonErrorPath = "/root/.pm2/logs/daemon-error.log";
const daemonOutPath = "/root/.pm2/logs/daemon-out.log";
const errorTail = readTail(daemonErrorPath);
const daemonTail = readTail(daemonOutPath, 262144);
const breakPatterns = {
  oom: /out of memory|heap limit|allocation failed/i,
  crash: /uncaught|fatal error|segmentation fault/i,
  database: /database error|connection terminated|ECONNREFUSED.*5432/i,
};
const breakSignalsInTail = Object.fromEntries(Object.entries(breakPatterns).map(([name, pattern]) => [name, pattern.test(errorTail)]));
const loopNumbers = [...daemonTail.matchAll(/(?:loop|cycle)\s+#?(\d+)/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
const prodHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 10000 }).trim();

process.stdout.write(JSON.stringify({
  observedAt: new Date().toISOString(),
  prodHead,
  processes,
  board,
  latestLoopOrCycle: loopNumbers.at(-1) ?? null,
  daemonOut: fileMetadata(daemonOutPath),
  daemonError: fileMetadata(daemonErrorPath),
  breakSignalsInTail,
}));
`;

let exitStatus = 1;
let details = null;
let errorMessage = null;
let deckboxHead = null;

try {
  deckboxHead = gitHead(repoDir);
  if (SELF_TEST) {
    details = {
      observedAt: isoUtc(),
      prodHead: null,
      processes: [],
      board: null,
      latestLoopOrCycle: null,
      selfTest: true,
    };
  } else {
    const remoteCommand = `cd '${remoteRepo.replaceAll("'", "'\\''")}' && exec node --input-type=module`;
    const remote = spawnSync("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=20",
      remoteHost,
      remoteCommand,
    ], {
      input: REMOTE_PROGRAM.replace("__AUTORESEARCH_BOARD_SQL__", JSON.stringify(SQL)),
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (remote.error) throw remote.error;
    if (remote.status !== 0) throw new Error((remote.stderr || `ssh exited ${remote.status}`).trim());
    details = JSON.parse(remote.stdout.trim());
    for (const requiredName of ["daemon", "api"]) {
      const process = details.processes.find((entry) => entry.name === requiredName);
      if (!process || process.status !== "online") throw new Error(`${requiredName} is not online`);
    }
  }
  exitStatus = 0;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
}

const finished = new Date();
const heartbeat = {
  schemaVersion: 1,
  kind: "engine-monitor",
  runId,
  timestamp: isoUtc(finished),
  startedAt: isoUtc(started),
  finishedAt: isoUtc(finished),
  gitHead: deckboxHead,
  exitStatus,
  whatItDid: exitStatus === 0
    ? (SELF_TEST ? "Verified the engine-monitor heartbeat path without contacting production." : "Read PM2 health, production git head, board metrics, E2 provenance, daemon cadence, and error metadata.")
    : "Engine monitoring failed before a complete production observation was collected.",
  details,
  selfTest: SELF_TEST,
  error: errorMessage,
};
const heartbeatPath = appendHeartbeat("monitor", heartbeat);
process.stdout.write(`${JSON.stringify({ heartbeatPath, heartbeat })}\n`);

if (exitStatus !== 0) {
  process.stderr.write(`engine monitor failed: ${errorMessage ?? "unknown error"}\n`);
  process.exitCode = exitStatus;
}
