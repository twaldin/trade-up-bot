import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dir = dirname(fileURLToPath(import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(join(__dir, "../..", relativePath), "utf-8");

describe("blog internal links use canonical trailing slash URLs", () => {
  it("links blog index cards to trailing-slash post URLs", () => {
    const source = readSource("src/pages/BlogPage.tsx");

    expect(source).toContain("to={`/blog/${post.slug}/`}");
    expect(source).not.toContain("to={`/blog/${post.slug}`}");
  });

  it("links landing page blog cards to trailing-slash post URLs", () => {
    const source = readSource("src/pages/LandingPage.tsx");

    expect(source).toContain("href={`/blog/${post.slug}/`}");
    expect(source).not.toContain("href={`/blog/${post.slug}`}");
  });

  it("links FAQ and related-post cards to trailing-slash post URLs", () => {
    const faqSource = readSource("src/pages/FaqPage.tsx");
    const postSource = readSource("src/pages/BlogPostPage.tsx");

    expect(faqSource).toContain("to={`/blog/${slug}/`}");
    expect(faqSource).not.toContain("to={`/blog/${slug}`}");
    expect(postSource).toContain("to={`/blog/${related.slug}/`}");
    expect(postSource).not.toContain("to={`/blog/${related.slug}`}");
  });
});
