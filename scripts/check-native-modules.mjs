// Deploy preflight. Run with: node scripts/check-native-modules.mjs
// Plain Node, not tsx: a native-addon mismatch must not depend on esbuild.
// Never print secrets or the process environment.

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

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
  process.exit(runCli(require));
}
