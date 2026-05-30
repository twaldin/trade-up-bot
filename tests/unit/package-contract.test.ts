import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("package deployment contract", () => {
  it("does not expose package scripts whose tsx entrypoints are missing", () => {
    const tsxScriptEntries = Object.entries(pkg.scripts)
      .map(([name, command]) => {
        const match = command.match(/^tsx (?:watch )?([^ ]+\.ts)$/);
        return match ? { name, entrypoint: match[1] } : null;
      })
      .filter((entry): entry is { name: string; entrypoint: string } => entry !== null);

    expect(tsxScriptEntries.length).toBeGreaterThan(0);
    for (const { name, entrypoint } of tsxScriptEntries) {
      expect(existsSync(resolve(repoRoot, entrypoint)), `${name} -> ${entrypoint}`).toBe(true);
    }
  });

  it("keeps UI generators out of production dependencies", () => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty("shadcn");
    expect(pkg.devDependencies ?? {}).toHaveProperty("shadcn");
  });
});
