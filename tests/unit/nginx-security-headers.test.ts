import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { staticHtmlSecurityHeaders } from "../../server/security-headers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/patch-nginx-security-headers.py");
const deploy = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

const HEADERS = staticHtmlSecurityHeaders({ GA4_MEASUREMENT_ID: "G-2474G4P5QE" });

const CONF = `server {
    root /opt/trade-up-bot/dist;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
    }

    location /assets/ {
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location / {
        add_header Cache-Control "no-cache, must-revalidate";
        try_files $uri $uri/ /index.html;
    }
}
`;

function patch(text: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("python3", [script], {
    input: text,
    encoding: "utf8",
    env: { ...process.env, NGINX_SECURITY_HEADERS_JSON: JSON.stringify(HEADERS) },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function countHeader(text: string, name: string): number {
  return text.split("\n").filter((line) => new RegExp(`^\\s*add_header\\s+${name}\\b`, "i").test(line)).length;
}

describe("nginx static HTML security headers", () => {
  it("puts one CSP, HSTS, and Referrer-Policy on static HTML and takes them off the proxy", () => {
    const result = patch(CONF);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('add_header Referrer-Policy "strict-origin-when-cross-origin" always;');
    expect(result.stdout).toContain('add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;');
    expect(result.stdout).toContain("https://www.googletagmanager.com");
    expect(result.stdout).toContain("https://www.google.com");
    expect(result.stdout).not.toContain("facebook");
    expect(countHeader(result.stdout, "Referrer-Policy")).toBe(1);
    expect(countHeader(result.stdout, "Content-Security-Policy")).toBe(1);
    expect(countHeader(result.stdout, "Strict-Transport-Security")).toBe(1);
    expect(countHeader(result.stdout, "X-Frame-Options")).toBe(1);
    expect(countHeader(result.stdout, "X-Content-Type-Options")).toBe(1);
    const api = result.stdout.slice(result.stdout.indexOf("location /api/"), result.stdout.indexOf("location /assets/"));
    expect(api).not.toContain("add_header");
    const assets = result.stdout.slice(result.stdout.indexOf("location /assets/"), result.stdout.indexOf("location / {"));
    expect(assets).toContain('add_header Cache-Control "public, immutable";');
    expect(assets).not.toContain("Content-Security-Policy");
    const rootLocation = result.stdout.slice(result.stdout.indexOf("location / {"));
    expect(rootLocation).toContain('add_header Cache-Control "no-cache, must-revalidate";');
    expect(rootLocation).toContain("Content-Security-Policy");
    expect(patch(result.stdout).stdout).toBe(result.stdout);
  });

  it("fails closed when nothing serves static HTML", () => {
    const result = patch("location /api/ {\n    proxy_pass http://127.0.0.1:3001;\n}\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no static HTML location");
  });

  it("deploy applies the patch after the best-route patch and before the smoke check", () => {
    const best = deploy.indexOf("scripts/patch-nginx-best-route.py --apply");
    const security = deploy.indexOf("scripts/patch-nginx-security-headers.py --apply");
    const smoke = deploy.indexOf("name: Smoke check");
    expect(best).toBeGreaterThan(0);
    expect(security).toBeGreaterThan(best);
    expect(smoke).toBeGreaterThan(security);
  });
});
