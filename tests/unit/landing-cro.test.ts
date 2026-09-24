import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const chrome = read("../../src/preview/PreviewChrome.tsx");
const css = read("../../src/preview/preview.css");

function cssBlock(source: string, header: string): string {
  const at = source.indexOf(header);
  if (at < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  return "";
}

describe("marketing header at phone widths", () => {
  it("splits the CTA from the view prefs so it can own the first row", () => {
    expect(chrome).toContain("preview-nav__cta");
    expect(chrome).toContain("preview-nav__prefs");
  });

  it("never wraps the header CTA onto several lines", () => {
    expect(cssBlock(css, ".preview-nav__cta {")).toMatch(/white-space:\s*nowrap/);
  });

  it("wraps into a second row that keeps Features / Pricing / FAQ / Blog tappable", () => {
    expect(cssBlock(css, ".preview-nav {")).toMatch(/min-height:\s*56px/);
    expect(cssBlock(css, ".preview-nav {")).not.toMatch(/(?<!min-)height:\s*56px/);
    const narrow = cssBlock(css, "@media (max-width: 799px)");
    expect(narrow).toMatch(/\.preview-nav\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(narrow).toMatch(/\.preview-nav__links\s*\{[^}]*display:\s*flex/);
  });
});
