import { spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../.github/workflows/deploy.yml"), "utf-8");

function smokeScript(): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === "      - name: Smoke check");
  const end = lines.findIndex((line, index) => index > start && line.startsWith("      - name:"));
  const block = lines.slice(start, end);
  const runAt = block.findIndex((line) => line === "        run: |");
  return block.slice(runAt + 1).map((line) => line.slice(10)).join("\n");
}

function timeoutBlock(script: string): string {
  const start = script.indexOf('if [ "$ready" != "1" ]; then');
  const end = script.indexOf("\nfi\n", start);
  return script.slice(start, end + 4);
}

const DIAGNOSTIC_SSH = "timeout 30 ssh -o ConnectTimeout=10 -o BatchMode=yes root@178.156.239.58 \"pm2 jlist 2>/dev/null | python3 -c 'import json,sys; exec(\\\"raw=sys.stdin.read()\\\\ndec=json.JSONDecoder()\\\\nprocs=None\\\\ni=raw.find(\\\\\\\"[\\\\\\\")\\\\nwhile i>=0:\\\\n    try:\\\\n        val,_=dec.raw_decode(raw,i)\\\\n    except Exception:\\\\n        i=raw.find(\\\\\\\"[\\\\\\\", i+1)\\\\n        continue\\\\n    if isinstance(val, list):\\\\n        procs=val\\\\n        break\\\\n    i=raw.find(\\\\\\\"[\\\\\\\", i+1)\\\\nif not isinstance(procs, list) or not procs:\\\\n    sys.exit(1)\\\\nfor p in procs:\\\\n    if not isinstance(p, dict):\\\\n        sys.exit(1)\\\\n    env=p.get(\\\\\\\"pm2_env\\\\\\\")\\\\n    if not isinstance(env, dict):\\\\n        env={}\\\\n    fields=(p.get(\\\\\\\"name\\\\\\\"), p.get(\\\\\\\"pm_id\\\\\\\"), env.get(\\\\\\\"status\\\\\\\"), env.get(\\\\\\\"restart_time\\\\\\\"), env.get(\\\\\\\"pm_uptime\\\\\\\"))\\\\n    if any(isinstance(v, (dict, list)) for v in fields):\\\\n        sys.exit(1)\\\\n    print(\\\\\\\"name=%s pm_id=%s status=%s restart_time=%s uptime=%s\\\\\\\"%fields)\\\\n\\\")' 2>/dev/null\" 2>/dev/null || echo \"pm2 summary unavailable\"";

const BANNER_JLIST = `>>>> In-memory PM2 is out-of-date, do:
>>>> $ pm2 update
In memory PM2 version: 5.2.0
Local PM2 version: 5.3.0
[PM2] leftover sk_live_FAKE
[{"name":"api","pm_id":0,"pm2_env":{"status":"online","restart_time":3,"pm_uptime":1710000000000,"DATABASE_URL":"postgresql://user:secret-pass@db/prod","STRIPE_SECRET_KEY":"sk_live_FAKE","env":{"DATABASE_URL":"postgresql://user:secret-pass@db/prod","STRIPE_SECRET_KEY":"sk_live_FAKE"}}},{"name":"daemon","pm_id":1,"pm2_env":{"status":"launching","restart_time":1,"pm_uptime":1710000001000,"DATABASE_URL":"postgresql://user:secret-pass@db/prod"}}]
`;

const SECRETS = ["sk_live_FAKE", "secret-pass", "DATABASE_URL", "STRIPE_SECRET_KEY", "In-memory PM2 is out-of-date"];

function writeBin(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function fakeSsh(dir: string): string {
  return `#!/bin/bash
remote="\${@: -1}"
PATH="${dir}:\$PATH" bash -c "$remote"
`;
}

function runDiag(dir: string, line: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("bash", ["-eo", "pipefail", "-c", line], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    encoding: "utf-8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

function assertNoSecrets(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("deploy smoke diagnostics", () => {
  const script = smokeScript();
  const timeout = timeoutBlock(script);
  const diagnostic = timeout.split("\n").find((line) => line.includes("timeout 30 ssh"));

  it("uses one bounded diagnostic ssh and no other pm2 or jlist dump", () => {
    expect(diagnostic?.trim()).toBe(DIAGNOSTIC_SSH);
    expect(timeout.split("\n").filter((line) => /\bssh\b/.test(line))).toHaveLength(1);
    const commands = timeout
      .split("\n")
      .filter((line) => !line.includes("see pm2 logs api on the VPS"))
      .filter((line) => !line.includes("----- pm2 jlist -----"))
      .join("\n")
      .replace('echo "pm2 summary unavailable"', "");
    expect(commands.match(/\bpm2\b/g)).toEqual(["pm2"]);
    expect(commands).toContain("pm2 jlist");
    expect(commands).not.toMatch(/pm2 logs|pm2 env|pm2 show|pm2 describe/);
    expect(commands).not.toMatch(/\bcat\b/);
  });

  it("keeps the homepage check warning-only when curl cannot connect", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-home-"));
    writeBin(dir, "curl", "#!/bin/bash\nexit 7\n");
    const prelude = script.slice(0, script.indexOf("\nready=0"));
    const result = runDiag(dir, `${prelude}\necho CONTINUED\n`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("home: 000");
    expect(result.stdout).toContain("::warning::Homepage returned 000");
    expect(result.stdout).toContain("CONTINUED");
  });

  it("summarises a banner-prefixed jlist without secrets on stdout or stderr", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-pm2-"));
    writeBin(dir, "pm2", `#!/bin/bash
if [[ "$1" != "jlist" ]]; then
  echo "pm2 $*" >&2
  exit 9
fi
cat << 'JSON'
${BANNER_JLIST}
JSON
echo 'stderr secret-pass sk_live_FAKE' >&2
`);
    writeBin(dir, "ssh", fakeSsh(dir));
    const result = runDiag(dir, diagnostic ?? "exit 9");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("name=api pm_id=0 status=online restart_time=3 uptime=1710000000000");
    expect(result.stdout).toContain("name=daemon pm_id=1 status=launching restart_time=1 uptime=1710000001000");
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it("prints only pm2 summary unavailable when jlist is not JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-pm2-bad-"));
    writeBin(dir, "pm2", "#!/bin/bash\necho 'not-json secret-pass sk_live_FAKE postgresql://user:secret-pass@db/prod'\necho 'stderr sk_live_FAKE' >&2\n");
    writeBin(dir, "ssh", fakeSsh(dir));
    const result = runDiag(dir, diagnostic ?? "exit 9");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("pm2 summary unavailable");
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });

  it("prints only pm2 summary unavailable when jlist has no entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-pm2-empty-"));
    writeBin(dir, "pm2", `#!/bin/bash
printf '%s' '>>>> In-memory PM2 is out-of-date, do:
[PM2] sk_live_FAKE DATABASE_URL=postgresql://user:secret-pass@db/prod
[]'
echo 'stderr sk_live_FAKE' >&2
`);
    writeBin(dir, "ssh", fakeSsh(dir));
    const result = runDiag(dir, diagnostic ?? "exit 9");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("pm2 summary unavailable");
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  });
});
