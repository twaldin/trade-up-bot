import { appendFileSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const repoDir = process.env.AUTORESEARCH_REPO_DIR
  ?? "/home/tim/omp-firstmate/projects/trade-up-bot";

export const stateDir = process.env.AUTORESEARCH_STATE_DIR
  ?? join(process.env.XDG_STATE_HOME ?? join(process.env.HOME, ".local", "state"), "trade-up-bot", "autoresearch");

export function ensureDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function isoUtc(date = new Date()) {
  return date.toISOString();
}

export function makeRunId(kind, date = new Date()) {
  return `${kind}-${date.toISOString().replaceAll(":", "").replaceAll(".", "-")}-${process.pid}`;
}

export function gitHead(cwd = repoDir) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git rev-parse failed").trim();
    throw new Error(detail);
  }
  return result.stdout.trim();
}

export function appendHeartbeat(kind, record) {
  const directory = join(stateDir, "heartbeats");
  ensureDir(directory);
  const path = join(directory, `${kind}.jsonl`);
  const fd = openSync(path, "a", 0o600);
  try {
    appendFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  return path;
}

export function atomicWriteJson(path, value) {
  ensureDir(dirname(path));
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readNewestHeartbeat(kind) {
  const path = join(stateDir, "heartbeats", `${kind}.jsonl`);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  let newest = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let candidate;
    try {
      candidate = JSON.parse(line);
    } catch {
      continue;
    }
    const timestampMs = Date.parse(candidate.finishedAt ?? candidate.timestamp ?? "");
    if (!Number.isFinite(timestampMs)) continue;
    if (!newest || timestampMs > newest.timestampMs) newest = { record: candidate, timestampMs };
  }
  return newest;
}

export function positiveNumber(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number`);
  return number;
}
