import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function extractTsxScriptEntries(name: string, command: string) {
  const tsxEntryPattern = /(?:^|[\s;&|])(?:npx\s+)?tsx\s+(?:watch\s+)?([^\s;&|]+\.ts)(?=$|[\s;&|])/g;
  return Array.from(command.matchAll(tsxEntryPattern), (match) => ({
    name,
    entrypoint: match[1],
  }));
}

describe("package deployment contract", () => {
  it("does not expose package scripts whose tsx entrypoints are missing", () => {
    const tsxScriptEntries = Object.entries(pkg.scripts)
      .flatMap(([name, command]) => extractTsxScriptEntries(name, command));

    expect(tsxScriptEntries).toEqual(
      expect.arrayContaining([
        { name: "postbuild", entrypoint: "scripts/prerender.ts" },
        { name: "postbuild", entrypoint: "scripts/verify-seo-html.ts" },
      ]),
    );
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
