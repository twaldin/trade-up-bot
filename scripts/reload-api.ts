// Zero-downtime API reload.
//
// Steady state: the process is already cluster_mode with wait_ready and
// listen_timeout >= PM2_LISTEN_TIMEOUT_MS. `pm2 reload api` starts the new
// worker, waits for process.send("ready") (sent after the calculator warm),
// and only then stops the old worker. The old worker keeps port 3001.
//
// First cutover: fork mode, or cluster with a short listen_timeout, cannot
// change exec_mode in place. `pm2 reload` would stop the listener before the
// new process is warm (the 502 at 12:39:24.7). A single nginx upstream also
// cannot retry a refused connection. This script starts api-standby on 3002,
// patches nginx to fail over a refused connection, then replaces api from
// ecosystem.config.cjs. The next deploy takes the reload path.
//
// `pm2 delete` sends SIGINT. Prod code that has not picked up the SIGINT
// drain would die immediately, so the handoff always waits PROCESS_DRAIN_MS
// after SIGTERM before delete. A standby that never takes over is deleted,
// and the existing api keeps serving.
//
// Run with: npx --no-install tsx scripts/reload-api.ts
// Never print environment values.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PM2_KILL_TIMEOUT_MS, PM2_LISTEN_TIMEOUT_MS, PROCESS_DRAIN_MS } from "../server/boot-ready.js";
import { extractPm2ProcessList } from "./check-production-session-secret.js";

export const API_NAME = "api";
export const STANDBY_NAME = "api-standby";
export const API_PORT = 3001;
export const STANDBY_PORT = 3002;

const STRIP_ENV = new Set([
  "NODE_APP_INSTANCE",
  "NODE_CHANNEL_FD",
  "NODE_UNIQUE_ID",
  "pm_id",
  "status",
  "unique_id",
  "PM2_JSON_PROCESSING",
  "PM2_CLI",
]);

export interface ApiProcessView {
  execMode: string | null;
  waitReady: boolean;
  listenTimeout: number;
}

export function chooseReload(proc: ApiProcessView | null): "reload" | "handoff" {
  if (!proc) return "handoff";
  if (proc.execMode !== "cluster_mode") return "handoff";
  if (!proc.waitReady) return "handoff";
  if (proc.listenTimeout < PM2_LISTEN_TIMEOUT_MS) return "handoff";
  return "reload";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readApiProcess(procs: readonly unknown[]): ApiProcessView | null {
  for (const proc of procs) {
    if (!isRecord(proc) || proc.name !== API_NAME) continue;
    const env = isRecord(proc.pm2_env) ? proc.pm2_env : {};
    const execMode = typeof env.exec_mode === "string" ? env.exec_mode : null;
    const waitReady = env.wait_ready === true;
    const listenTimeout = typeof env.listen_timeout === "number" ? env.listen_timeout : 0;
    return { execMode, waitReady, listenTimeout };
  }
  return null;
}

function apiPm2Env(procs: readonly unknown[]): unknown {
  for (const proc of procs) {
    if (isRecord(proc) && proc.name === API_NAME) return proc.pm2_env;
  }
  return null;
}

/** Copy the app environment pm2 stored. Strip cluster bookkeeping keys. */
export function inheritedAppEnv(pm2Env: unknown): Record<string, string> {
  if (!isRecord(pm2Env) || !isRecord(pm2Env.env)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(pm2Env.env)) {
    if (typeof value !== "string") continue;
    if (STRIP_ENV.has(key) || key.startsWith("axm_")) continue;
    out[key] = value;
  }
  return out;
}

/** Operator log. Fields only — never the process environment. */
export function describeApi(proc: ApiProcessView | null): string {
  if (!proc) return "api process: missing";
  const mode = proc.execMode ?? "unknown";
  return `api process: exec_mode=${mode} wait_ready=${proc.waitReady} listen_timeout=${proc.listenTimeout}`;
}

export function apiReloadArgs(): string[] {
  return ["reload", API_NAME];
}

export function apiStartArgs(): string[] {
  return ["start", "ecosystem.config.cjs", "--only", API_NAME];
}

export function standbyStartArgs(): string[] {
  return [
    "start",
    "server/index.ts",
    "--name", STANDBY_NAME,
    "--interpreter", "node",
    "--node-args", "--import tsx",
    "-i", "1",
    "--wait-ready",
    "--listen-timeout", String(PM2_LISTEN_TIMEOUT_MS),
    "--kill-timeout", String(PM2_KILL_TIMEOUT_MS),
  ];
}

export interface ReloadIo {
  log: (line: string) => void;
  readPm2Json: () => string;
  reloadApi: () => void | Promise<void>;
  patchNginx: () => void | Promise<void>;
  startStandby: (env: Record<string, string>) => void | Promise<void>;
  waitHealthy: (port: number) => Promise<void>;
  stopApi: () => void | Promise<void>;
  waitDrain: () => void | Promise<void>;
  deleteApi: () => void | Promise<void>;
  startApi: (env: Record<string, string>) => void | Promise<void>;
  stopStandby: () => void | Promise<void>;
  deleteStandby: () => void | Promise<void>;
  save: () => void | Promise<void>;
}

/** Full drain window. Do not return when the port stops answering. */
export async function waitForProcessDrain(
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  await sleep(PROCESS_DRAIN_MS);
}

export async function runReload(io: ReloadIo): Promise<"reload" | "handoff"> {
  const raw = io.readPm2Json();
  const procs = extractPm2ProcessList(raw) ?? [];
  const view = readApiProcess(procs);
  io.log(describeApi(view));
  const base = inheritedAppEnv(apiPm2Env(procs));
  if (chooseReload(view) === "reload") {
    io.log("api reload via reload");
    await io.reloadApi();
    return "reload";
  }

  io.log("api reload via handoff");
  let standbyStarted = false;
  let apiStopped = false;
  try {
    await io.patchNginx();
    standbyStarted = true;
    await io.startStandby({ ...base, PORT: String(STANDBY_PORT) });
    await io.waitHealthy(STANDBY_PORT);
    await io.stopApi();
    apiStopped = true;
    await io.waitDrain();
    await io.deleteApi();
    try {
      await io.startApi({ ...base, PORT: String(API_PORT) });
      await io.waitHealthy(API_PORT);
    } catch (err) {
      io.log("api start failed; leaving api-standby listening on 3002");
      throw err;
    }
    await io.stopStandby();
    await io.waitDrain();
    await io.deleteStandby();
    await io.save();
    return "handoff";
  } finally {
    if (standbyStarted && !apiStopped) {
      io.log("deleting api-standby; leaving api serving");
      try {
        await io.deleteStandby();
      } catch (cleanupErr) {
        const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        io.log(`api-standby cleanup failed: ${message}`);
      }
    }
  }
}

interface HttpResponse {
  ok: boolean;
  status: number;
}

export async function waitForHttpOk(
  port: number,
  opts?: {
    budgetMs?: number;
    sleep?: (ms: number) => Promise<void>;
    fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<HttpResponse>;
  },
): Promise<void> {
  const budgetMs = opts?.budgetMs ?? PM2_LISTEN_TIMEOUT_MS;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = opts?.fetchImpl ?? ((url, init) => fetch(url, init));
  const deadline = Date.now() + budgetMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/robots.txt`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }
  throw new Error(`port ${port} did not return HTTP 200: ${lastError}`);
}

function spawnEnv(app: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...app };
  for (const key of STRIP_ENV) delete env[key];
  for (const key of Object.keys(env)) {
    if (key.startsWith("axm_")) delete env[key];
  }
  return env;
}

function pm2(args: string[], env?: NodeJS.ProcessEnv, timeout = 20_000): void {
  const result = spawnSync("pm2", args, {
    timeout,
    env: env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`pm2 ${args[0] ?? ""} failed`);
  }
}

function pm2IgnoreFailure(args: string[]): void {
  spawnSync("pm2", args, { timeout: 15_000, stdio: "inherit" });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const listed = spawnSync("pm2", ["jlist"], { encoding: "utf8", timeout: 15_000 });
  if (listed.status !== 0 || typeof listed.stdout !== "string") {
    console.error("could not read pm2 jlist");
    process.exit(1);
  }
  const raw = listed.stdout;
  const startTimeout = PM2_LISTEN_TIMEOUT_MS + 20_000;
  try {
    const mode = await runReload({
      log: (line) => console.log(line),
      readPm2Json: () => raw,
      reloadApi: () => pm2(apiReloadArgs(), undefined, startTimeout),
      patchNginx: () => {
        const result = spawnSync("python3", ["scripts/patch-nginx-upstream-retry.py", "--apply"], {
          stdio: "inherit",
        });
        if ((result.status ?? 1) !== 0) throw new Error("nginx upstream patch failed");
      },
      startStandby: (env) => pm2(standbyStartArgs(), spawnEnv(env), startTimeout),
      waitHealthy: (port) => waitForHttpOk(port),
      stopApi: () => {
        pm2IgnoreFailure(["sendSignal", "SIGTERM", API_NAME]);
      },
      waitDrain: () => waitForProcessDrain(),
      deleteApi: () => pm2IgnoreFailure(["delete", API_NAME]),
      startApi: (env) => pm2(apiStartArgs(), spawnEnv(env), startTimeout),
      stopStandby: () => {
        pm2IgnoreFailure(["sendSignal", "SIGTERM", STANDBY_NAME]);
      },
      deleteStandby: () => pm2IgnoreFailure(["delete", STANDBY_NAME]),
      save: () => pm2(["save"]),
    });
    console.log(`api reload finished via ${mode}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

if (isDirectRun()) {
  void main();
}
