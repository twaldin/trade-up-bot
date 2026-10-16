import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const helper = join(root, "scripts/nginx_conf.py");

function park(names: Record<string, string>): { left: string[]; parked: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "nginx-bak-"));
  const site = join(dir, "sites-enabled");
  const dest = join(dir, "parked");
  spawnSync("mkdir", ["-p", site]);
  for (const [name, body] of Object.entries(names)) {
    writeFileSync(join(site, name), body);
  }
  const code = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location("nginx_conf", ${JSON.stringify(helper)})`,
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "from pathlib import Path",
    `moved = m.park_loaded_backups(Path(${JSON.stringify(dest)}), (Path(${JSON.stringify(site)}),))`,
    "left = sorted(p.name for p in Path(sys.argv[1]).iterdir())",
    "parked = sorted(p.name for p in Path(sys.argv[2]).iterdir()) if Path(sys.argv[2]).exists() else []",
    "print(json.dumps({\"left\": left, \"parked\": parked, \"moved\": len(moved)}))",
  ].join("\n");
  const out = spawnSync("python3", ["-c", code, site, dest], { encoding: "utf8" });
  expect(out.status, out.stderr).toBe(0);
  return JSON.parse(out.stdout) as { left: string[]; parked: string[] };
}

describe("nginx deploy skips backup configs", () => {
  it("moves *.bak files out of the include directory so nginx does not load them", () => {
    const result = park({
      tradeup: "live\n",
      "tradeup.bak": "stale\n",
      "tradeup.bak-20260518220608": "dated\n",
      "tradeup.conf.bak": "conf bak\n",
      "bakery.conf": "keep\n",
    });
    expect(result.left).toEqual(["bakery.conf", "tradeup"]);
    expect(result.parked.some((name) => name.endsWith("tradeup.bak"))).toBe(true);
    expect(result.parked.some((name) => name.includes("tradeup.bak-20260518220608"))).toBe(true);
    expect(result.parked.some((name) => name.includes("tradeup.conf.bak"))).toBe(true);
  });

  it("deploy patch scripts park backups before nginx loads the config", () => {
    for (const file of [
      "scripts/patch-nginx-best-route.py",
      "scripts/patch-nginx-security-headers.py",
      "scripts/patch-nginx-collection-slug.py",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).toContain("with_backups_unloaded");
      expect(source).toContain("is_backup_name");
    }
  });
});
