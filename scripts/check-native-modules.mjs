// Deploy preflight. Run with: node scripts/check-native-modules.mjs
// Plain Node, not tsx: a native-addon mismatch must not depend on esbuild.
// Never print secrets or the process environment.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function moduleRequire() {
  const root = process.env.NATIVE_MODULE_ROOT;
  if (typeof root === "string" && root.length > 0) return createRequire(join(root, "package.json"));
  return require;
}

function errorText(err) {
  if (err instanceof Error) {
    const code = "code" in err && typeof err.code === "string" ? `${err.code}: ` : "";
    return `${code}${err.message}`;
  }
  return "native module load failed";
}

function isOkRow(value) {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === 1;
}

export function probeBetterSqlite3(requireImpl) {
  const loaded = requireImpl("better-sqlite3");
  if (typeof loaded !== "function") {
    throw new Error("better-sqlite3 did not export a constructor");
  }
  const db = new loaded(":memory:");
  try {
    db.exec("CREATE TABLE preflight (ok INTEGER)");
    db.prepare("INSERT INTO preflight (ok) VALUES (1)").run();
    const row = db.prepare("SELECT ok FROM preflight").get();
    if (!isOkRow(row)) {
      throw new Error("better-sqlite3 in-memory query failed");
    }
  } finally {
    db.close();
  }
}

export function probeSharp(requireImpl) {
  try {
    requireImpl.resolve("sharp");
  } catch {
    return "skipped";
  }
  requireImpl("sharp");
  return "ok";
}

export function runPreflight(requireImpl) {
  probeBetterSqlite3(requireImpl);
  try {
    return { sharp: probeSharp(requireImpl) };
  } catch (err) {
    console.error(`warning: sharp preflight failed: ${errorText(err)}`);
    return { sharp: "failed" };
  }
}

export function runCli(requireImpl) {
  try {
    const result = runPreflight(requireImpl);
    console.log(`native preflight ok node=${process.versions.node} abi=${process.versions.modules} sharp=${result.sharp}`);
    return 0;
  } catch (err) {
    console.error(`Refusing to restart: better-sqlite3 preflight failed (node=${process.versions.node} abi=${process.versions.modules}).`);
    console.error(errorText(err));
    return 1;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function majorOf(version) {
  if (typeof version !== "string") return "";
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? match[1] : "";
}

function sameExecutable(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return left === right;
  }
}

export function extractPm2ProcessList(raw) {
  let from = 0;
  while (from < raw.length) {
    const start = raw.indexOf("[", from);
    if (start < 0) return null;
    const end = raw.lastIndexOf("]");
    if (end <= start) return null;
    try {
      const value = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(value)) return value;
    } catch {
      // Banner text can contain brackets.
    }
    from = start + 1;
  }
  return null;
}

export function assessPm2Node(input) {
  const ourMajor = majorOf(input.nodeVersion);
  if (!ourMajor) return { ok: false, message: "Refusing to restart: could not read this Node version." };
  if (!Array.isArray(input.procs)) {
    return { ok: false, message: "Refusing to restart: could not read the PM2 process list." };
  }
  let sawVersion = false;
  for (const proc of input.procs) {
    if (!isRecord(proc) || !isRecord(proc.pm2_env)) continue;
    const interpreter = typeof proc.pm2_env.exec_interpreter === "string" ? proc.pm2_env.exec_interpreter : "";
    const theirMajor = majorOf(typeof proc.pm2_env.node_version === "string" ? proc.pm2_env.node_version : "");
    const nodeProcess = theirMajor !== "" || interpreter === "node" || interpreter.endsWith("/node");
    if (!nodeProcess) continue;
    if (theirMajor) {
      sawVersion = true;
      if (theirMajor !== ourMajor) {
        return {
          ok: false,
          message: `Refusing to restart: PM2 node major ${theirMajor} does not match this node major ${ourMajor}.`,
        };
      }
    }
    if (interpreter.startsWith("/") && !sameExecutable(interpreter, input.execPath)) {
      return { ok: false, message: "Refusing to restart: PM2 exec_interpreter does not match this node." };
    }
  }
  if (!sawVersion) return { ok: false, message: "Refusing to restart: PM2 process list has no node version." };
  return { ok: true, message: "PM2 node matches" };
}

function pm2NodeCli() {
  const pm2 = spawnSync("pm2", ["jlist"], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const procs = pm2.status === 0 && typeof pm2.stdout === "string" ? extractPm2ProcessList(pm2.stdout) : null;
  const result = assessPm2Node({ execPath: process.execPath, nodeVersion: process.versions.node, procs });
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  console.log(result.message);
  return 0;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(process.argv.includes("--pm2-node") ? pm2NodeCli() : runCli(moduleRequire()));
}
