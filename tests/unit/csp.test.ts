import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../server/index.ts"), "utf-8");

describe("production CSP", () => {
  it("allows https://www.google.com on connect-src for GA4 /g/collect", () => {
    const helmet = serverSource.slice(
      serverSource.indexOf("contentSecurityPolicy"),
      serverSource.indexOf("Stripe webhook"),
    );
    const connectLine = helmet.split("\n").find((line) => line.includes("connectSrc"));
    expect(connectLine).toContain('"https://www.google.com"');
    for (const line of helmet.split("\n")) {
      if (line.includes("connectSrc")) continue;
      expect(line).not.toContain("www.google.com");
    }
  });
});
