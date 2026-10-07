// Deploy preflight. Run with: npx --no-install tsx scripts/check-production-session-secret.ts
// Never print secret values.
// pm2's SESSION_SECRET wins when it is non-empty, matching server/index.ts.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEV_SESSION_SECRET,
  MIN_PRODUCTION_SESSION_SECRET_LENGTH,
  productionSessionSecretRefusal,
} from "../server/session-secret.js";

export { DEV_SESSION_SECRET, MIN_PRODUCTION_SESSION_SECRET_LENGTH, productionSessionSecretRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** First assignment, matching the server/index.ts .env loader. Quotes stay. */
export function readDotenvValue(text: string, key: string): string {
  for (const line of text.split("\n")) {
    const match = line.replace(/\r$/, "").match(/^(\w+)=(.*)$/);
    if (match && match[1] === key) return match[2].trim();
  }
  return "";
}

export function extractPm2ProcessList(raw: string): unknown[] | null {
  let from = 0;
  while (from < raw.length) {
    const start = raw.indexOf("[", from);
    if (start < 0) return null;
    const end = raw.lastIndexOf("]");
    if (end <= start) return null;
    try {
      const value: unknown = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(value)) return value;
    } catch {
      // Banner text can contain brackets. Try the next one.
    }
    from = start + 1;
  }
  return null;
}

function readPm2Secret(pm2Env: unknown): string {
  if (!isRecord(pm2Env)) return "";
  const top = pm2Env.SESSION_SECRET;
  if (typeof top === "string" && top.trim()) return top;
  if (!isRecord(pm2Env.env)) return "";
  const nested = pm2Env.env.SESSION_SECRET;
  return typeof nested === "string" ? nested : "";
}

/** Non-empty api secrets, or null when no api process is in the list. */
export function apiPm2SessionSecrets(procs: readonly unknown[]): string[] | null {
  const apis = procs.filter((proc) => isRecord(proc) && proc.name === "api");
  if (apis.length === 0) return null;
  const values: string[] = [];
  for (const proc of apis) {
    if (!isRecord(proc)) continue;
    const value = readPm2Secret(proc.pm2_env).trim();
    if (value) values.push(value);
  }
  return values;
}

export function preflightFromSources(input: {
  pm2Ok: boolean;
  pm2Raw: string;
  envText: string;
}): { ok: boolean; message: string } {
  if (!input.pm2Ok) {
    return { ok: false, message: "Refusing to reload: could not read the api process environment from pm2." };
  }
  const procs = extractPm2ProcessList(input.pm2Raw);
  if (!procs) {
    return { ok: false, message: "Refusing to reload: pm2 jlist did not include a process list." };
  }
  const pm2Secrets = apiPm2SessionSecrets(procs);
  const fileSecret = readDotenvValue(input.envText, "SESSION_SECRET");
  const candidates = pm2Secrets && pm2Secrets.length > 0 ? pm2Secrets : [fileSecret];
  for (const candidate of candidates) {
    const refusal = productionSessionSecretRefusal(candidate);
    if (refusal) return { ok: false, message: refusal };
  }
  return { ok: true, message: "SESSION_SECRET preflight ok" };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function main(): void {
  const envFile = process.env.SESSION_SECRET_ENV_FILE ?? join(process.cwd(), ".env");
  const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const pm2 = spawnSync("pm2", ["jlist"], { encoding: "utf8", timeout: 15_000 });
  const result = preflightFromSources({
    pm2Ok: pm2.status === 0 && typeof pm2.stdout === "string",
    pm2Raw: pm2.stdout ?? "",
    envText,
  });
  if (!result.ok) {
    console.error(result.message);
    console.error("Refusing to reload. Set SESSION_SECRET in the api pm2 environment or the repo .env file.");
    process.exit(1);
  }
  console.log(result.message);
}

if (isDirectRun()) main();
