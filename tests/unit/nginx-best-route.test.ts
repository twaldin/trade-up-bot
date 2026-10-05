import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/patch-nginx-best-route.py");
const deploy = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");
const prChecks = readFileSync(join(root, ".github/workflows/pr-checks.yml"), "utf8");

function patch(text: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("python3", [script], { input: text, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const REGEX_CONF = `server {
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

const SOLO_CONF = `location ~ ^/calculator(/|$) {
    proxy_pass http://127.0.0.1:3001;
}
`;

const EXACT_CONF = `location = /calculator {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
}
location /calculator/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
}
`;

describe("nginx proxy for /best-cs2-trade-ups", () => {
  it("adds the route to the calculator alternation and leaves /trade-ups alone", () => {
    const result = patch(REGEX_CONF);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("calculator|best-cs2-trade-ups");
    expect(result.stdout).toContain("location /trade-ups {");
    expect(result.stdout).toContain("try_files $uri $uri/ /index.html;");
    expect(patch(result.stdout).stdout).toBe(result.stdout);
  });

  it("wraps a calculator-only regex without breaking the boundary", () => {
    const result = patch(SOLO_CONF);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("^/(?:calculator|best-cs2-trade-ups)(/|$)");
  });

  it("clones exact calculator locations when there is no regex", () => {
    const result = patch(EXACT_CONF);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("location = /calculator {");
    expect(result.stdout).toContain("location = /best-cs2-trade-ups {");
    expect(result.stdout).toContain("location /calculator/ {");
    expect(result.stdout).toContain("location /best-cs2-trade-ups/ {");
    expect(patch(result.stdout).stdout).toBe(result.stdout);
  });

  it("fails closed when calculator is not a proxy location", () => {
    const result = patch("location / {\n    try_files $uri $uri/ /index.html;\n}\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no calculator proxy location");
  });

  it("deploy patches nginx before the public SEO smoke, and pr-checks stays on prerendered routes", () => {
    const patchAt = deploy.indexOf("scripts/patch-nginx-best-route.py --apply");
    const smokeAt = deploy.indexOf("npm run verify:seo:public -- --routes=");
    expect(patchAt).toBeGreaterThan(0);
    expect(smokeAt).toBeGreaterThan(patchAt);
    expect(deploy).toContain("/best-cs2-trade-ups");
    expect(deploy).toContain("/trade-ups/tiers/covert");
    expect(prChecks).toContain("--routes=/calculator,/faq,/features,/blog/how-cs2-trade-ups-work/");
    expect(prChecks).not.toContain("/best-cs2-trade-ups");
  });
});
