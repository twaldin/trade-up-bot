import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEV_SESSION_SECRET,
  MIN_PRODUCTION_SESSION_SECRET_LENGTH,
  productionSessionSecretRefusal,
  resolveSessionSecrets,
  SessionSecretError,
  sessionSecretRotationWarning,
} from "../../server/session-secret.js";
import {
  DEV_SESSION_SECRET as SCRIPT_DEV_SESSION_SECRET,
  MIN_PRODUCTION_SESSION_SECRET_LENGTH as SCRIPT_MIN_LENGTH,
  apiPm2SessionSecrets,
  extractPm2ProcessList,
  preflightFromSources,
  productionSessionSecretRefusal as scriptRefusal,
  readDotenvValue,
} from "../../scripts/check-production-session-secret.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOOD = "a".repeat(MIN_PRODUCTION_SESSION_SECRET_LENGTH);
const PREVIOUS = "b".repeat(40);

function production(secret: string | undefined, previous?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    ...(secret === undefined ? {} : { SESSION_SECRET: secret }),
    ...(previous === undefined ? {} : { SESSION_SECRET_PREVIOUS: previous }),
  };
}

describe("production session secret boot guard", () => {
  it("names the dev default and the 32 character minimum", () => {
    expect(DEV_SESSION_SECRET).toBe("trade-up-bot-dev-secret");
    expect(DEV_SESSION_SECRET.length).toBeLessThan(MIN_PRODUCTION_SESSION_SECRET_LENGTH);
    expect(MIN_PRODUCTION_SESSION_SECRET_LENGTH).toBe(32);
  });

  it("refuses a missing, default, or short secret in production", () => {
    expect(() => resolveSessionSecrets(production(undefined))).toThrow(
      "Refusing to start: SESSION_SECRET is missing in production.",
    );
    expect(() => resolveSessionSecrets(production("   "))).toThrow(
      "Refusing to start: SESSION_SECRET is missing in production.",
    );
    expect(() => resolveSessionSecrets(production(DEV_SESSION_SECRET))).toThrow(
      "Refusing to start: SESSION_SECRET is the dev default in production.",
    );
    expect(() => resolveSessionSecrets(production(`  ${DEV_SESSION_SECRET}  `))).toThrow(
      /dev default/,
    );
    expect(() => resolveSessionSecrets(production("x".repeat(31)))).toThrow(
      "Refusing to start: SESSION_SECRET is shorter than 32 characters in production.",
    );
  });

  it("does not include the secret value in the refusal", () => {
    const secret = "z".repeat(31);
    expect(productionSessionSecretRefusal(secret)).not.toContain(secret);
    expect(productionSessionSecretRefusal(DEV_SESSION_SECRET)).not.toContain(DEV_SESSION_SECRET);
    expect(() => resolveSessionSecrets(production(secret))).toThrow(SessionSecretError);
    try {
      resolveSessionSecrets(production(secret));
    } catch (err) {
      expect(err).toBeInstanceOf(SessionSecretError);
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it("accepts a 32 character secret and keeps shorter secrets in development", () => {
    expect(resolveSessionSecrets(production(GOOD))).toBe(GOOD);
    expect(resolveSessionSecrets(production(`  ${GOOD}  `))).toBe(GOOD);
    expect(resolveSessionSecrets({})).toBe(DEV_SESSION_SECRET);
    expect(resolveSessionSecrets({ NODE_ENV: "development" })).toBe(DEV_SESSION_SECRET);
    expect(resolveSessionSecrets({ NODE_ENV: "test", SESSION_SECRET: "short" })).toBe("short");
  });

  it("puts the previous secret after the current one so new cookies rotate", () => {
    expect(resolveSessionSecrets(production(GOOD, PREVIOUS))).toEqual([GOOD, PREVIOUS]);
    expect(resolveSessionSecrets(production(GOOD, `  ${PREVIOUS}  `))).toEqual([GOOD, PREVIOUS]);
    expect(resolveSessionSecrets(production(GOOD, GOOD))).toBe(GOOD);
    expect(resolveSessionSecrets(production(GOOD, "   "))).toBe(GOOD);
    expect(resolveSessionSecrets(production(GOOD, DEV_SESSION_SECRET))).toEqual([GOOD, DEV_SESSION_SECRET]);
    expect(resolveSessionSecrets({ SESSION_SECRET: "short", SESSION_SECRET_PREVIOUS: PREVIOUS })).toEqual([
      "short",
      PREVIOUS,
    ]);
  });

  it("warns when a previous secret is still accepted, without printing either secret", () => {
    const rotated = sessionSecretRotationWarning(production(GOOD, PREVIOUS));
    expect(rotated).toMatch(/SESSION_SECRET_PREVIOUS/);
    expect(rotated).toMatch(/still verify/);
    expect(rotated).not.toContain(GOOD);
    expect(rotated).not.toContain(PREVIOUS);

    const devPrevious = sessionSecretRotationWarning(production(GOOD, DEV_SESSION_SECRET));
    expect(devPrevious).toMatch(/dev default/);
    expect(devPrevious).not.toContain(DEV_SESSION_SECRET);
    expect(devPrevious).not.toContain(GOOD);

    expect(sessionSecretRotationWarning(production(GOOD))).toBeNull();
    expect(sessionSecretRotationWarning(production(GOOD, GOOD))).toBeNull();
  });

  it("matches the deploy preflight rules", () => {
    expect(SCRIPT_DEV_SESSION_SECRET).toBe(DEV_SESSION_SECRET);
    expect(SCRIPT_MIN_LENGTH).toBe(MIN_PRODUCTION_SESSION_SECRET_LENGTH);
    for (const secret of ["", " ", DEV_SESSION_SECRET, "x".repeat(31), GOOD, `  ${GOOD}  `]) {
      expect(scriptRefusal).toBe(productionSessionSecretRefusal);
      expect(scriptRefusal(secret)).toBe(productionSessionSecretRefusal(secret));
    }
  });

  it("refuses to listen until the production secret is accepted", () => {
    const index = readFileSync(join(root, "server/index.ts"), "utf8");
    const auth = readFileSync(join(root, "server/auth.ts"), "utf8");
    const startup = index.indexOf("Async startup");
    const guard = index.indexOf("resolveSessionSecrets(process.env)", startup);
    const logged = index.indexOf("console.error", guard);
    const exit = index.indexOf("process.exit(1)", guard);
    const initDb = index.indexOf("initDb()", startup);
    expect(guard).toBeGreaterThan(startup);
    expect(logged).toBeGreaterThan(guard);
    expect(exit).toBeGreaterThan(logged);
    expect(exit).toBeLessThan(initDb);
    expect(auth).toContain("resolveSessionSecrets(process.env)");
    expect(auth).toContain("sessionSecretRotationWarning(process.env)");
    expect(auth).not.toContain('SESSION_SECRET || "trade-up-bot-dev-secret"');
    const sessionUse = auth.indexOf("app.use(session({");
    expect(auth.slice(sessionUse, sessionUse + 120)).toContain("secret: sessionSecret");
  });
});

describe("deploy session secret preflight", () => {
  const workflow = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

  it("runs on the VPS after fetch and before pm2 reload", () => {
    const line = workflow.split("\n").find((entry) => entry.includes("ssh ") && entry.includes("pm2 reload api"));
    expect(line).toBeDefined();
    const checkAt = line!.indexOf("npx --no-install tsx scripts/check-production-session-secret.ts");
    const reloadAt = line!.indexOf("pm2 reload api");
    expect(checkAt).toBeGreaterThan(line!.indexOf("git merge --ff-only origin/main"));
    expect(reloadAt).toBeGreaterThan(checkAt);
    expect(line).toContain("npx --no-install tsx scripts/check-production-session-secret.ts && pm2 reload api");
  });

  it("reads the first dotenv assignment the API loader would keep", () => {
    const text = [
      "# SESSION_SECRET=commented",
      "export SESSION_SECRET=exported-value-should-not-match",
      "SESSION_SECRET=first-value",
      "SESSION_SECRET=second-value",
      'SESSION_SECRET_PREVIOUS="keep-quotes"',
    ].join("\n");
    expect(readDotenvValue(text, "SESSION_SECRET")).toBe("first-value");
    expect(readDotenvValue("SESSION_SECRET=  spaced  \r\n", "SESSION_SECRET")).toBe("spaced");
    expect(readDotenvValue('SESSION_SECRET="quoted"', "SESSION_SECRET")).toBe('"quoted"');
    expect(readDotenvValue(text, "MISSING")).toBe("");
    const index = readFileSync(join(root, "server/index.ts"), "utf8");
    expect(index).toContain('line.replace(/\\r$/, "").match(/^(\\w+)=(.*)$/)');
    const script = readFileSync(join(root, "scripts/check-production-session-secret.ts"), "utf8");
    expect(script).toContain('line.replace(/\\r$/, "").match(/^(\\w+)=(.*)$/)');
  });

  it("uses a non-empty pm2 api secret over the env file", () => {
    const raw = `>>>> [PM2] banner secret-pass
[{"name":"daemon","pm2_env":{"SESSION_SECRET":"${"d".repeat(40)}"}},{"name":"api","pm2_env":{"status":"online","env":{"SESSION_SECRET":"${"n".repeat(40)}"},"DATABASE_URL":"postgresql://user:secret-pass@db/prod"}}]`;
    const procs = extractPm2ProcessList(raw);
    expect(procs).toHaveLength(2);
    expect(apiPm2SessionSecrets(procs ?? [])).toEqual(["n".repeat(40)]);
    const fileWins = preflightFromSources({
      pm2Ok: true,
      pm2Raw: '[{"name":"api","pm2_env":{"status":"online"}}]',
      envText: `SESSION_SECRET=${GOOD}`,
    });
    expect(fileWins).toEqual({ ok: true, message: "SESSION_SECRET preflight ok" });
    const pm2Wins = preflightFromSources({
      pm2Ok: true,
      pm2Raw: `[{"name":"api","pm2_env":{"SESSION_SECRET":"${"s".repeat(31)}"}}]`,
      envText: `SESSION_SECRET=${GOOD}`,
    });
    expect(pm2Wins.ok).toBe(false);
    expect(pm2Wins.message).toMatch(/shorter than 32/);
    expect(pm2Wins.message).not.toContain("s".repeat(31));
    expect(pm2Wins.message).not.toContain(GOOD);
  });

  it("fails closed when pm2 cannot be read or the effective secret is unsafe", () => {
    expect(preflightFromSources({ pm2Ok: false, pm2Raw: "", envText: `SESSION_SECRET=${GOOD}` }).ok).toBe(false);
    expect(preflightFromSources({ pm2Ok: true, pm2Raw: "not-json", envText: `SESSION_SECRET=${GOOD}` }).ok).toBe(false);
    expect(preflightFromSources({ pm2Ok: true, pm2Raw: "[]", envText: "" }).message).toMatch(/missing/);
    expect(preflightFromSources({
      pm2Ok: true,
      pm2Raw: "[]",
      envText: `SESSION_SECRET=${DEV_SESSION_SECRET}`,
    }).message).toMatch(/dev default/);
    const top = preflightFromSources({
      pm2Ok: true,
      pm2Raw: `[{"name":"api","pm2_env":{"SESSION_SECRET":"  ${GOOD}  ","env":{"SESSION_SECRET":"short"}}}]`,
      envText: "",
    });
    expect(top.ok).toBe(true);
  });

  it("exits before any reload and does not print secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-secret-"));
    const secret = `super-secret-value-that-must-not-leak-${"0123456789".repeat(3)}`;
    const envFile = join(dir, ".env");
    writeFileSync(envFile, `SESSION_SECRET=${secret}\nDATABASE_URL=postgresql://user:secret-pass@db/prod\n`);
    writeFileSync(join(dir, "pm2"), `#!/bin/bash
echo 'stderr sk_live_FAKE ${secret}' >&2
echo '>>>> In-memory PM2 is out-of-date'
echo '[PM2] leftover sk_live_FAKE'
echo '[{"name":"api","pm2_env":{"status":"online","SESSION_SECRET":"${secret}","STRIPE_SECRET_KEY":"sk_live_FAKE"}}]'
`);
    chmodSync(join(dir, "pm2"), 0o755);
    const result = spawnSync("npx", ["tsx", join(root, "scripts/check-production-session-secret.ts")], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, SESSION_SECRET_ENV_FILE: envFile },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SESSION_SECRET preflight ok");
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain("sk_live_FAKE");
    expect(result.stderr).not.toContain("sk_live_FAKE");
    expect(result.stdout).not.toContain("secret-pass");
    expect(result.stderr).not.toContain("secret-pass");

    writeFileSync(envFile, "SESSION_SECRET=trade-up-bot-dev-secret\n");
    writeFileSync(join(dir, "pm2"), "#!/bin/bash\necho '[]'\n");
    const refused = spawnSync("npx", ["tsx", join(root, "scripts/check-production-session-secret.ts")], {
      cwd: dir,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, SESSION_SECRET_ENV_FILE: envFile },
      encoding: "utf8",
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/dev default/);
    expect(refused.stderr).toMatch(/Refusing to reload/);
    expect(refused.stdout).not.toContain("pm2 reload");
    expect(refused.stderr).not.toContain(DEV_SESSION_SECRET);
  });
});
