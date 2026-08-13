#!/usr/bin/env node

import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  appendHeartbeat,
  atomicWriteJson,
  ensureDir,
  gitHead,
  isoUtc,
  makeRunId,
  readJson,
  repoDir,
  stateDir,
} from "../lib/runtime.mjs";

const SELF_TEST = process.argv.includes("--self-test");
const started = new Date();
const runId = makeRunId("daily", started);
const runDir = join(stateDir, "runs", runId);
const resultPath = join(runDir, "result.json");
const outputPath = join(runDir, "agent-output.log");
ensureDir(runDir);

let headBefore = null;
let headAfter = null;
let exitStatus = 1;
let result = null;
let errorMessage = null;

function validateResult(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("result must be a JSON object");
  }
  if (candidate.schemaVersion !== 1) throw new Error("result.schemaVersion must equal 1");
  if (candidate.runId !== runId) throw new Error(`result.runId must equal ${runId}`);
  if (typeof candidate.summary !== "string" || candidate.summary.trim() === "") {
    throw new Error("result.summary must be a non-empty string");
  }
  if (typeof candidate.decision !== "string" || candidate.decision.trim() === "") {
    throw new Error("result.decision must be a non-empty string");
  }
  return candidate;
}

try {
  headBefore = gitHead();

  if (SELF_TEST) {
    result = {
      schemaVersion: 1,
      runId,
      decision: "SELF_TEST",
      summary: "Verified the daily-fire heartbeat path without research, repository mutation, push, or deploy.",
      iteration: null,
      pullRequest: null,
      deployedCommit: null,
    };
    atomicWriteJson(resultPath, result);
    exitStatus = 0;
  } else {
    const databasePreflight = spawnSync(process.execPath, [
      fileURLToPath(new URL("./check-test-database.mjs", import.meta.url)),
    ], {
      cwd: repoDir,
      env: process.env,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (databasePreflight.error) throw databasePreflight.error;
    if (databasePreflight.status !== 0) {
      throw new Error((databasePreflight.stderr || "test database preflight failed").trim());
    }

    const promptTemplate = readFileSync(new URL("../daily-fire-prompt.md", import.meta.url), "utf8");
    const prompt = promptTemplate
      .replaceAll("{{RUN_ID}}", runId)
      .replaceAll("{{RESULT_PATH}}", resultPath)
      .replaceAll("{{REPO_DIR}}", repoDir)
      .replaceAll("{{STATE_DIR}}", stateDir);

    const args = [
      "--print",
      "--cwd", repoDir,
      "--approval-mode", "yolo",
      "--max-time", process.env.AUTORESEARCH_MAX_TIME ?? "5h30m",
      "--no-title",
      "--no-session",
    ];
    if (process.env.AUTORESEARCH_MODEL) args.push("--model", process.env.AUTORESEARCH_MODEL);
    if (process.env.AUTORESEARCH_OMP_PROFILE) args.push("--profile", process.env.AUTORESEARCH_OMP_PROFILE);
    args.push(prompt);

    const outputFd = openSync(outputPath, "a", 0o600);
    let agent;
    try {
      agent = spawnSync(process.env.AUTORESEARCH_OMP_BIN ?? "omp", args, {
        cwd: repoDir,
        env: {
          ...process.env,
          AUTORESEARCH_RUN_ID: runId,
          AUTORESEARCH_RESULT_FILE: resultPath,
          AUTORESEARCH_STATE_DIR: stateDir,
        },
        stdio: ["ignore", outputFd, outputFd],
        timeout: 21_000_000,
      });
    } finally {
      closeSync(outputFd);
    }

    if (agent.error) throw agent.error;
    if (agent.status !== 0) throw new Error(`autoresearch agent exited ${agent.status ?? "without a status"}`);
    result = validateResult(readJson(resultPath));
    if (result.decision === "FAILED") throw new Error(result.summary);
    exitStatus = 0;
  }
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
} finally {
  try {
    headAfter = gitHead();
  } catch (error) {
    errorMessage ??= error instanceof Error ? error.message : String(error);
  }

  const finished = new Date();
  const heartbeat = {
    schemaVersion: 1,
    kind: "daily-fire",
    runId,
    timestamp: isoUtc(finished),
    startedAt: isoUtc(started),
    finishedAt: isoUtc(finished),
    gitHeadBefore: headBefore,
    gitHeadAfter: headAfter,
    exitStatus,
    whatItDid: result?.summary ?? "Daily autoresearch fire failed before producing a valid result.",
    decision: result?.decision ?? "FAILED",
    iteration: result?.iteration ?? null,
    pullRequest: result?.pullRequest ?? null,
    deployedCommit: result?.deployedCommit ?? null,
    resultPath,
    outputPath: SELF_TEST ? null : outputPath,
    selfTest: SELF_TEST,
    error: errorMessage,
  };
  const heartbeatPath = appendHeartbeat("daily", heartbeat);
  process.stdout.write(`${JSON.stringify({ heartbeatPath, heartbeat })}\n`);
}

if (exitStatus !== 0) {
  process.stderr.write(`autoresearch fire failed: ${errorMessage ?? "unknown error"}\n`);
  process.exitCode = exitStatus;
}
