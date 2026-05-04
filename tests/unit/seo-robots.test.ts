import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

describe("robots.txt disallows /api/ (#11)", () => {
  it("contains Disallow: /api/", () => {
    const robots = readFileSync(join(__dir, "../../public/robots.txt"), "utf-8");
    expect(robots).toContain("Disallow: /api/");
  });

  it("still allows / and disallows /auth/", () => {
    const robots = readFileSync(join(__dir, "../../public/robots.txt"), "utf-8");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /auth/");
  });

  it("still references the sitemap", () => {
    const robots = readFileSync(join(__dir, "../../public/robots.txt"), "utf-8");
    expect(robots).toContain("Sitemap: https://tradeupbot.app/sitemap.xml");
  });
});
