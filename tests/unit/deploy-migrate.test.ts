import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runStep(npxExit: number, startExit = 0): { status: number | null; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "deploy-migrate-"));
  const log = join(dir, "log");
  const files = ["package.json", "package-lock.json"];
  const hashes = files.map((file) => {
    const content = "{}\n";
    writeFileSync(join(dir, file), content);
    return `${createHash("sha256").update(content).digest("hex")}  ${file}\n`;
  }).join("");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules/.tradeup-deps.sha256"), createHash("sha256").update(hashes).digest("hex"));
  writeBin(dir, "git", "#!/bin/bash\necho \"git $*\" >> \"$LOG\"\nexit 0\n");
  writeBin(dir, "pm2", `#!/bin/bash
echo "pm2 $*" >> "$LOG"
if [ "$1" = "start" ]; then exit ${startExit}; fi
exit 0
`);
  writeBin(dir, "npx", `#!/bin/bash
echo "npx $*" >> "$LOG"
exit ${npxExit}
`);
  try {
    const result = spawnSync("bash", ["-c", migrateShell()], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, LOG: log, TRADEUP_ROOT: dir },
      encoding: "utf8",
    });
    return { status: result.status, log: readFileSync(log, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("deploy migration step", () => {

  it("starts the fetcher and fails the step when the migration fails", () => {
    const result = runStep(7);
    expect(result.status).toBe(7);
    expect(result.log).toContain("pm2 stop fetcher");
    expect(result.log).toContain("npx --no-install tsx scripts/migrate.ts");
    expect(result.log).toContain("pm2 start fetcher");
    const stop = result.log.indexOf("pm2 stop fetcher");
    const ran = result.log.indexOf("npx --no-install tsx scripts/migrate.ts");
    const start = result.log.indexOf("pm2 start fetcher");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(ran).toBeGreaterThan(stop);
    expect(start).toBeGreaterThan(ran);
  });

  it("starts the fetcher when the migration succeeds", () => {
    const result = runStep(0);
    expect(result.status).toBe(0);
    expect(result.log).toContain("pm2 start fetcher");
  });
});
