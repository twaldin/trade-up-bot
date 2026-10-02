import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_RETURN_STRIP_SOURCE } from "../../shared/auth-return-strip.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "dist");
const distReady = existsSync(dist);

if (!distReady) {
  console.warn("auth-return-dist: skipped because dist/ is missing. Run npm run build to check the auth-return strip in HTML.");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

describe.skipIf(!distReady)("dist HTML strips the login nonce before gtag", () => {
  const files = distReady ? walk(dist) : [];

  it("covers the nginx first HTML, the SPA shell, and prerendered pricing", () => {
    for (const rel of ["index.html", "_shell.html", join("pricing", "index.html")]) {
      expect(files).toContain(join(dist, rel));
    }
  });

  it("places the strip script before every gtag config and any pixel PageView", () => {
    const tracked = files.filter((path) => readFileSync(path, "utf-8").includes("gtag('config'"));
    expect(tracked.length).toBeGreaterThan(0);
    for (const path of tracked) {
      const html = readFileSync(path, "utf-8");
      const stripAt = html.indexOf("__tubAuthReturn");
      const configAt = html.indexOf("gtag('config'");
      expect(stripAt, path).toBeGreaterThan(-1);
      expect(stripAt, path).toBeLessThan(configAt);
      expect(html, path).toContain("__tubPageLocation");
      expect(html, path).toContain("page_location:");
      const pixelAt = html.indexOf("fbq('track','PageView')");
      if (pixelAt !== -1) expect(stripAt, path).toBeLessThan(pixelAt);
    }
  });

  it("keeps the strip source in the vite shell nginx falls back to", () => {
    const shell = readFileSync(join(dist, "_shell.html"), "utf-8");
    expect(shell).toContain(AUTH_RETURN_STRIP_SOURCE);
    expect(shell.indexOf(AUTH_RETURN_STRIP_SOURCE)).toBeLessThan(shell.indexOf("gtag('config'"));
  });
});
