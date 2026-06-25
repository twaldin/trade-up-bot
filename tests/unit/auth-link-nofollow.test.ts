import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dir, "../../src/App.tsx"), "utf-8");

describe("auth links avoid crawler follow noise", () => {
  it("marks Steam auth links nofollow", () => {
    expect(appSource).toContain('rel="nofollow"');
    // Steam auth links route through authHref() so the stored ?ref survives the redirect.
    expect(appSource).toContain('href={authHref(window.location.pathname)}');
    expect(appSource).toContain('href={href}');
  });
});
