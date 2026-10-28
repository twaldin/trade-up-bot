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
  pm2NodeRc?: number;
  npmCiRc?: number;
  nodeAbi?: string;
  abiMarker?: string | null;
  depsMatch?: boolean;
  withSharp?: boolean;
};

function atLine(log: string, exact: string): number {
  return `\n${log}\n`.indexOf(`\n${exact}\n`);
}

function runStep(opts: StepOpts = {}): {
  status: number | null;
  log: string;
  stderr: string;
  marker: string;
  sentinel: string;
  fromStage: string;
} {
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
  writeFileSync(join(dir, "node_modules/.live-sentinel"), "live\n");
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
  *--pm2-node*) exit ${opts.pm2NodeRc ?? 0} ;;
  *check-native-modules.mjs*) exit ${opts.nativeRc ?? 0} ;;
esac
echo "unexpected node $*" >&2
exit 1
`);
  writeBin(dir, "npm", `#!/bin/bash
echo "npm $*" >> "$LOG"
if [ "$1" = "ci" ]; then
  if [ "${opts.npmCiRc ?? 0}" -ne 0 ]; then exit ${opts.npmCiRc ?? 0}; fi
  mkdir -p node_modules
  printf 'staged\\n' > node_modules/.from-stage
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
    const sentinelPath = join(dir, "node_modules/.live-sentinel");
    const stagedPath = join(dir, "node_modules/.from-stage");
    return {
      status: result.status,
      log: readFileSync(log, "utf8"),
      stderr: result.stderr ?? "",
      marker: existsSync(markerPath) ? readFileSync(markerPath, "utf8") : "",
      sentinel: existsSync(sentinelPath) ? readFileSync(sentinelPath, "utf8") : "",
      fromStage: existsSync(stagedPath) ? readFileSync(stagedPath, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("deploy migration step", () => {
  const shell = migrateShell();

  it("proves a staged install before stopping PM2 on a lockfile change", () => {
    const ensureScript = readFileSync(join(root, "scripts/ensure-native-modules.sh"), "utf8");
    const pm2Node = shell.indexOf("timeout 30 node scripts/check-native-modules.mjs --pm2-node");
    const ci = shell.indexOf("npm ci --include=dev");
    const probe = shell.indexOf('NATIVE_MODULE_ROOT="$stage" timeout 30 node scripts/check-native-modules.mjs');
    const stop = shell.indexOf('pm2 stop "$app"');
    expect(pm2Node).toBeGreaterThanOrEqual(0);
    expect(ci).toBeGreaterThan(pm2Node);
    expect(probe).toBeGreaterThan(ci);
    expect(stop).toBeGreaterThan(probe);
    expect(shell).toContain("node_modules.tradeup-prev");
    expect(shell).toContain('if [ "$swapped" -ne 1 ]');
    expect(shell).not.toContain("skip_pm2_start");
    expect(shell.indexOf("bash scripts/ensure-native-modules.sh")).toBeLessThan(shell.indexOf("pm2 stop fetcher"));
    expect(ensureScript).toContain("timeout 180 npm rebuild better-sqlite3");
    expect(ensureScript).toContain("timeout 180 npm rebuild sharp");
    expect(ensureScript).toContain("timeout 30 node scripts/check-native-modules.mjs");
    expect(ensureScript).toContain("timeout 30 node scripts/check-native-modules.mjs --pm2-node");
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
    const check = atLine(result.log, "node scripts/check-native-modules.mjs");
    const stop = atLine(result.log, "pm2 stop fetcher");
    const ran = atLine(result.log, "npx --no-install tsx scripts/migrate.ts");
    const start = atLine(result.log, "pm2 start fetcher");
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
    expect(atLine(result.log, "node scripts/check-native-modules.mjs --pm2-node")).toBeLessThan(atLine(result.log, "pm2 stop fetcher"));
    expect(atLine(result.log, "node scripts/check-native-modules.mjs")).toBeLessThan(atLine(result.log, "pm2 stop fetcher"));
    expect(result.log).not.toContain("npm rebuild");
  });

  it("rebuilds better-sqlite3 for a new Node ABI before stopping PM2", () => {
    const result = runStep({ abiMarker: "115", nodeAbi: "137", withSharp: true });
    expect(result.status).toBe(0);
    const rebuild = result.log.indexOf("npm rebuild better-sqlite3");
    const sharp = result.log.indexOf("npm rebuild sharp");
    const check = atLine(result.log, "node scripts/check-native-modules.mjs");
    const stop = atLine(result.log, "pm2 stop fetcher");
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
    expect(result.log).not.toMatch(/^pm2 /m);
    expect(result.log).not.toContain("npx ");
    expect(result.sentinel).toBe("live\n");
  });

  it("does not restart PM2 when the rebuild times out", () => {
    const result = runStep({ abiMarker: "115", nodeAbi: "137", rebuildRc: 124 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("native preflight failed; not restarting PM2");
    expect(result.log).toContain("npm rebuild better-sqlite3");
    expect(result.log).not.toMatch(/^pm2 /m);
    expect(result.sentinel).toBe("live\n");
    expect(result.marker).toBe("115\n");
  });

  it("writes the ABI marker without rebuilding when the addon already loads", () => {
    const result = runStep({ abiMarker: null });
    expect(result.status).toBe(0);
    expect(result.log).not.toContain("npm rebuild");
    expect(atLine(result.log, "node scripts/check-native-modules.mjs")).toBeLessThan(atLine(result.log, "pm2 stop fetcher"));
    expect(result.marker).toBe("137\n");
    expect(result.sentinel).toBe("live\n");
  });

  it("leaves the running apps and live node_modules in place when the staged probe fails", () => {
    const result = runStep({ depsMatch: false, nativeRc: 1 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("native preflight failed; leaving PM2 processes running");
    expect(atLine(result.log, "npm ci --include=dev")).toBeGreaterThan(atLine(result.log, "node scripts/check-native-modules.mjs --pm2-node"));
    expect(atLine(result.log, "node scripts/check-native-modules.mjs")).toBeGreaterThan(atLine(result.log, "npm ci --include=dev"));
    expect(result.log).not.toMatch(/^pm2 /m);
    expect(result.log).not.toContain("npx ");
    expect(result.log).not.toContain("npm rebuild");
    expect(result.sentinel).toBe("live\n");
    expect(result.fromStage).toBe("");
  });

  it("treats a staged probe timeout as a failed check and does not stop PM2", () => {
    const result = runStep({ depsMatch: false, nativeRc: 124 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("leaving PM2 processes running");
    expect(result.log).not.toMatch(/^pm2 /m);
    expect(result.sentinel).toBe("live\n");
  });

  it("does not install or stop PM2 when the PM2 node major does not match", () => {
    const result = runStep({ depsMatch: false, pm2NodeRc: 1 });
    expect(result.status).toBe(1);
    expect(result.log).toContain("node scripts/check-native-modules.mjs --pm2-node");
    expect(result.log).not.toContain("npm ci");
    expect(result.log).not.toMatch(/^pm2 /m);
    expect(result.sentinel).toBe("live\n");
  });

  it("stops PM2 only after the staged install and probe succeed", () => {
    const result = runStep({ depsMatch: false, npxExit: 0 });
    expect(result.status).toBe(0);
    const pm2Node = atLine(result.log, "node scripts/check-native-modules.mjs --pm2-node");
    const ci = atLine(result.log, "npm ci --include=dev");
    const check = atLine(result.log, "node scripts/check-native-modules.mjs");
    const stop = atLine(result.log, "pm2 stop api");
    const migrate = atLine(result.log, "npx --no-install tsx scripts/migrate.ts");
    const start = atLine(result.log, "pm2 start api");
    expect(pm2Node).toBeGreaterThanOrEqual(0);
    expect(ci).toBeGreaterThan(pm2Node);
    expect(check).toBeGreaterThan(ci);
    expect(stop).toBeGreaterThan(check);
    expect(migrate).toBeGreaterThan(stop);
    expect(start).toBeGreaterThan(migrate);
    expect(result.log).not.toContain("npm rebuild");
    expect(result.marker).toBe("137\n");
    expect(result.fromStage).toBe("staged\n");
    expect(result.sentinel).toBe("");
  });

  it("restarts the apps after a staged install when migration fails", () => {
    const result = runStep({ depsMatch: false, npxExit: 7 });
    expect(result.status).toBe(7);
    expect(atLine(result.log, "pm2 stop api")).toBeLessThan(atLine(result.log, "npx --no-install tsx scripts/migrate.ts"));
    expect(atLine(result.log, "npx --no-install tsx scripts/migrate.ts")).toBeLessThan(atLine(result.log, "pm2 start api"));
    expect(result.fromStage).toBe("staged\n");
  });

  it("does not stop PM2 when the staged npm ci fails", () => {
    const result = runStep({ depsMatch: false, npmCiRc: 1 });
    expect(result.status).toBe(1);
    expect(result.log).toContain("npm ci --include=dev");
    expect(result.log).not.toMatch(/^pm2 /m);
    expect(result.sentinel).toBe("live\n");
    expect(result.fromStage).toBe("");
  });
});
