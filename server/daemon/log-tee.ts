/**
 * Tee daemon stdout/stderr to a file the admin log API reads.
 *
 * Each chunk is written once to the file and once to the original stream.
 * PM2 captures that original stream in its own log file. Installing the tee
 * twice would wrap the wrapper and duplicate every line, so install is idempotent.
 */

import fs from "fs";

const INSTALLED = Symbol.for("tradeupbot.daemonLogTee");

type TeeStream = NodeJS.WriteStream & { [INSTALLED]?: boolean };

export function installDaemonLogTee(logPath: string, maxBytes = 2 * 1024 * 1024): () => void {
  const stdout = process.stdout as TeeStream;
  if (stdout[INSTALLED]) return () => {};

  fs.writeFileSync(logPath, "");
  const logFd = fs.openSync(logPath, "a");
  let byteCount = 0;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  function rotateLog() {
    try {
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n");
      const kept = lines.slice(Math.floor(lines.length / 2)).join("\n");
      fs.writeFileSync(logPath, kept);
      byteCount = Buffer.byteLength(kept);
    } catch { /* log file rotation is best-effort */ }
  }

  function tee(orig: (...args: unknown[]) => boolean, chunk: Uint8Array | string, args: unknown[], rotate: boolean): boolean {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    fs.writeSync(logFd, buf);
    byteCount += buf.length;
    if (rotate && byteCount > maxBytes) rotateLog();
    return orig(chunk, ...args);
  }

  process.stdout.write = function(chunk: Uint8Array | string, ...args: unknown[]): boolean {
    return tee(origStdoutWrite as (...a: unknown[]) => boolean, chunk, args, true);
  } as typeof process.stdout.write;

  process.stderr.write = function(chunk: Uint8Array | string, ...args: unknown[]): boolean {
    return tee(origStderrWrite as (...a: unknown[]) => boolean, chunk, args, false);
  } as typeof process.stderr.write;

  stdout[INSTALLED] = true;

  return () => {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    stdout[INSTALLED] = false;
    fs.closeSync(logFd);
  };
}
