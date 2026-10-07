import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/patch-nginx-upstream-retry.py");

function patch(text: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("python3", [script], { input: text, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const CONF = `server {
    root /opt/trade-up-bot/dist;
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_read_timeout 60s;
    }
    location /calculator {
        proxy_pass http://127.0.0.1:3001;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;

describe("nginx upstream retry", () => {
  it("adds a backup and retries 502 and connect errors, including POST", () => {
    const result = patch(CONF);
    expect(result.status).toBe(0);
    const upstreamAt = result.stdout.indexOf("upstream tradeup_api");
    const serverAt = result.stdout.indexOf("server {");
    expect(upstreamAt).toBeGreaterThanOrEqual(0);
    expect(upstreamAt).toBeLessThan(serverAt);
    expect(result.stdout).toContain("server 127.0.0.1:3001 max_fails=0;");
    expect(result.stdout).toContain("server 127.0.0.1:3002 backup;");
    expect(result.stdout).not.toContain("proxy_pass http://127.0.0.1:3001;");
    expect(result.stdout).toContain("proxy_pass http://tradeup_api;");
    expect(result.stdout).toContain("proxy_next_upstream error timeout http_502 http_503 non_idempotent;");
    expect(result.stdout).toContain("proxy_next_upstream_tries 2;");
    expect(result.stdout).toContain("proxy_next_upstream_timeout 3s;");
    expect(result.stdout).toContain("proxy_connect_timeout 1s;");
    expect(result.stdout).not.toContain("http_500");
    expect(result.stdout.match(/proxy_read_timeout/g)).toEqual(["proxy_read_timeout"]);
    expect(result.stdout).toContain("try_files $uri $uri/ /index.html;");
    const staticBlock = result.stdout.slice(result.stdout.indexOf("location / {"));
    expect(staticBlock).not.toContain("proxy_next_upstream");
    expect(patch(result.stdout).stdout).toBe(result.stdout);
  });

  it("fails closed when nothing proxies the api", () => {
    const result = patch("server {\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no proxy_pass http://127.0.0.1:3001");
  });
});
