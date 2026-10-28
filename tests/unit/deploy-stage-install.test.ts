import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("staged lockfile install", () => {
  it("runs npm ci of the real package.json after git init, including puppeteer's browser", async () => {
    const parent = mkdtempSync(join(tmpdir(), "stage-real-"));
    const stage = join(parent, "stage");
    const cache = join(parent, "puppeteer-cache");
    mkdirSync(stage);
    const hooksBefore = spawnSync("git", ["config", "--local", "core.hooksPath"], {
      cwd: root,
      encoding: "utf8",
    });
    const env: NodeJS.ProcessEnv = { ...process.env, PUPPETEER_CACHE_DIR: cache };
    delete env.PUPPETEER_SKIP_DOWNLOAD;
    delete env.npm_config_ignore_scripts;
    cpSync(join(root, "package.json"), join(stage, "package.json"));
    cpSync(join(root, "package-lock.json"), join(stage, "package-lock.json"));
    const install = spawnSync(
      "bash",
      ["-c", 'set -euo pipefail; git init "$1"; cd "$1"; timeout 600 npm ci --include=dev', "bash", stage],
      { encoding: "utf8", env, timeout: 590_000 },
    );
    const hooksAfter = spawnSync("git", ["config", "--local", "core.hooksPath"], {
      cwd: root,
      encoding: "utf8",
    });
    try {
      expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(hooksAfter.stdout).toBe(hooksBefore.stdout);

      const requireStage = createRequire(join(stage, "package.json"));
      const Database = requireStage("better-sqlite3");
      const db = new Database(":memory:");
      db.exec("CREATE TABLE preflight (ok INTEGER)");
      db.prepare("INSERT INTO preflight (ok) VALUES (1)").run();
      const row = db.prepare("SELECT ok FROM preflight").get();
      db.close();
      expect(row).toEqual({ ok: 1 });

      const previousCache = process.env.PUPPETEER_CACHE_DIR;
      const previousSkip = process.env.PUPPETEER_SKIP_DOWNLOAD;
      process.env.PUPPETEER_CACHE_DIR = cache;
      delete process.env.PUPPETEER_SKIP_DOWNLOAD;
      let browser = "";
      try {
        const puppeteer = requireStage("puppeteer");
        const resolved: unknown = await puppeteer.executablePath();
        browser = typeof resolved === "string" ? resolved : "";
      } finally {
        if (previousCache === undefined) delete process.env.PUPPETEER_CACHE_DIR;
        else process.env.PUPPETEER_CACHE_DIR = previousCache;
        if (previousSkip === undefined) delete process.env.PUPPETEER_SKIP_DOWNLOAD;
        else process.env.PUPPETEER_SKIP_DOWNLOAD = previousSkip;
      }
      expect(browser.startsWith(cache)).toBe(true);
      expect(existsSync(browser)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 600_000);
});
