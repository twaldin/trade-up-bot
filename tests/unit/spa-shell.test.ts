import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const prerenderSource = readFileSync(join(__dir, "../../scripts/prerender.ts"), "utf-8");

describe("SPA shell serving", () => {
  it("prerender.ts copies index.html to _shell.html before rendering", () => {
    expect(prerenderSource).toContain('copyFileSync');
    expect(prerenderSource).toContain('"_shell.html"');
  });

  it("server/index.ts reads _shell.html as the SPA shell", () => {
    expect(serverSource).toContain('_shell.html');
    expect(serverSource).toContain('shellHtml');
  });

  it("server/index.ts uses shellHtml for /trade-ups non-crawler branch", () => {
    expect(serverSource).toContain('injectMetaIntoSpa(shellHtml');
  });

  it("server/index.ts falls back to indexHtml when _shell.html is absent", () => {
    expect(serverSource).toContain('shellPath');
    expect(serverSource).toContain('fs.existsSync(shellPath)');
    // If shell not present, fall back to indexHtml
    expect(serverSource).toContain(': indexHtml');
  });

  it("server/index.ts catch-all sends shellHtml instead of sendFile(index.html)", () => {
    // The catch-all must use res.send(shellHtml) not res.sendFile pointing at index.html for SPA routes
    expect(serverSource).toContain('res.send(shellHtml)');
    // The old sendFile pattern targeting index.html should not be the catch-all anymore
    const catchAllSection = serverSource.slice(serverSource.lastIndexOf('app.get("*"'));
    expect(catchAllSection).toContain('shellHtml');
  });

  it("server/index.ts exposes shellHtml on app.locals for downstream use", () => {
    expect(serverSource).toContain('app.locals.shellHtml = shellHtml');
  });
});
