import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { staticHtmlSecurityHeaders } from "../../server/security-headers.js";
import { applyDotenv, parseDotenv, parseDotenvValue } from "../../scripts/lib/dotenv-file.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("deploy .env reader matches dotenvx quoting", () => {
  it("strips matching surrounding quotes", () => {
    expect(parseDotenvValue('"G-2474G4P5QE"')).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("'G-2474G4P5QE'")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("`G-2474G4P5QE`")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("G-2474G4P5QE")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("G-2474G4P5QE # prod")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue('"a # b"')).toBe("a # b");
    expect(parseDotenvValue('"unterminated')).toBe('"unterminated');
  });

  it("keeps the first assignment and handles CRLF", () => {
    const env = parseDotenv('GA4_MEASUREMENT_ID="G-AAAA1111"\r\nGA4_MEASUREMENT_ID=G-BBBB2222\n');
    expect(env.get("GA4_MEASUREMENT_ID")).toBe("G-AAAA1111");
  });

  it("a quoted GA4 id still yields the GA4 CSP wildcards", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotenv('GA4_MEASUREMENT_ID="G-2474G4P5QE"\n', env);
    const csp = staticHtmlSecurityHeaders(env)["Content-Security-Policy"];
    expect(csp).toContain("https://*.google-analytics.com");
    expect(csp).toContain("https://*.analytics.google.com");
    expect(csp).toContain("https://*.googletagmanager.com");
  });

  it("does not override a value already in the environment", () => {
    const env: NodeJS.ProcessEnv = { GA4_MEASUREMENT_ID: "G-KEEP0000" };
    applyDotenv("GA4_MEASUREMENT_ID=G-OTHER111\n", env);
    expect(env.GA4_MEASUREMENT_ID).toBe("G-KEEP0000");
  });
});

describe("nginx header patch skips backup copies", () => {
  function isBackup(names: string[]): boolean[] {
    const code = [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location("p", ${JSON.stringify(join(root, "scripts/patch-nginx-security-headers.py"))})`,
      "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "print(json.dumps([m.is_backup_name(n) for n in json.loads(sys.argv[1])]))",
    ].join("\n");
    const out = spawnSync("python3", ["-c", code, JSON.stringify(names)], { encoding: "utf8" });
    expect(out.status, out.stderr).toBe(0);
    return JSON.parse(out.stdout) as boolean[];
  }

  it("skips dated, numbered, and suffix backups", () => {
    expect(isBackup([
      "tradeup.bak-20260518220608",
      "tradeup.bak",
      "tradeup.bak.1",
      "tradeup.backup-2026",
      "tradeup.orig",
      "tradeup.old",
      "tradeup~",
      "tradeup.dpkg-old",
      "tradeup.save",
    ])).toEqual(Array(9).fill(true));
  });

  it("still patches live config names", () => {
    expect(isBackup(["tradeup", "default", "tradeup.conf", "bakery.conf", "oldsite.conf"])).toEqual(Array(5).fill(false));
  });
});
