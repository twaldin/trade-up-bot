import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

describe("blog post canonical uses trailing slash (#2)", () => {
  it("BlogPostPage.tsx canonical href template ends with trailing slash", () => {
    const source = readFileSync(join(__dir, "../../src/pages/BlogPostPage.tsx"), "utf-8");
    // The canonical href should be /blog/${something}/ (trailing slash)
    // Not /blog/${something} (no trailing slash)
    // Matches template literal: /blog/${post.slug}/ followed by backtick
    expect(source).toMatch(/\/blog\/\$\{[^}]+\}\/`/);
  });
});
