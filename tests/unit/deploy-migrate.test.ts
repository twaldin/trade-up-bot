import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

function stepBody(name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("      - name:"));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function migrateShell(): string {
  const body = stepBody("Migrate with fetcher stopped");
  const script = body.split("\n").slice(2).map((line) => line.slice(10)).join("\n");
  const eof = script.lastIndexOf("\nEOF");
  return script.slice(script.indexOf("\n") + 1, eof);
}

function writeBin(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

type StepOpts = {
  npxExit?: number;
  startExit?: number;
  nativeRc?: number;
  rebuildRc?: number;
  sharpRc?: number;
  nodeAbi?: string;
  abiMarker?: string | null;
  depsMatch?: boolean;
  withSharp?: boolean;
};

function runStep(opts: StepOpts = {}): { status: number | null; log: string; stderr: string; marker: string } {
  const dir = mkdtempSync(join(tmpdir(), "deploy-migrate-"));
  const log = join(dir, "log");
  const nodeAbi = opts.nodeAbi ?? "137";
  const files = ["package.json", "package-lock.json"];
  const hashes = files.map((file) => {
    const content = "{}\n";
    writeFileSync(join(dir, file), content);
    return `${createHash("sha256").update(content).digest("hex")}  ${file}\n`;
  }).join("");
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "node_modules"));
  copyFileSync(join(root, "scripts/ensure-native-modules.sh"), join(dir, "scripts/ensure-native-modules.sh"));
  if (opts.withSharp) mkdirSync(join(dir, "node_modules/sharp"));
  if (opts.depsMatch !== false) {
    writeFileSync(join(dir, "node_modules/.tradeup-deps.sha256"), createHash("sha256").update(hashes).digest("hex"));
  } else {
    writeFileSync(join(dir, "node_modules/.tradeup-deps.sha256"), "stale\n");
  }
  if (opts.abiMarker !== null) {
    writeFileSync(join(dir, "node_modules/.tradeup-node-abi"), `${opts.abiMarker ?? nodeAbi}\n`);
  }
  writeBin(dir, "git", "#!/bin/bash\necho \"git $*\" >> \"$LOG\"\nexit 0\n");
  writeBin(dir, "pm2", `#!/bin/bash
echo "pm2 $*" >> "$LOG"
if [ "$1" = "start" ]; then exit ${opts.startExit ?? 0}; fi
exit 0
`);
  writeBin(dir, "npx", `#!/bin/bash
echo "npx $*" >> "$LOG"
exit ${opts.npxExit ?? 0}
`);
  writeBin(dir, "node", `#!/bin/bash
echo "node $*" >> "$LOG"
if [ "$1" = "-p" ]; then
  printf '%s\\n' "${nodeAbi}"
  exit 0
fi
case "$*" in
  *check-native-modules.mjs*) exit ${opts.nativeRc ?? 0} ;;
esac
echo "unexpected node $*" >&2
exit 1
`);
  writeBin(dir, "npm", `#!/bin/bash
echo "npm $*" >> "$LOG"
if [ "$1" = "ci" ]; then
  rm -f node_modules/.tradeup-node-abi
  exit 0
fi
if [ "$1" = "rebuild" ] && [[ "$*" == *better-sqlite3* ]]; then
  exit ${opts.rebuildRc ?? 0}
fi
if [ "$1" = "rebuild" ] && [[ "$*" == *sharp* ]]; then
  exit ${opts.sharpRc ?? 0}
fi
exit 0
`);
  try {
    const result = spawnSync("bash", ["-c", migrateShell()], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, LOG: log, TRADEUP_ROOT: dir },
      encoding: "utf8",
    });
    const markerPath = join(dir, "node_modules/.tradeup-node-abi");
    return {
      status: result.status,
      log: readFileSync(log, "utf8"),
      stderr: result.stderr ?? "",
      marker: existsSync(markerPath) ? readFileSync(markerPath, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("deploy migration step", () => {
  const shell = migrateShell();

  it("proves native modules before any PM2 command on the lockfile-matched path", () => {
    const ensure = shell.indexOf("bash scripts/ensure-native-modules.sh");
    const second = shell.indexOf("bash scripts/ensure-native-modules.sh", ensure + 1);
    const fetcherStop = shell.indexOf("pm2 stop fetcher");
    expect(ensure).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(ensure);
    expect(fetcherStop).toBeGreaterThan(second);
    expect(shell.indexOf('pm2 stop "$app"')).toBeLessThan(shell.indexOf("npm ci --include=dev"));
    expect(shell.indexOf("npm ci --include=dev")).toBeLessThan(ensure);
    expect(ensure).toBeLessThan(shell.indexOf("npx --no-install tsx scripts/migrate.ts"));
    expect(shell).toContain('if [ "$skip_pm2_start" -eq 1 ]; then exit "$deploy_rc"; fi');
  });

  it("reloads api only after the native preflight and the session-secret preflight", () => {
    const body = stepBody("Native module + session secret preflight + pm2 reload api");
    const command = body.split("\n").find((line) => line.includes("ssh ")) ?? "";
    const native = command.indexOf("bash scripts/ensure-native-modules.sh");
    const session = command.indexOf("scripts/check-production-session-secret.ts");
    const reload = command.indexOf("pm2 reload api");
    expect(native).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(native);
    expect(reload).toBeGreaterThan(session);
  });

  it("starts the fetcher and fails the step when the migration fails", () => {
    const result = runStep({ npxExit: 7 });
    expect(result.status).toBe(7);
    expect(result.log).toContain("pm2 stop fetcher");
    expect(result.log).toContain("npx --no-install tsx scripts/migrate.ts");
    expect(result.log).toContain("pm2 start fetcher");
    const check = result.log.indexOf("node scripts/check-native-modules.mjs");
    const stop = result.log.indexOf("pm2 stop fetcher");
    const ran = result.log.indexOf("npx --no-install tsx scripts/migrate.ts");
    const start = result.log.indexOf("pm2 start fetcher");
    expect(check).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(check);
    expect(ran).toBeGreaterThan(stop);
    expect(start).toBeGreaterThan(ran);
    expect(result.log).not.toContain("npm rebuild");
  });

  it("starts the fetcher when the migration succeeds", () => {
    const result = runStep({ npxExit: 0 });
    expect(result.status).toBe(0);
    expect(result.log).toContain("pm2 start fetcher");
    expect(result.log.indexOf("node scripts/check-native-modules.mjs")).toBeLessThan(result.log.indexOf("pm2 stop fetcher"));
    expect(result.log).not.toContain("npm rebuild");
  });

  it("rebuilds better-sqlite3 for a new Node ABI before stopping PM2", () => {
    const result = runStep({ abiMarker: "115", nodeAbi: "137", withSharp: true });
    expect(result.status).toBe(0);
    const rebuild = result.log.indexOf("npm rebuild better-sqlite3");
    const sharp = result.log.indexOf("npm rebuild sharp");
    const check = result.log.indexOf("node scripts/check-native-modules.mjs");
    const stop = result.log.indexOf("pm2 stop fetcher");
    expect(rebuild).toBeGreaterThanOrEqual(0);
    expect(sharp).toBeGreaterThan(rebuild);
    expect(check).toBeGreaterThan(sharp);
    expect(stop).toBeGreaterThan(check);
    expect(result.log.indexOf("npm rebuild better-sqlite3", rebuild + 1)).toBe(-1);
    expect(result.marker).toBe("137\n");
  });

  it("continues when the optional sharp rebuild fails", () => {
    const result = runStep({ abiMarker: "115", nodeAbi: "137", withSharp: true, sharpRc: 1 });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("warning: sharp rebuild failed");
    expect(result.log).toContain("pm2 start fetcher");
    expect(result.marker).toBe("137\n");
  });

  it("does not restart PM2 when the native probe fails", () => {
    const result = runStep({ nativeRc: 1 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("native preflight failed; not restarting PM2");
    expect(result.log).toContain("npm rebuild better-sqlite3");
    expect(result.log).not.toMatch(/\bpm2\b/);
    expect(result.log).not.toContain("npx ");
  });

  it("does not restart PM2 when the rebuild fails", () => {
    const result = runStep({ abiMarker: "115", nodeAbi: "137", rebuildRc: 1 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("native preflight failed; not restarting PM2");
    expect(result.log).toContain("npm rebuild better-sqlite3");
    expect(result.log).not.toContain("check-native-modules");
    expect(result.log).not.toMatch(/\bpm2\b/);
    expect(result.marker).toBe("115\n");
  });

  it("writes the ABI marker without rebuilding when the addon already loads", () => {
    const result = runStep({ abiMarker: null });
    expect(result.status).toBe(0);
    expect(result.log).not.toContain("npm rebuild");
    expect(result.log.indexOf("node scripts/check-native-modules.mjs")).toBeLessThan(result.log.indexOf("pm2 stop fetcher"));
    expect(result.marker).toBe("137\n");
  });

  it("probes after npm ci and skips the start trap when the probe fails", () => {
    const result = runStep({ depsMatch: false, nativeRc: 1 });
    expect(result.status).toBe(1);
    const stop = result.log.indexOf("pm2 stop api");
    const ci = result.log.indexOf("npm ci --include=dev");
    const rebuild = result.log.indexOf("npm rebuild better-sqlite3");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(ci).toBeGreaterThan(stop);
    expect(rebuild).toBeGreaterThan(ci);
    expect(result.log).not.toContain("pm2 start");
    expect(result.log).not.toContain("npx ");
    expect(result.stderr).toContain("native preflight failed; not restarting PM2");
  });

  it("starts the apps after npm ci when the native probe passes", () => {
    const result = runStep({ depsMatch: false, npxExit: 0 });
    expect(result.status).toBe(0);
    const stop = result.log.indexOf("pm2 stop api");
    const ci = result.log.indexOf("npm ci --include=dev");
    const check = result.log.indexOf("node scripts/check-native-modules.mjs");
    const migrate = result.log.indexOf("npx --no-install tsx scripts/migrate.ts");
    const start = result.log.indexOf("pm2 start api");
    expect(stop).toBeLessThan(ci);
    expect(ci).toBeLessThan(check);
    expect(check).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(start);
    expect(result.log).not.toContain("npm rebuild");
    expect(result.marker).toBe("137\n");
  });
});
