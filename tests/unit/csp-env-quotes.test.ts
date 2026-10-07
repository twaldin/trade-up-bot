import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import helmet from "helmet";
import { helmetSecurityOptions, staticHtmlSecurityHeaders } from "../../server/security-headers.js";
import { applyDotenv, parseDotenv, parseDotenvValue } from "../../scripts/lib/dotenv-file.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("deploy .env reader matches dotenvx quoting", () => {
  it("strips matching surrounding quotes", () => {
    expect(parseDotenvValue('"G-2474G4P5QE"')).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("'G-2474G4P5QE'")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("`G-2474G4P5QE`")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("G-2474G4P5QE")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("G-2474G4P5QE # prod")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue("G-2474G4P5QE#prod")).toBe("G-2474G4P5QE");
    expect(parseDotenvValue('"G-2474G4P5QE" # prod')).toBe("G-2474G4P5QE");
    expect(parseDotenvValue('"a # b"')).toBe("a # b");
    expect(parseDotenvValue('"unterminated')).toBe('"unterminated');
  });

  it("lets the last assignment win, like dotenvx, and handles CRLF", () => {
    const env = parseDotenv('GA4_MEASUREMENT_ID="G-AAAA1111"\r\nGA4_MEASUREMENT_ID=G-BBBB2222\r\n');
    expect(env.get("GA4_MEASUREMENT_ID")).toBe("G-BBBB2222");
  });

  it("accepts leading whitespace, export, and KEY: value", () => {
    const env = parseDotenv("  A=1\nexport B=2\nexport\tC=3\nD: 4\n# E=5\n");
    expect([env.get("A"), env.get("B"), env.get("C"), env.get("D"), env.has("E")]).toEqual(["1", "2", "3", "4", false]);
  });

  it("an unquoted GA4 id with a glued #comment still yields the GA4 CSP wildcards", () => {
    const env: NodeJS.ProcessEnv = {};
    applyDotenv("GA4_MEASUREMENT_ID=G-2474G4P5QE#prod\n", env);
    expect(staticHtmlSecurityHeaders(env)["Content-Security-Policy"]).toContain("https://*.google-analytics.com");
  });

  const dotenvx = (() => {
    try {
      return createRequire(import.meta.url)("@dotenvx/dotenvx") as { parse: (src: string) => Record<string, string> };
    } catch {
      return null;
    }
  })();
  it.skipIf(!dotenvx)("matches @dotenvx/dotenvx parse when it is installed", () => {
    const src = [
      'Q1="dq # kept"', "Q2='sq'", "Q3=`bt`", "U1=plain # c", "U2=G-X#prod", "U3=  spaced  ",
      "  LEAD=1", "export EXP=2", "DUP=first", "DUP=last", "EMPTY=", "CRLF=x\r",
    ].join("\n");
    const ours = Object.fromEntries(parseDotenv(src));
    const theirs = dotenvx!.parse(src);
    for (const key of ["Q1", "Q2", "Q3", "U1", "U2", "U3", "LEAD", "EXP", "DUP", "EMPTY", "CRLF"]) {
      expect(ours[key], key).toBe(theirs[key]);
    }
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

  it("skips backups and keeps live config names", () => {
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
      "tradeup_bak",
      "tradeup.bak2",
      "tradeup-old",
      "tradeup.disabled",
      ".tradeup.swp",
      "tradeup",
      "default",
      "tradeup.conf",
      "bakery.conf",
      "oldsite.conf",
      "old-site",
    ])).toEqual([...Array(14).fill(true), ...Array(6).fill(false)]);
  }, 60_000);
});

describe("static nginx CSP mirrors the app CSP", () => {
  function helmetCsp(env: NodeJS.ProcessEnv): string {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (n: string, v: string) => headers.set(n.toLowerCase(), String(v)),
      getHeader: (n: string) => headers.get(n.toLowerCase()),
      removeHeader: (n: string) => headers.delete(n.toLowerCase()),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    helmet(helmetSecurityOptions(env))({} as any, res as any, () => {});
    return headers.get("content-security-policy") ?? "";
  }

  for (const env of [{}, { GA4_MEASUREMENT_ID: "G-2474G4P5QE" }, { GA4_MEASUREMENT_ID: "G-2474G4P5QE", META_PIXEL_ID: "123456789012345" }]) {
    it(`matches helmet exactly for ${JSON.stringify(env)}`, () => {
      expect(staticHtmlSecurityHeaders(env)["Content-Security-Policy"]).toBe(helmetCsp(env));
    });
  }

  it("allows the GA4 signals host in connect-src and img-src when GA4 is set", () => {
    const csp = staticHtmlSecurityHeaders({ GA4_MEASUREMENT_ID: "G-2474G4P5QE" })["Content-Security-Policy"];
    const directive = (name: string) => csp.split(";").find((d) => d.trim().startsWith(`${name} `)) ?? "";
    expect(directive("connect-src")).toContain("https://stats.g.doubleclick.net");
    expect(directive("img-src")).toContain("https://stats.g.doubleclick.net");
    expect(directive("connect-src")).toContain("https://*.google-analytics.com");
  });
});
