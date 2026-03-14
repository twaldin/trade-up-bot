/**
 * Trade-Up Bot Daemon — multi-type with float-aware theory.
 *
 * Phases: Housekeeping → Theory (knife+classified+staircase) → Probe → Fetch →
 *         Calc (knife+classified+staircase) → Cooldown → Re-materialize
 */

import fs from "fs";

const LOG_PATH = "/tmp/daemon.log";
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB — rotate when exceeded

// Tee all stdout/stderr to log file — works regardless of shell redirects
// Truncates log on each daemon start so DaemonModal shows current session
fs.writeFileSync(LOG_PATH, "");
const logFd = fs.openSync(LOG_PATH, "a");
let byteCount = 0;

const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = function(chunk: Uint8Array | string, ...args: unknown[]): boolean {
  const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
  fs.writeSync(logFd, buf);
  byteCount += buf.length;
  if (byteCount > MAX_LOG_BYTES) rotateLog();
  return (origStdoutWrite as (...a: unknown[]) => boolean)(chunk, ...args);
} as typeof process.stdout.write;

process.stderr.write = function(chunk: Uint8Array | string, ...args: unknown[]): boolean {
  const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
  fs.writeSync(logFd, buf);
  byteCount += buf.length;
  return (origStderrWrite as (...a: unknown[]) => boolean)(chunk, ...args);
} as typeof process.stderr.write;

function rotateLog() {
  try {
    const content = fs.readFileSync(LOG_PATH, "utf-8");
    const lines = content.split("\n");
    const kept = lines.slice(Math.floor(lines.length / 2)).join("\n");
    fs.writeFileSync(LOG_PATH, kept);
    byteCount = Buffer.byteLength(kept);
  } catch { /* log file rotation is best-effort */ }
}

import { main } from "./daemon-knife/index.js";

main().catch((err) => {
  console.error("Daemon crashed:", err);
  process.exit(1);
});
