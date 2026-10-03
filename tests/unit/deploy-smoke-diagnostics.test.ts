import { execFileSync } from "child_process";
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

describe("deploy smoke diagnostics", () => {
  const script = smokeScript();
  const sshLine = script.split("\n").find((line) => line.trimStart().startsWith("ssh "));

  it("keeps the homepage check warning-only when curl cannot connect", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-home-"));
    writeBin(dir, "curl", "#!/bin/bash\nexit 7\n");
    const prelude = script.slice(0, script.indexOf("\nready=0"));
    const result = execFileSync("bash", ["-eo", "pipefail", "-c", `${prelude}\necho CONTINUED\n`], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      encoding: "utf-8",
    });
    expect(result).toContain("home: 000");
    expect(result).toContain("::warning::Homepage returned 000");
    expect(result).toContain("CONTINUED");
  });

  it("summarises a banner-prefixed jlist without secrets or the raw banner", () => {
    expect(sshLine).toContain("-o ConnectTimeout=10");
    expect(sshLine).toContain("-o BatchMode=yes");
    expect(script).not.toContain("pm2 logs api --");
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
    writeBin(dir, "ssh", `#!/bin/bash
remote="\${@: -1}"
PATH="${dir}:\$PATH" bash -c "$remote"
`);
    const result = execFileSync("bash", ["-eo", "pipefail", "-c", sshLine ?? "exit 9"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      encoding: "utf-8",
    });
    expect(result).toContain("name=api pm_id=0 status=online restart_time=3 uptime=1710000000000");
    expect(result).toContain("name=daemon pm_id=1 status=launching restart_time=1 uptime=1710000001000");
    for (const secret of SECRETS) expect(result).not.toContain(secret);
  });

  it("prints only pm2 summary unavailable when jlist is not JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-pm2-bad-"));
    writeBin(dir, "pm2", "#!/bin/bash\necho 'not-json secret-pass sk_live_FAKE postgresql://user:secret-pass@db/prod'\n");
    writeBin(dir, "ssh", `#!/bin/bash
remote="\${@: -1}"
PATH="${dir}:\$PATH" bash -c "$remote"
`);
    const result = execFileSync("bash", ["-eo", "pipefail", "-c", sshLine ?? "exit 9"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      encoding: "utf-8",
    });
    expect(result.trim()).toBe("pm2 summary unavailable");
    expect(result).not.toContain("sk_live_FAKE");
    expect(result).not.toContain("secret-pass");
  });
});
