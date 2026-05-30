import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dir, "../../src/App.tsx"), "utf-8");

describe("auth links avoid crawler follow noise", () => {
  it("marks Steam auth links nofollow", () => {
    expect(appSource).toContain('rel="nofollow"');
    expect(appSource).toContain('href={`/auth/steam?return=${encodeURIComponent(window.location.pathname)}`}');
    expect(appSource).toContain('href={href}');
  });
});
