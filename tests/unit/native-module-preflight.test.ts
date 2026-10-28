import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/check-native-modules.mjs");

type ModuleLoader = {
  (id: string): unknown;
  resolve(id: string): string;
};

type ProbeModule = {
  probeBetterSqlite3: (requireImpl: ModuleLoader) => void;
  probeSharp: (requireImpl: ModuleLoader) => "ok" | "skipped";
  runPreflight: (requireImpl: ModuleLoader) => { sharp: "ok" | "skipped" | "failed" };
  runCli: (requireImpl: ModuleLoader) => number;
};

function isProbeModule(value: unknown): value is ProbeModule {
  return typeof value === "object"
    && value !== null
    && "probeBetterSqlite3" in value
    && "probeSharp" in value
    && "runPreflight" in value
    && "runCli" in value
    && typeof value.probeBetterSqlite3 === "function"
    && typeof value.probeSharp === "function"
    && typeof value.runPreflight === "function"
    && typeof value.runCli === "function";
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
});
