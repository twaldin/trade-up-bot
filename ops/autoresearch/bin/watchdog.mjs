#!/usr/bin/env node

import { join } from "node:path";
import {
  atomicWriteJson,
  isoUtc,
  positiveNumber,
  readNewestHeartbeat,
  stateDir,
} from "../lib/runtime.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const nowArgument = argumentValue("--now");
const now = nowArgument ? new Date(nowArgument) : new Date();
if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO-8601 timestamp");

const sources = [
  {
    kind: "daily",
    label: "daily-fire",
    maximumAgeSeconds: positiveNumber(process.env.AUTORESEARCH_DAILY_MAX_AGE_SECONDS, 26 * 60 * 60, "AUTORESEARCH_DAILY_MAX_AGE_SECONDS"),
  },
  {
    kind: "monitor",
    label: "engine-monitor",
    maximumAgeSeconds: positiveNumber(process.env.AUTORESEARCH_MONITOR_MAX_AGE_SECONDS, 90 * 60, "AUTORESEARCH_MONITOR_MAX_AGE_SECONDS"),
  },
];

const checks = sources.map((source) => {
  const newest = readNewestHeartbeat(source.kind);
  if (!newest) {
    return {
      kind: source.label,
      status: "MISSING",
      maximumAgeSeconds: source.maximumAgeSeconds,
      ageSeconds: null,
      latestFinishedAt: null,
      latestExitStatus: null,
      latestRunId: null,
      gitHead: null,
      whatItDid: null,
      reason: "no valid heartbeat exists",
    };
  }

  const rawAgeSeconds = (now.getTime() - newest.timestampMs) / 1000;
  const ageSeconds = Math.max(0, rawAgeSeconds);
  let status = "OK";
  let reason = "fresh successful heartbeat";
  if (rawAgeSeconds < -300) {
    status = "DEGRADED";
    reason = "heartbeat is more than five minutes in the future; check host clock";
  } else if (ageSeconds > source.maximumAgeSeconds) {
    status = "STALE";
    reason = `heartbeat age exceeds ${source.maximumAgeSeconds} seconds`;
  } else if (newest.record.exitStatus !== 0) {
    status = "DEGRADED";
    reason = `latest fire exited ${newest.record.exitStatus}`;
  }

  return {
    kind: source.label,
    status,
    maximumAgeSeconds: source.maximumAgeSeconds,
    ageSeconds: Math.round(ageSeconds * 1000) / 1000,
    latestFinishedAt: newest.record.finishedAt ?? newest.record.timestamp,
    latestExitStatus: newest.record.exitStatus,
    latestRunId: newest.record.runId ?? null,
    gitHead: newest.record.gitHeadAfter ?? newest.record.gitHead ?? null,
    whatItDid: newest.record.whatItDid ?? null,
    reason,
  };
});

let status = "OK";
let exitStatus = 0;
if (checks.some((check) => check.status === "MISSING" || check.status === "STALE")) {
  status = "STALE";
  exitStatus = 2;
} else if (checks.some((check) => check.status === "DEGRADED")) {
  status = "DEGRADED";
  exitStatus = 1;
}

const artifact = {
  schemaVersion: 1,
  status,
  generatedAt: isoUtc(now),
  exitStatus,
  checks,
};
const outputPath = process.env.AUTORESEARCH_WATCHDOG_STATUS_FILE ?? join(stateDir, "watchdog-status.json");
atomicWriteJson(outputPath, artifact);
process.stdout.write(`${JSON.stringify({ outputPath, ...artifact })}\n`);
process.exitCode = exitStatus;
