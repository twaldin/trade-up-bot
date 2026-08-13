#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isoUtc, stateDir } from "../lib/runtime.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const nowArgument = argumentValue("--now");
const now = nowArgument ? new Date(nowArgument) : new Date();
if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO-8601 timestamp");

const inputPath = process.env.AUTORESEARCH_WATCHDOG_STATUS_FILE ?? join(stateDir, "watchdog-status.json");
let artifact = null;
let artifactError = null;
try {
  artifact = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (error) {
  artifactError = error instanceof Error ? error.message : String(error);
}

let status = "STALE";
let exitStatus = 2;
let checks = [];
let generatedAt = null;
let expiresAt = null;
let maximumArtifactAgeSeconds = null;
let reason;

if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
  reason = `watchdog artifact is missing or invalid: ${artifactError ?? "not an object"}`;
} else {
  generatedAt = artifact.generatedAt ?? null;
  expiresAt = artifact.expiresAt ?? null;
  maximumArtifactAgeSeconds = artifact.maximumArtifactAgeSeconds ?? null;
  const generatedMs = Date.parse(generatedAt ?? "");
  const expiresMs = Date.parse(expiresAt ?? "");

  if (!Number.isFinite(generatedMs) || !Number.isFinite(expiresMs) || !Number.isFinite(maximumArtifactAgeSeconds) || maximumArtifactAgeSeconds <= 0) {
    reason = "watchdog artifact does not carry a valid generatedAt, expiresAt, and positive maximumArtifactAgeSeconds";
  } else if (Math.abs((expiresMs - generatedMs) / 1000 - maximumArtifactAgeSeconds) > 1) {
    reason = "watchdog artifact expiry does not match its declared maximum age";
  } else if (now.getTime() > expiresMs) {
    reason = `watchdog artifact expired at ${expiresAt}; its own timer may be silent`;
  } else if (now.getTime() < generatedMs - 5 * 60 * 1000) {
    status = "DEGRADED";
    exitStatus = 1;
    reason = "watchdog artifact is more than five minutes in the future; check host clock";
    checks = Array.isArray(artifact.checks) ? artifact.checks : [];
  } else {
    status = artifact.status;
    exitStatus = artifact.exitStatus;
    reason = "watchdog artifact is within its self-declared freshness window";
    checks = Array.isArray(artifact.checks) ? artifact.checks : [];
    if (!(["OK", "DEGRADED", "STALE"].includes(status)) || !([0, 1, 2].includes(exitStatus))) {
      status = "STALE";
      exitStatus = 2;
      reason = "watchdog artifact carries an invalid status or exitStatus";
    }
  }
}

const result = {
  schemaVersion: 1,
  status,
  generatedAt,
  expiresAt,
  maximumArtifactAgeSeconds,
  evaluatedAt: isoUtc(now),
  exitStatus,
  reason,
  checks,
  artifactPath: inputPath,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = exitStatus;
