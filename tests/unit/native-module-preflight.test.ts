import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/check-native-modules.mjs");

type ModuleLoader = {
  (id: string): unknown;
  resolve(id: string): string;
};

type Pm2NodeInput = { execPath: string; nodeVersion: string; procs: unknown[] | null };
type ProbeModule = {
  probeBetterSqlite3: (requireImpl: ModuleLoader) => void;
  probeSharp: (requireImpl: ModuleLoader) => "ok" | "skipped";
  runPreflight: (requireImpl: ModuleLoader) => { sharp: "ok" | "skipped" | "failed" };
  runCli: (requireImpl: ModuleLoader) => number;
  assessPm2Node: (input: Pm2NodeInput) => { ok: boolean; message: string };
  extractPm2ProcessList: (raw: string) => unknown[] | null;
};

function isProbeModule(value: unknown): value is ProbeModule {
  return typeof value === "object"
    && value !== null
    && "probeBetterSqlite3" in value
    && "probeSharp" in value
    && "runPreflight" in value
    && "runCli" in value
    && "assessPm2Node" in value
    && "extractPm2ProcessList" in value
    && typeof value.probeBetterSqlite3 === "function"
    && typeof value.probeSharp === "function"
    && typeof value.runPreflight === "function"
    && typeof value.runCli === "function"
    && typeof value.assessPm2Node === "function"
    && typeof value.extractPm2ProcessList === "function";
}

async function loadProbe(): Promise<ProbeModule> {
  const loaded: unknown = await import(pathToFileURL(script).href);
  if (!isProbeModule(loaded)) throw new Error("check-native-modules.mjs did not export the preflight");
  return loaded;
}

function sqliteLoader(): ModuleLoader {
  class MemoryDb {
    exec(): void {}
    prepare(): { run: () => void; get: () => { ok: number } } {
      return { run: () => undefined, get: () => ({ ok: 1 }) };
    }
    close(): void {}
  }
  return Object.assign(
    (id: string) => {
      if (id !== "better-sqlite3") throw new Error(`unexpected ${id}`);
      return MemoryDb;
    },
    { resolve: (id: string) => id },
  );
}

function dlopenFailure(): ModuleLoader {
  const fail = () => {
    throw Object.assign(new Error("compiled against a different Node.js version using NODE_MODULE_VERSION 115"), {
      code: "ERR_DLOPEN_FAILED",
    });
  };
  return Object.assign(fail, { resolve: fail });
}

describe("native module preflight", () => {
  it("opens an in-memory better-sqlite3 database on this Node", () => {
    const secret = "super-secret-value-that-must-not-leak";
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, SESSION_SECRET: secret, STRIPE_SECRET_KEY: "sk_live_FAKE" },
    });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("native preflight ok");
    expect(result.stdout).toContain(`node=${process.versions.node}`);
    expect(result.stdout).toContain(`abi=${process.versions.modules}`);
    expect(result.stdout).toContain("sharp=ok");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("sk_live_FAKE");
    expect(text).not.toContain("SESSION_SECRET");
    expect(text).not.toContain("STRIPE_SECRET_KEY");
  });

  it("fails closed when better-sqlite3 cannot load", async () => {
    const probe = await loadProbe();
    const secret = "super-secret-value-that-must-not-leak";
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = secret;
    const logs: string[] = [];
    const errors: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (message?: unknown) => { logs.push(String(message)); };
    console.error = (message?: unknown) => { errors.push(String(message)); };
    let code = 0;
    try {
      let caught: unknown;
      try {
        probe.probeBetterSqlite3(dlopenFailure());
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught instanceof Error && "code" in caught && caught.code).toBe("ERR_DLOPEN_FAILED");
      expect(() => probe.runPreflight(dlopenFailure())).toThrow(/NODE_MODULE_VERSION 115/);
      code = probe.runCli(dlopenFailure());
    } finally {
      console.log = origLog;
      console.error = origErr;
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
    const text = [...logs, ...errors].join("\n");
    expect(code).toBe(1);
    expect(text).toContain("Refusing to restart");
    expect(text).toContain(`abi=${process.versions.modules}`);
    expect(text).toContain("ERR_DLOPEN_FAILED");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("pm2");
  });

  it("treats a missing sharp as optional and a broken sharp as a warning", async () => {
    const probe = await loadProbe();
    const missing: ModuleLoader = Object.assign(
      () => sqliteLoader()("better-sqlite3"),
      {
        resolve: (id: string) => {
          if (id === "sharp") {
            throw Object.assign(new Error("Cannot find module 'sharp'"), { code: "MODULE_NOT_FOUND" });
          }
          return id;
        },
      },
    );
    expect(probe.probeSharp(missing)).toBe("skipped");
    expect(probe.runPreflight(missing).sharp).toBe("skipped");

    const broken: ModuleLoader = Object.assign(
      (id: string) => {
        if (id === "sharp") {
          throw Object.assign(new Error("sharp NODE_MODULE_VERSION mismatch"), { code: "ERR_DLOPEN_FAILED" });
        }
        return sqliteLoader()("better-sqlite3");
      },
      { resolve: (id: string) => id },
    );
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (message?: unknown) => { errors.push(String(message)); };
    let result: { sharp: string };
    try {
      result = probe.runPreflight(broken);
    } finally {
      console.error = origErr;
    }
    expect(result.sharp).toBe("failed");
    expect(errors.join("\n")).toContain("warning: sharp preflight failed");
    expect(probe.runCli(missing)).toBe(0);
  });

  it("rejects a PM2 major or interpreter mismatch without echoing the process list", async () => {
    const probe = await loadProbe();
    const secret = "super-secret-value-that-must-not-leak";
    const raw = `>>>> secret-pass sk_live_FAKE ${secret}\n[{"name":"api","pm2_env":{"node_version":"20.20.2","exec_interpreter":"node","SESSION_SECRET":"${secret}","DATABASE_URL":"postgresql://user:secret-pass@db/prod"}}]`;
    const procs = probe.extractPm2ProcessList(raw);
    const mismatch = probe.assessPm2Node({ execPath: process.execPath, nodeVersion: "24.22.1", procs });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.message).toContain("PM2 node major 20 does not match this node major 24");
    expect(mismatch.message).not.toContain(secret);
    expect(mismatch.message).not.toContain("secret-pass");
    expect(mismatch.message).not.toContain("sk_live_FAKE");
    expect(mismatch.message).not.toContain("SESSION_SECRET");

    const wrongBinary = probe.assessPm2Node({
      execPath: process.execPath,
      nodeVersion: process.versions.node,
      procs: [{ name: "api", pm2_env: { node_version: process.versions.node, exec_interpreter: "/no/such/pm2-node", SESSION_SECRET: secret } }],
    });
    expect(wrongBinary.ok).toBe(false);
    expect(wrongBinary.message).toBe("Refusing to restart: PM2 exec_interpreter does not match this node.");
    expect(wrongBinary.message).not.toContain(secret);

    const match = probe.assessPm2Node({
      execPath: process.execPath,
      nodeVersion: process.versions.node,
      procs: [{ name: "api", pm2_env: { node_version: process.versions.node, exec_interpreter: process.execPath, SESSION_SECRET: secret } }],
    });
    expect(match).toEqual({ ok: true, message: "PM2 node matches" });

    const namedInterpreter = probe.assessPm2Node({
      execPath: process.execPath,
      nodeVersion: process.versions.node,
      procs: [{ name: "daemon", pm2_env: { node_version: `v${process.versions.node}`, exec_interpreter: "node", DATABASE_URL: "postgresql://user:secret-pass@db/prod" } }],
    });
    expect(namedInterpreter.ok).toBe(true);
    expect(namedInterpreter.message).not.toContain("secret-pass");

    const withPython = probe.assessPm2Node({
      execPath: process.execPath,
      nodeVersion: process.versions.node,
      procs: [
        { name: "api", pm2_env: { node_version: process.versions.node, exec_interpreter: "node" } },
        { name: "pm2-logrotate", pm2_env: { exec_interpreter: "/usr/bin/python3" } },
      ],
    });
    expect(withPython.ok).toBe(true);
  });

  it("runs the PM2 node check without printing jlist", () => {
    const secret = "super-secret-value-that-must-not-leak";
    const dir = mkdtempSync(join(tmpdir(), "pm2-node-"));
    const pm2 = join(dir, "pm2");
    writeFileSync(pm2, `#!/bin/bash
echo 'stderr ${secret} sk_live_FAKE' >&2
echo 'banner secret-pass ${secret}'
echo '[{"name":"api","pm2_env":{"node_version":"20.20.2","exec_interpreter":"node","SESSION_SECRET":"${secret}"}}]'
`);
    chmodSync(pm2, 0o755);
    const refused = spawnSync(process.execPath, [script, "--pm2-node"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
    const refusedText = `${refused.stdout ?? ""}\n${refused.stderr ?? ""}`;
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`PM2 node major 20 does not match this node major ${process.versions.node.split(".")[0]}`);
    expect(refusedText).not.toContain(secret);
    expect(refusedText).not.toContain("secret-pass");
    expect(refusedText).not.toContain("sk_live_FAKE");
    expect(refusedText).not.toContain("SESSION_SECRET");

    writeFileSync(pm2, `#!/bin/bash
echo '[{"name":"api","pm2_env":{"node_version":"${process.versions.node}","exec_interpreter":"${process.execPath}","SESSION_SECRET":"${secret}"}}]'
`);
    const matched = spawnSync(process.execPath, [script, "--pm2-node"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
    const matchedText = `${matched.stdout ?? ""}\n${matched.stderr ?? ""}`;
    expect(matched.status).toBe(0);
    expect(matched.stdout.trim()).toBe("PM2 node matches");
    expect(matchedText).not.toContain(secret);
    rmSync(dir, { recursive: true, force: true });
  });
});
