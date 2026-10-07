// Local nginx + Playwright load of /, /trade-ups, /pricing, and a trade-up page.
// Counts Content-Security-Policy violations under the enforced static-HTML policy.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import puppeteer from "puppeteer";
import { chromium } from "playwright-core";
import { helmetSecurityOptions, staticHtmlSecurityHeaders } from "../server/security-headers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8088;
const apiPort = 3011;
const base = `http://127.0.0.1:${port}`;
const routes = ["/", "/trade-ups", "/pricing", "/trade-ups/781440195"];
const artifactDir = "/opt/cursor/artifacts";

const ENV = { GA4_MEASUREMENT_ID: "G-2474G4P5QE" };

function startApi(): Promise<Server> {
  const app = express();
  app.use(helmet(helmetSecurityOptions(ENV)));
  app.get("/api/global-stats", (_req, res) => {
    res.json({ ok: true });
  });
  const server = createServer(app);
  server.listen(apiPort, "127.0.0.1");
  return once(server, "listening").then(() => server);
}

function patchedConf(): Promise<string> {
  const headers = staticHtmlSecurityHeaders(ENV);
  const conf = `worker_processes 1;
daemon off;
pid /tmp/tub-nginx.pid;
error_log /tmp/tub-nginx-error.log info;
events { worker_connections 64; }
http {
    client_body_temp_path /tmp/tub-nginx-temp/client;
    proxy_temp_path /tmp/tub-nginx-temp/proxy;
    fastcgi_temp_path /tmp/tub-nginx-temp/fastcgi;
    uwsgi_temp_path /tmp/tub-nginx-temp/uwsgi;
    scgi_temp_path /tmp/tub-nginx-temp/scgi;
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /tmp/tub-nginx-access.log;
    server {
        listen 127.0.0.1:${port};
        server_name localhost;
        root ${root}/dist;
        add_header X-Frame-Options DENY always;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        location /api/ {
            proxy_pass http://127.0.0.1:${apiPort};
            proxy_set_header Host $host;
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
}
`;
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [path.join(root, "scripts/patch-nginx-security-headers.py")], {
      env: { ...process.env, NGINX_SECURITY_HEADERS_JSON: JSON.stringify(headers) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `patch exited ${code}`));
      else resolve(stdout);
    });
    child.stdin.end(conf);
  });
}

function startNginx(conf: string): ChildProcess {
  const confPath = "/tmp/tub-nginx.conf";
  writeFileSync(confPath, conf);
  const child = spawn("nginx", ["-c", confPath], { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

async function curlHeaders(url: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("curl", ["-sI", url]);
  return stdout;
}

async function main(): Promise<void> {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync("/tmp/tub-nginx-temp/client", { recursive: true });
  mkdirSync("/tmp/tub-nginx-temp/proxy", { recursive: true });
  mkdirSync("/tmp/tub-nginx-temp/fastcgi", { recursive: true });
  mkdirSync("/tmp/tub-nginx-temp/uwsgi", { recursive: true });
  mkdirSync("/tmp/tub-nginx-temp/scgi", { recursive: true });
  const api = await startApi();
  const conf = await patchedConf();
  writeFileSync(path.join(artifactDir, "nginx-static-security.conf"), conf);
  const nginx = startNginx(conf);
  console.log(`nginx pid ${nginx.pid} on ${base}`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const curls = [
    ["GET /", await curlHeaders(`${base}/`)],
    ["GET /api/global-stats", await curlHeaders(`${base}/api/global-stats`)],
    ["GET /pricing", await curlHeaders(`${base}/pricing/`)],
  ];
  const curlText = curls.map(([name, body]) => `===== ${name} =====\n${body}`).join("\n");
  writeFileSync(path.join(artifactDir, "curl-headers.txt"), curlText);
  process.stdout.write(curlText);

  const browser = await chromium.launch({
    executablePath: puppeteer.executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const lines: string[] = [];
  try {
    for (const route of routes) {
      const page = await browser.newPage();
      const violations: { directive: string; blocked: string }[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") lines.push(`${route} console ${msg.text()}`);
      });
      await page.addInitScript(() => {
        const list: { directive: string; blocked: string }[] = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          list.push({ directive: event.violatedDirective, blocked: event.blockedURI });
        });
        Reflect.set(window, "__cspViolations", list);
      });
      await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(1500);
      const found = await page.evaluate(() => {
        const value: unknown = Reflect.get(window, "__cspViolations");
        return Array.isArray(value) ? value : [];
      });
      violations.push(...found as { directive: string; blocked: string }[]);
      lines.push(`${route} violations ${violations.length}`);
      for (const hit of violations) lines.push(`  ${hit.directive} ${hit.blocked}`);
      await page.close();
    }

    const page = await browser.newPage();
    const referers: { url: string; referer: string }[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith(base) && !url.includes("auth=") && req.resourceType() !== "document") {
        referers.push({ url: url.slice(base.length), referer: req.headers().referer ?? "" });
      }
    });
    const secret = `${base}/?auth=SECRETAUTH&lid=SECRETLID&eid=SECRETEID&session_id=cs_test_SECRET&upgraded=1&utm_source=qa`;
    await page.goto(secret, { waitUntil: "networkidle", timeout: 30_000 });
    const leaked = referers.filter((hit) => /auth=|lid=|eid=|session_id=|upgraded=|SECRETAUTH|SECRETLID|cs_test_SECRET/.test(hit.referer));
    lines.push(`secret-url asset requests ${referers.length} leaked ${leaked.length}`);
    for (const hit of leaked) lines.push(`  LEAK ${hit.url} ${hit.referer}`);
    for (const hit of referers.filter((item) => /\.(js|css|woff2|webp|svg)/.test(item.url)).slice(0, 12)) {
      lines.push(`  referer ${hit.url} ${hit.referer}`);
    }
    await page.close();
  } finally {
    await browser.close();
    api.close();
  }

  const report = lines.join("\n") + "\n";
  writeFileSync(path.join(artifactDir, "csp-playwright.log"), report);
  process.stdout.write(report);
  if (lines.some((line) => line.includes("violations") && !line.endsWith(" 0"))) {
    process.exitCode = 1;
  }
  if (lines.some((line) => line.startsWith("secret-url") && !line.endsWith("leaked 0"))) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
