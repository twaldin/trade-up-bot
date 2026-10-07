import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/patch-nginx-collection-slug.py");
const deploy = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

const CONF = `server {
    root /opt/trade-up-bot/dist;
    location ~ ^/(faq|calculator|features|pricing|blog|terms|privacy)(/|$) {
        proxy_pass http://127.0.0.1:3001;
    }
    location /trade-ups {
        proxy_pass http://127.0.0.1:3001;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;

function patch(text: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("python3", [script], { input: text, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function mapPath(uri: string): { status: number | null; stdout: string } {
  const result = spawnSync("python3", [script, "--map", uri], { encoding: "utf8" });
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

const REWRITE = "rewrite ^/(trade-ups/collection|collections)/the-([a-z0-9][a-z0-9-]*)-collection/?$ /$1/$2 permanent;";

describe("nginx 301 for legacy the-*-collection slugs", () => {
  it("inserts one permanent rewrite before the trade-ups proxy and leaves canonical routes alone", () => {
    const result = patch(CONF);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(REWRITE);
    expect(result.stdout.indexOf(REWRITE)).toBeLessThan(result.stdout.indexOf("location /trade-ups {"));
    expect(result.stdout).toContain("location /trade-ups {");
    expect(result.stdout).toContain("try_files $uri $uri/ /index.html;");
    expect(result.stdout.split(REWRITE).length - 1).toBe(1);
    expect(patch(result.stdout).stdout).toBe(result.stdout);
  });

  it("fails closed when the file does not proxy trade-ups", () => {
    const result = patch("location / {\n    try_files $uri $uri/ /index.html;\n}\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no trade-ups location");
  });

  it("maps the old detail slug onto the canonical slug and leaves live slugs", () => {
    expect(mapPath("/trade-ups/collection/the-dreams-nightmares-collection")).toEqual({
      status: 0,
      stdout: "/trade-ups/collection/dreams-nightmares",
    });
    expect(mapPath("/trade-ups/collection/the-dreams-nightmares-collection/")).toEqual({
      status: 0,
      stdout: "/trade-ups/collection/dreams-nightmares",
    });
    expect(mapPath("/trade-ups/collection/the-dreams-nightmares-collection?sort=profit")).toEqual({
      status: 0,
      stdout: "/trade-ups/collection/dreams-nightmares?sort=profit",
    });
    expect(mapPath("/collections/the-anubis-collection")).toEqual({
      status: 0,
      stdout: "/collections/anubis",
    });
    expect(mapPath("/trade-ups/collection/the-2021-dust-2-collection")).toEqual({
      status: 0,
      stdout: "/trade-ups/collection/2021-dust-2",
    });
    expect(mapPath("/trade-ups/collection/dreams-nightmares").stdout).toBe("none");
    expect(mapPath("/trade-ups/collection/recoil").stdout).toBe("none");
    expect(mapPath("/trade-ups/42").stdout).toBe("none");
    expect(mapPath("/api/collection-by-slug/the-dust-collection").stdout).toBe("none");
  });

  it("deploy applies the redirect after the security-header patch and before smoke", () => {
    const security = deploy.indexOf("scripts/patch-nginx-security-headers.py --apply");
    const redirect = deploy.indexOf("scripts/patch-nginx-collection-slug.py --apply");
    const smoke = deploy.indexOf("name: Smoke check");
    expect(security).toBeGreaterThan(0);
    expect(redirect).toBeGreaterThan(security);
    expect(smoke).toBeGreaterThan(redirect);
  });
});
